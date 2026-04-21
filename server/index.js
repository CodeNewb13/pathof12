const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const GameState = require('./gameState');
const AdminStore = require('./adminStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'ctf-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// Share session with Socket.IO
io.engine.use(sessionMiddleware);

const game = new GameState();
const adminStore = new AdminStore();
adminStore.seed();

function broadcast() {
  io.emit('gameState', game.getState());
}

// ── Auth Routes ──────────────────────────────────────────────────
app.get('/auth/me', (req, res) => {
  console.log(`[Auth/me] GET requested. Session admin:`, req.session.admin);
  res.json({ user: req.session.admin || null });
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
    req.session.admin = admin;
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
  req.session.destroy((err) => {
    if (err) console.error('[Auth/logout] Session destroy error:', err);
    res.json({ ok: true });
  });
});

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(403).json({ error: 'Login required' });
  next();
}

app.get('/auth/accounts', requireAdmin, (req, res) => {
  res.json(adminStore.getAll());
});

app.post('/auth/accounts', requireAdmin, async (req, res) => {
  const { username, password } = req.body || {};
  const result = await adminStore.create(username, password);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json(result.admin);
});

app.delete('/auth/accounts/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.session.admin.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });
  const result = adminStore.delete(req.params.id);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// Server-side payout timer check
setInterval(() => {
  const s = game.getState();
  if (!s.timerPaused && Date.now() >= s.nextPayoutAt) {
    game.processPayout();
    broadcast();
  }
}, 1000);

io.on('connection', (socket) => {
  socket.emit('gameState', game.getState());

  function getUser() {
    return socket.request.session && socket.request.session.admin;
  }

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

  function handle(op) {
    let result;
    if (op.execute) result = op.execute();
    else if (op.queue) result = op.queue();
    if (result && result.success === false) socket.emit('actionError', result.error);
    else broadcast();
  }

  // Helper or Admin actions
  socket.on('capturePost', ({ postId, teamId }) => gameAction('Capture Post', `Team ${teamId} -> Post ${postId}`, () => game.capturePost(postId, teamId)));
  socket.on('steal', ({ actingTeamId, targetTeamId }) => gameAction('Steal', `Team ${actingTeamId} steals from ${targetTeamId}`, () => game.steal(actingTeamId, targetTeamId)));
  socket.on('secure', ({ actingTeamId, postId }) => gameAction('Secure Post', `Team ${actingTeamId} secures ${postId}`, () => game.secure(actingTeamId, postId)));
  socket.on('shield', ({ actingTeamId }) => gameAction('Shield', `Team ${actingTeamId} shields`, () => game.shield(actingTeamId)));
  socket.on('breakShield', ({ actingTeamId, targetTeamId }) => gameAction('Break Shield', `Team ${actingTeamId} breaks ${targetTeamId}`, () => game.breakShield(actingTeamId, targetTeamId)));
  socket.on('seek', ({ actingTeamId, targetTeamId1, targetTeamId2 }) => gameAction('Seek', `Team ${actingTeamId} seeks ${targetTeamId1}, ${targetTeamId2}`, () => game.seek(actingTeamId, targetTeamId1, targetTeamId2)));
  socket.on('adjustPoints', ({ teamId, amount }) => gameAction('Adjust Points', `Team ${teamId} by ${amount}`, () => game.adjustPoints(teamId, amount)));

  // Queue Approval/Reject actions
  socket.on('approveRequest', ({ id }) => verifyAdmin(() => game.approveRequest(id)));
  socket.on('rejectRequest', ({ id }) => verifyAdmin(() => game.rejectRequest(id)));
  // Anyone can cancel a request (or maybe we restrict to whoever created it, but for simplicity any logged-in user can cancel)
  socket.on('cancelRequest', ({ id }) => { const u = getUser(); if(u) handle({ execute: () => game.rejectRequest(id) }); else socket.emit('actionError', 'Login required'); });

  // System/Global Actions (queued for helpers, immediate for admins)
  socket.on('manualPayout', () => gameAction('Manual Payout', '', () => { game.processPayout(); return { success: true }; }));
  socket.on('resetTimer', () => gameAction('Reset Timer', '', () => { game.resetPayoutTimer(); return { success: true }; }));
  socket.on('pauseTimer', () => gameAction('Pause Timer', '', () => game.pauseTimer()));
  socket.on('resumeTimer', () => gameAction('Resume Timer', '', () => game.resumeTimer()));
  socket.on('unsecurePost', ({ postId }) => gameAction('Unsecure Post', `Post ${postId}`, () => game.unsecurePost(postId)));
  socket.on('removeShield', ({ teamId }) => gameAction('Remove Shield', `Team ${teamId}`, () => game.removeShield(teamId)));
  socket.on('updateSettings', (settings) => gameAction('Update Settings', 'Global Settings', () => { game.updateSettings(settings); return { success: true }; }));
  socket.on('addPost', ({ tier }) => gameAction('Add Post', `${tier} tier`, () => game.addPost(tier)));
  socket.on('deletePost', ({ postId }) => gameAction('Delete Post', `Post ${postId}`, () => game.deletePost(postId)));
  socket.on('renamePost', ({ postId, newName }) => gameAction('Rename Post', `Post ${postId} -> ${newName}`, () => game.renamePost(postId, newName)));
  socket.on('setTierValue', ({ tier, newValue }) => gameAction('Set Tier Value', `${tier} -> ${newValue}`, () => game.setTierValue(tier, newValue)));
  socket.on('resetGame', () => gameAction('Reset Game', '', () => { game.resetGame(); return { success: true }; }));
  socket.on('resetPoints', () => gameAction('Reset Points', '', () => { game.resetPoints(); return { success: true }; }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CTF Webapp running on http://localhost:${PORT}`);
});
