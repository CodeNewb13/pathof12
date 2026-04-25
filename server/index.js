const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const GameState = require('./gameState');
const AdminStore = require('./adminStore');

const app = express();

// Required so secure cookies send over reverse proxies like Railway
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new Server(server);

let redisClient = null;
let sessionMiddleware;
const activeAccountSessions = new Map();
const onlineAccountConnections = new Map();

function newSessionToken() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function incrementOnline(accountId) {
  onlineAccountConnections.set(accountId, (onlineAccountConnections.get(accountId) || 0) + 1);
}

function decrementOnline(accountId) {
  const current = onlineAccountConnections.get(accountId) || 0;
  if (current <= 1) onlineAccountConnections.delete(accountId);
  else onlineAccountConnections.set(accountId, current - 1);
}

function getValidatedSessionUser(req) {
  const user = req.session?.admin;
  const token = req.session?.loginToken;
  if (!user || !token) return null;
  const active = activeAccountSessions.get(user.id);
  if (!active || active.token !== token) return null;
  active.lastSeenAt = Date.now();
  return user;
}

function getAccountStatuses(accounts) {
  return accounts.map((a) => {
    const active = activeAccountSessions.get(a.id);
    return {
      ...a,
      loggedIn: !!active,
      online: (onlineAccountConnections.get(a.id) || 0) > 0,
      lastSeenAt: active ? active.lastSeenAt : null
    };
  });
}

async function setupSessions() {
  const redisUrl = process.env.REDIS_URL;
  let store;

  if (redisUrl) {
    redisClient = createClient({
      url: redisUrl,
      socket: redisUrl.startsWith('rediss://') ? { tls: true, rejectUnauthorized: false } : undefined
    });

    redisClient.on('connect', () => console.log('Connected to Redis'));
    redisClient.on('error', (err) => console.error('Redis Client Error', err));

    try {
      await redisClient.connect();
      store = new RedisStore({
        client: redisClient,
        prefix: 'ctfapp:',
      });
      console.log('Using Redis session store');
    } catch (err) {
      console.error('Failed to connect to Redis. Falling back to in-memory sessions.', err);
      redisClient = null;
    }
  } else {
    console.warn('REDIS_URL not set. Using in-memory sessions.');
  }

  sessionMiddleware = session({
    store,
    proxy: true,
    secret: process.env.SESSION_SECRET || 'ctf-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  });
}

let game;
let adminStore;

function broadcast() {
  if (!game) return;
  io.emit('gameState', game.getState());
}

function requireAdmin(req, res, next) {
  const user = getValidatedSessionUser(req);
  if (!user) {
    if (req.session) {
      req.session.admin = null;
      req.session.loginToken = null;
    }
    return res.status(403).json({ error: 'Login required' });
  }
  req.currentAdmin = user;
  next();
}

function registerAuthRoutes() {
  app.get('/auth/me', (req, res) => {
    const user = getValidatedSessionUser(req);
    console.log(`[Auth/me] GET requested. Session admin:`, user);
    if (!user && req.session) {
      req.session.admin = null;
      req.session.loginToken = null;
    }
    res.json({ user: user || null });
  });

  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body || {};
    console.log(`[Auth/login] POST requested for user: ${username}`);
    try {
      const admin = await adminStore.verify(username, password);
      if (!admin) {
        console.log(`[Auth/login] Verification failed for user: ${username}`);
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      console.log(`[Auth/login] Successful login for user: ${username}, role: ${admin.role}`);
      const existing = activeAccountSessions.get(admin.id);
      if (existing && existing.sessionId !== req.sessionID && sessionMiddleware.store?.destroy) {
        sessionMiddleware.store.destroy(existing.sessionId, () => {});
      }

      const loginToken = newSessionToken();
      req.session.admin = admin;
      req.session.loginToken = loginToken;
      activeAccountSessions.set(admin.id, {
        sessionId: req.sessionID,
        token: loginToken,
        username: admin.username,
        role: admin.role,
        lastSeenAt: Date.now()
      });
      req.session.save((err) => {
        if (err) console.error('[Auth/login] Session save error:', err);
        res.json({ user: admin });
      });
    } catch (error) {
      console.error(`[Auth/login] Server error during login:`, error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/auth/logout', (req, res) => {
    console.log(`[Auth/logout] POST requested.`);
    const user = req.session?.admin;
    const token = req.session?.loginToken;
    if (user && token) {
      const active = activeAccountSessions.get(user.id);
      if (active && active.token === token) activeAccountSessions.delete(user.id);
    }
    if (!req.session) return res.json({ ok: true });
    req.session.destroy((err) => {
      if (err) console.error('[Auth/logout] Session destroy error:', err);
      res.json({ ok: true });
    });
  });

  app.get('/auth/accounts', requireAdmin, async (req, res) => {
    try {
      const accounts = await adminStore.getAll();
      res.json(getAccountStatuses(accounts));
    } catch (error) {
      console.error('[Auth/accounts] Failed to load accounts:', error);
      res.status(500).json({ error: 'Failed to load accounts' });
    }
  });

  app.post('/auth/accounts', requireAdmin, async (req, res) => {
    const { username, password } = req.body || {};
    const result = await adminStore.create(username, password);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json(result.admin);
  });

  app.delete('/auth/accounts/:id', requireAdmin, async (req, res) => {
    if (req.params.id === req.currentAdmin?.id)
      return res.status(400).json({ error: 'Cannot delete your own account' });
    const result = await adminStore.delete(req.params.id);
    if (result.success) {
      activeAccountSessions.delete(req.params.id);
      onlineAccountConnections.delete(req.params.id);
    }
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ ok: true });
  });

  app.patch('/auth/accounts/:id', requireAdmin, async (req, res) => {
    const { username, password, role } = req.body || {};
    const updates = {};
    if (username !== undefined) updates.username = username;
    if (password !== undefined) updates.password = password;
    if (role !== undefined) updates.role = role;

    const result = await adminStore.update(req.params.id, updates);
    if (!result.success) return res.status(400).json({ error: result.error });

    const active = activeAccountSessions.get(req.params.id);
    if (active && result.admin?.username) {
      active.username = result.admin.username;
      active.role = result.admin.role;
      active.lastSeenAt = Date.now();
    }

    res.json(result.admin);
  });
}

// Server-side payout timer check
setInterval(() => {
  if (!game) return;
  const s = game.getState();
  let changed = false;

  const now = Date.now();
  if (!s.timerPaused) {
    if (game.clearExpiredShields(now)) changed = true;

    for (const post of s.posts) {
      if (post.isSecured && post.cooldownEndsAt && now >= post.cooldownEndsAt) {
        post.isSecured = false;
        changed = true;
      }
    }
  }

  if (changed) {
    game.save();
    broadcast();
  }

  if (!s.timerPaused && now >= s.nextPayoutAt) {
    game.processPayout();
    broadcast();
  }
}, 1000);

io.on('connection', (socket) => {
  socket.emit('gameState', game.getState());

  function getUser() {
    const req = socket.request;
    const user = getValidatedSessionUser(req);
    if (!user) {
      if (socket.data.accountId) {
        decrementOnline(socket.data.accountId);
        socket.data.accountId = null;
      }
      return null;
    }

    if (!socket.data.accountId) {
      socket.data.accountId = user.id;
      incrementOnline(user.id);
    }

    return user;
  }

  getUser();

  function gameAction(actionName, payloadStr, actionFunc) {
    const user = getUser();
    if (!user) { socket.emit('actionError', 'Login required'); return; }
    
    if (user.role === 'admin') {
      handle({ execute: actionFunc });
    } else {
      // helper role - validation dry-run
      const backupStateStr = JSON.stringify(game.getState());
      
      const originalSave = game.save;
      game.save = () => {}; // prevent saving to disk during validation
      
      let dryResult;
      try {
        dryResult = actionFunc();
      } finally {
        // Rollback state changes unconditionally
        game.state = JSON.parse(backupStateStr);
        game.save = originalSave;
      }
      
      if (dryResult && dryResult.success === false) {
        socket.emit('actionError', dryResult.error);
        return;
      }
      
      handle({ queue: () => game.queueRequest(user.username, actionName, payloadStr, actionFunc) });
    }
  }

  function verifyAdmin(actionFunc) {
    const user = getUser();
    if (!user || user.role !== 'admin') { socket.emit('actionError', 'Admin required'); return; }
    handle({ execute: actionFunc });
  }

  async function handle(op) {
    let result;
    try {
      if (op.execute) result = op.execute();
      else if (op.queue) result = op.queue();
      if (result && typeof result.then === 'function') result = await result;
      if (result && result.success === false) socket.emit('actionError', result.error);
      else broadcast();
    } catch (error) {
      console.error('Action handler failed:', error);
      socket.emit('actionError', 'Action failed');
    }
  }

  const tn = (tid) => game.state.teams.find(t => t.id === tid)?.name || tid;
  const pn = (pid) => game.state.posts.find(p => p.id === pid)?.name || pid;

  // Helper or Admin actions
  socket.on('capturePost', ({ postId, teamId }) => gameAction('Capture Post', `${tn(teamId)} -> ${pn(postId)}`, () => game.capturePost(postId, teamId)));
  socket.on('steal', ({ actingTeamId, targetTeamId }) => gameAction('Steal', `${tn(actingTeamId)} steals from ${tn(targetTeamId)}`, () => game.steal(actingTeamId, targetTeamId)));
  socket.on('secure', ({ actingTeamId, postId }) => gameAction('Secure Post', `${tn(actingTeamId)} secures ${pn(postId)}`, () => game.secure(actingTeamId, postId)));
  socket.on('shield', ({ actingTeamId }) => gameAction('Shield', `${tn(actingTeamId)} shields`, () => game.shield(actingTeamId)));
  socket.on('seek', ({ actingTeamId, targetTeamId1, targetTeamId2 }) => gameAction('Seek', `${tn(actingTeamId)} seeks ${tn(targetTeamId1)}, ${tn(targetTeamId2)}`, () => game.seek(actingTeamId, targetTeamId1, targetTeamId2)));
  socket.on('adjustPoints', ({ teamId, amount }) => gameAction('Adjust Points', `${tn(teamId)} by ${amount}`, () => game.adjustPoints(teamId, amount)));

  // Queue Approval/Reject actions
  socket.on('approveRequest', ({ id }) => verifyAdmin(() => game.approveRequest(id, getUser()?.username || 'Admin')));
  socket.on('rejectRequest', ({ id }) => verifyAdmin(() => game.rejectRequest(id, getUser()?.username || 'Admin')));
  // Anyone can cancel a request (or maybe we restrict to whoever created it, but for simplicity any logged-in user can cancel)
  socket.on('cancelRequest', ({ id }) => { const u = getUser(); if(u) handle({ execute: () => game.rejectRequest(id) }); else socket.emit('actionError', 'Login required'); });

  // System/Global Actions (queued for helpers, immediate for admins)
  socket.on('manualPayout', () => gameAction('Manual Payout', '', () => { game.processPayout(); return { success: true }; }));
  socket.on('resetTimer', () => gameAction('Reset Timer', '', () => { game.resetPayoutTimer(); return { success: true }; }));
  socket.on('pauseTimer', () => gameAction('Pause Timer', '', () => game.pauseTimer()));
  socket.on('resumeTimer', () => gameAction('Resume Timer', '', () => game.resumeTimer()));
  socket.on('unsecurePost', ({ postId }) => gameAction('Unsecure Post', `${pn(postId)}`, () => game.unsecurePost(postId)));
  socket.on('removePostOwnership', ({ postId }) => gameAction('Remove Post Ownership', `${pn(postId)}`, () => game.removePostOwnership(postId)));
  socket.on('removeShield', ({ teamId }) => gameAction('Remove Shield', `${tn(teamId)}`, () => game.removeShield(teamId)));
  socket.on('updateSettings', (settings) => gameAction('Update Settings', 'Global Settings', () => { game.updateSettings(settings); return { success: true }; }));
  socket.on('addPost', ({ tier }) => gameAction('Add Post', `${tier} tier`, () => game.addPost(tier)));
  socket.on('deletePost', ({ postId }) => gameAction('Delete Post', `${pn(postId)}`, () => game.deletePost(postId)));
  socket.on('renamePost', ({ postId, newName }) => gameAction('Rename Post', `${pn(postId)} -> ${newName}`, () => game.renamePost(postId, newName)));
  socket.on('setTierValue', ({ tier, newValue }) => gameAction('Set Tier Value', `${tier} -> ${newValue}`, () => game.setTierValue(tier, newValue)));
  socket.on('setTeamLocation', ({ teamId, postId }) => gameAction('Set Team Location', `${tn(teamId)} -> ${pn(postId)}`, () => game.setTeamLocation(teamId, postId)));
  socket.on('clearTeamLocation', ({ teamId }) => gameAction('Clear Team Location', `${tn(teamId)} -> Idle`, () => game.clearTeamLocation(teamId)));
  socket.on('clearPostCooldown', ({ postId }) => gameAction('Clear Post Timer', `${pn(postId)}`, () => game.clearPostCooldown(postId)));
  socket.on('clearTeamTimers', ({ teamId }) => gameAction('Clear Team Timers', `${tn(teamId)}`, () => game.clearTeamTimers(teamId)));
  socket.on('recoverGameState', () => verifyAdmin(() => game.recoverLastGoodState()));
  socket.on('resetGame', () => gameAction('Reset Game', '', () => { game.resetGame(); return { success: true }; }));
  socket.on('resetPoints', () => gameAction('Reset Points', '', () => { game.resetPoints(); return { success: true }; }));

  socket.on('disconnect', () => {
    if (socket.data.accountId) {
      decrementOnline(socket.data.accountId);
      socket.data.accountId = null;
    }
  });
});

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  await setupSessions();

  app.use(sessionMiddleware);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.json());

  registerAuthRoutes();

  // Share session with Socket.IO.
  io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

  game = await GameState.create({ redisClient });
  adminStore = new AdminStore({ redisClient });
  await adminStore.seed();

  server.listen(PORT, () => {
    console.log(`CTF Webapp running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
