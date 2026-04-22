const Store = require('./store');

const POST_VALUES = [30, 30, 30, 30, 50, 50, 50, 50];
const POST_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const DEFAULT_SETTINGS = {
  postCooldowns: { capture: 5, secure: 10 },
  actionCooldowns: { capture: 0, steal: 5, secure: 0, shield: 0, seek: 0 },
  shieldDuration: 10,
  payoutInterval: 30,
  costs: { steal: 50, safe: 40, breakSafe: 80, capture: 0, secure: 50, seek: 0 },
  tierValues: { high: 50, low: 30 },
  teams: [
    { id: 't1', name: 'Team Red', color: '#e74c3c' },
    { id: 't2', name: 'Team Blue', color: '#3498db' }
  ]
};

function createDefaultState() {
  const now = Date.now();
  return {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    teams: DEFAULT_SETTINGS.teams.map(t => ({ ...t, points: 0, hasSafe: false, safeEndsAt: null, cooldowns: { capture: 0, steal: 0, secure: 0, shield: 0, seek: 0 } })),
    posts: POST_NAMES.map((name, i) => ({
      id: `post_${name}`,
      name: `Post ${name}`,
      pointValue: POST_VALUES[i],
      owningTeamId: null,
      isSecured: false,
      cooldownEndsAt: null
    })),
    nextPayoutAt: now + DEFAULT_SETTINGS.payoutInterval * 60 * 1000,
    roundCount: 0,
    timerPaused: false,
    pausedTimeRemaining: null,
    eventLog: [],
    requestsQueue: []
  };
}

class GameState {
  _sanitizeNonNegativeNumber(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  }

  _normalizeCooldownAndDurationSettings() {
    if (!this.state.settings) this.state.settings = {};
    if (!this.state.settings.postCooldowns) this.state.settings.postCooldowns = {};
    if (!this.state.settings.actionCooldowns) this.state.settings.actionCooldowns = {};

    this.state.settings.postCooldowns.capture = this._sanitizeNonNegativeNumber(this.state.settings.postCooldowns.capture, DEFAULT_SETTINGS.postCooldowns.capture);
    this.state.settings.postCooldowns.secure = this._sanitizeNonNegativeNumber(this.state.settings.postCooldowns.secure, DEFAULT_SETTINGS.postCooldowns.secure);

    this.state.settings.actionCooldowns.capture = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns.capture, DEFAULT_SETTINGS.actionCooldowns.capture);
    this.state.settings.actionCooldowns.steal = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns.steal, DEFAULT_SETTINGS.actionCooldowns.steal);
    this.state.settings.actionCooldowns.secure = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns.secure, DEFAULT_SETTINGS.actionCooldowns.secure);
    this.state.settings.actionCooldowns.shield = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns.shield, DEFAULT_SETTINGS.actionCooldowns.shield);
    this.state.settings.actionCooldowns.seek = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns.seek, DEFAULT_SETTINGS.actionCooldowns.seek);

    this.state.settings.shieldDuration = this._sanitizeNonNegativeNumber(this.state.settings.shieldDuration, DEFAULT_SETTINGS.shieldDuration);
  }

  constructor() {
    this.requestFunctions = {};
    this.store = new Store();
    const loaded = this.store.load();
    this.state = loaded || createDefaultState();
    
    this.state.requestsQueue = [];

    // migrations
    let dirty = false;
    
    if (this.state.settings.cooldownDuration !== undefined) {
      if (!this.state.settings.postCooldowns) {
         this.state.settings.postCooldowns = { 
           capture: this.state.settings.cooldownDuration, 
           secure: this.state.settings.cooldownDuration * (this.state.settings.securedCooldownMultiplier || 1) 
         };
      }
      delete this.state.settings.cooldownDuration;
      delete this.state.settings.securedCooldownMultiplier;
      dirty = true;
    }
    if (this.state.settings.costs) {
      if (this.state.settings.costs.capture === undefined) this.state.settings.costs.capture = 0;
      if (this.state.settings.costs.secure === undefined) this.state.settings.costs.secure = 50;
      if (this.state.settings.costs.seek === undefined) this.state.settings.costs.seek = 0;
    }
    if (!this.state.settings.actionCooldowns) {
      this.state.settings.actionCooldowns = { capture: 0, steal: 5, secure: 0, shield: 0, breakShield: 0, seek: 0 };
      dirty = true;
    }
    if (!this.state.settings.tierValues) {
      this.state.settings.tierValues = { high: 50, low: 30 };
      dirty = true;
    }
    if (this.state.settings.shieldDuration === undefined) {
      this.state.settings.shieldDuration = DEFAULT_SETTINGS.shieldDuration;
      dirty = true;
    }
    if (this.state.settings.tierValues && this.state.settings.tierValues.mid !== undefined) {
      delete this.state.settings.tierValues.mid;
      dirty = true;
    }
    if (this.state.roundCount === undefined) {
      this.state.roundCount = 0;
      dirty = true;
    }
    
    for (const t of this.state.teams) {
      if (!t.cooldowns) {
        t.cooldowns = { capture: 0, steal: 0, secure: 0, shield: 0, breakShield: 0, seek: 0 };
        dirty = true;
      }
      if (t.safeEndsAt === undefined) {
        const durationMs = this._sanitizeNonNegativeNumber(this.state.settings.shieldDuration, DEFAULT_SETTINGS.shieldDuration) * 60000;
        t.safeEndsAt = t.hasSafe ? (Date.now() + durationMs) : null;
        dirty = true;
      }
      if (t.hasSafe && !t.safeEndsAt) {
        t.hasSafe = false;
        dirty = true;
      }
    }

    this._normalizeCooldownAndDurationSettings();

    const tv = this.state.settings.tierValues;
    for (const post of this.state.posts) {
      if (post.pointValue !== tv.high && post.pointValue !== tv.low) {
        post.pointValue = tv.low;
        dirty = true;
      }
    }
    if (dirty) this.store.save(this.state);
  }

  getState() { return this.state; }
  save() { this.store.save(this.state); }

  log(message) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.eventLog.unshift({ timestamp, message });
    if (this.state.eventLog.length > 300) this.state.eventLog.length = 300;
  }

  queueRequest(username, actionName, payloadStr, actionFunc) {
    const id = 'req_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    this.requestFunctions[id] = actionFunc;
    this.state.requestsQueue.push({ id, username, actionName, payloadStr, timestamp: Date.now() });
    this.log(`Helper ${username} requested: ${actionName} (${payloadStr})`);
    return { success: true };
  }

  approveRequest(id) {
    const idx = this.state.requestsQueue.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, error: 'Request not found' };
    const req = this.state.requestsQueue[idx];
    const func = this.requestFunctions[id];
    this.state.requestsQueue.splice(idx, 1);
    delete this.requestFunctions[id];
    this.log(`Admin approved request: ${req.actionName}`);
    if (func) return func();
    return { success: true };
  }

  rejectRequest(id) {
    const idx = this.state.requestsQueue.findIndex(r => r.id === id);
    if (idx === -1) return { success: false, error: 'Request not found' };
    const req = this.state.requestsQueue[idx];
    this.state.requestsQueue.splice(idx, 1);
    delete this.requestFunctions[id];
    this.log(`Request canceled: ${req.actionName} by ${req.username}`);
    return { success: true };
  }

  getTeam(teamId) { return this.state.teams.find(t => t.id === teamId); }
  getPost(postId) { return this.state.posts.find(p => p.id === postId); }

  checkTeamCooldown(teamId, actionName) {
    const team = this.getTeam(teamId);
    if (!team) return { success: false, error: 'Team not found' };
    const cdEnd = this._sanitizeNonNegativeNumber(team.cooldowns && team.cooldowns[actionName] ? team.cooldowns[actionName] : 0, 0);
    if (cdEnd > Date.now()) {
      const waitMins = Math.ceil((cdEnd - Date.now()) / 60000);
      return { success: false, error: `${team.name} cannot ${actionName} for ${waitMins}m` };
    }
    return { success: true };
  }
  
  applyTeamCooldown(teamId, actionName) {
    const team = this.getTeam(teamId);
    const duration = this._sanitizeNonNegativeNumber(this.state.settings.actionCooldowns[actionName], 0);
    if (duration > 0) {
      if (!team.cooldowns) team.cooldowns = {};
      team.cooldowns[actionName] = Date.now() + duration * 60000;
    }
  }

  clearExpiredShields(now = Date.now()) {
    let changed = false;
    for (const team of this.state.teams) {
      if (team.hasSafe && team.safeEndsAt && now >= team.safeEndsAt) {
        team.hasSafe = false;
        team.safeEndsAt = null;
        this.log(`${team.name}'s Shield expired`);
        changed = true;
      }
    }
    if (changed) this.save();
    return changed;
  }

  capturePost(postId, teamId) {
    const post = this.getPost(postId);
    const team = this.getTeam(teamId);
    if (!post || !team) return { success: false, error: 'Not found' };

    const cdCheck = this.checkTeamCooldown(teamId, 'capture');
    if (!cdCheck.success) return cdCheck;

    const cost = this.state.settings.costs.capture || 0;
    if (team.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${team.points})` };

    const now = Date.now();
    if (post.cooldownEndsAt && now < post.cooldownEndsAt) {
      const secs = Math.ceil((post.cooldownEndsAt - now) / 1000);
      return { success: false, error: `${post.name} is on cooldown for ${secs}s` };
    }

    team.points -= cost;
    const prevOwner = post.owningTeamId ? this.getTeam(post.owningTeamId)?.name : null;
    post.owningTeamId = teamId;
    post.isSecured = false;
    post.cooldownEndsAt = now + this.state.settings.postCooldowns.capture * 60 * 1000;

    const msg = prevOwner
      ? `${team.name} captured ${post.name} from ${prevOwner} (cooldown: ${this.state.settings.postCooldowns.capture} min)`
      : `${team.name} captured ${post.name} (cooldown: ${this.state.settings.postCooldowns.capture} min)`;
    this.log(msg);
    this.applyTeamCooldown(teamId, 'capture');
    this.save();
    return { success: true };
  }

  steal(actingTeamId, targetTeamId) {
    const actor = this.getTeam(actingTeamId);
    const target = this.getTeam(targetTeamId);
    if (!actor || !target) return { success: false, error: 'Team not found' };
    
    const cdCheck = this.checkTeamCooldown(actingTeamId, 'steal');
    if (!cdCheck.success) return cdCheck;

    if (target.hasSafe) {
      const shieldCost = this.state.settings.costs.breakSafe || 80;
      if (actor.points < shieldCost) return { success: false, error: `Not enough points to break shield (need ${shieldCost}, have ${actor.points})` };
      
      actor.points -= shieldCost;
      target.hasSafe = false;
      target.safeEndsAt = null;

      this.log(`${actor.name} broke ${target.name}'s shield with Steal (cost: ${shieldCost} pts)`);
      this.applyTeamCooldown(actingTeamId, 'steal');
      this.save();
      return { success: true };
    }

    const cost = this.state.settings.costs.steal;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    const stolen = Math.floor(target.points * 0.3);
    actor.points -= cost;
    target.points -= stolen;
    actor.points += stolen;

    this.log(`${actor.name} stole ${stolen} pts from ${target.name} (cost: ${cost} pts)`);
    this.applyTeamCooldown(actingTeamId, 'steal');
    this.save();
    return { success: true };
  }

  secure(actingTeamId, postId) {
    const actor = this.getTeam(actingTeamId);
    const post = this.getPost(postId);
    if (!actor || !post) return { success: false, error: 'Not found' };
    
    const cdCheck = this.checkTeamCooldown(actingTeamId, 'secure');
    if (!cdCheck.success) return cdCheck;

    if (post.owningTeamId !== actingTeamId) return { success: false, error: 'You do not own this post' };
    if (post.isSecured) return { success: false, error: 'Post is already secured' };

    const costRate = this.state.settings.costs.secure ?? 50;
    const cost = Math.floor(post.pointValue * (costRate / 100));
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    post.isSecured = true;

    const now = Date.now();
    post.cooldownEndsAt = Math.max(post.cooldownEndsAt || 0, now) + this.state.settings.postCooldowns.secure * 60 * 1000;

    this.log(`${actor.name} secured ${post.name} (cost: ${cost} pts, post cooldown +${this.state.settings.postCooldowns.secure}m)`);
    this.applyTeamCooldown(actingTeamId, 'secure');
    this.save();
    return { success: true };
  }

  shield(actingTeamId) {
    const actor = this.getTeam(actingTeamId);
    if (!actor) return { success: false, error: 'Team not found' };

    const now = Date.now();
    if (actor.hasSafe && !actor.safeEndsAt) {
      actor.hasSafe = false;
    }
    if (actor.hasSafe && actor.safeEndsAt && now >= actor.safeEndsAt) {
      actor.hasSafe = false;
      actor.safeEndsAt = null;
    }
    
    const cdCheck = this.checkTeamCooldown(actingTeamId, 'shield');
    if (!cdCheck.success) return cdCheck;

    if (actor.hasSafe) return { success: false, error: 'Already has immunity' };

    const cost = this.state.settings.costs.safe;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    actor.hasSafe = true;
    const durationMins = this._sanitizeNonNegativeNumber(this.state.settings.shieldDuration, DEFAULT_SETTINGS.shieldDuration);
    actor.safeEndsAt = now + durationMins * 60000;

    this.log(`${actor.name} activated Shield (immunity) for ${durationMins}m (cost: ${cost} pts)`);
    this.applyTeamCooldown(actingTeamId, 'shield');
    this.save();
    return { success: true };
  }

  seek(actingTeamId, targetTeamId1, targetTeamId2) {
    const actor = this.getTeam(actingTeamId);
    const target1 = this.getTeam(targetTeamId1);
    const target2 = this.getTeam(targetTeamId2);
    if (!actor || !target1 || !target2) return { success: false, error: 'Team not found' };

    const cdCheck = this.checkTeamCooldown(actingTeamId, 'seek');
    if (!cdCheck.success) return cdCheck;

    const cost = this.state.settings.costs.seek || 0;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    this.log(`Seek: ${target1.name} has ${target1.points} points, ${target2.name} has ${target2.points} points`);
    this.applyTeamCooldown(actingTeamId, 'seek');
    this.save();
    return { success: true };
  }

  processPayout() {
    const payouts = {};
    for (const post of this.state.posts) {
      if (post.owningTeamId) payouts[post.owningTeamId] = (payouts[post.owningTeamId] || 0) + post.pointValue;
    }
    const parts = Object.entries(payouts).map(([teamId, pts]) => {
      const team = this.getTeam(teamId);
      if (team) { team.points += pts; return `${team.name} +${pts}`; }
      return null;
    }).filter(Boolean);
    this.state.roundCount = (this.state.roundCount || 0) + 1;
    this.log(parts.length ? `Point payout: ${parts.join(', ')}` : 'Point payout: no posts owned');
    this.state.nextPayoutAt = Date.now() + this.state.settings.payoutInterval * 60 * 1000;
    this.save();
  }

  resetPayoutTimer() {
    this.state.nextPayoutAt = Date.now() + this.state.settings.payoutInterval * 60 * 1000;
    this.state.timerPaused = false;
    this.state.pausedTimeRemaining = null;
    this.log('Payout timer manually reset');
    this.save();
  }

  pauseTimer() {
    if (this.state.timerPaused) return { success: false, error: 'Timer already paused' };
    this.state.pausedTimeRemaining = Math.max(0, this.state.nextPayoutAt - Date.now());
    this.state.timerPaused = true;
    this.log('Payout timer paused');
    this.save();
    return { success: true };
  }

  resumeTimer() {
    if (!this.state.timerPaused) return { success: false, error: 'Timer is not paused' };
    this.state.nextPayoutAt = Date.now() + (this.state.pausedTimeRemaining || 0);
    this.state.timerPaused = false;
    this.state.pausedTimeRemaining = null;
    this.log('Payout timer resumed');
    this.save();
    return { success: true };
  }

  adjustPoints(teamId, amount) {
    const team = this.getTeam(teamId);
    if (!team) return { success: false, error: 'Team not found' };
    team.points = Math.max(0, team.points + amount);
    const sign = amount >= 0 ? '+' : '';
    this.log(`Admin adjusted ${team.name} points by ${sign}${amount} → total: ${team.points}`);
    this.save();
    return { success: true };
  }

  unsecurePost(postId) {
    const post = this.getPost(postId);
    if (!post) return { success: false, error: 'Post not found' };
    post.isSecured = false;
    this.log(`Admin removed Secured status from ${post.name}`);
    this.save();
    return { success: true };
  }

  removeShield(teamId) {
    const team = this.getTeam(teamId);
    if (!team) return { success: false, error: 'Team not found' };
    team.hasSafe = false;
    team.safeEndsAt = null;
    this.log(`Admin removed immunity (Shield) from ${team.name}`);
    this.save();
    return { success: true };
  }

  _nextPostName() {
    const used = new Set(this.state.posts.map(p => p.name.replace('Post ', '')));
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      if (!used.has(letter)) return `Post ${letter}`;
    }
    for (let i = 1; i < 200; i++) {
      const n = String(i);
      if (!used.has(n)) return `Post ${n}`;
    }
    return `Post ${Date.now()}`;
  }

  _getTierValues() {
    if (!this.state.settings.tierValues) this.state.settings.tierValues = { high: 50, low: 30 };
    return this.state.settings.tierValues;
  }

  addPost(tier) {
    const tv = this._getTierValues();
    const value = tv[tier];
    if (value == null) return { success: false, error: `Unknown tier: ${tier}` };
    const name = this._nextPostName();
    const id = `post_${name.replace('Post ', '')}_${Date.now()}`;
    this.state.posts.push({ id, name, pointValue: value, owningTeamId: null, isSecured: false, cooldownEndsAt: null });
    this.log(`Admin added ${name} (${value} pts/cycle, tier: ${tier})`);
    this.save();
    return { success: true };
  }

  deletePost(postId) {
    const post = this.getPost(postId);
    if (!post) return { success: false, error: 'Post not found' };
    this.state.posts = this.state.posts.filter(p => p.id !== postId);
    this.log(`Admin removed ${post.name}`);
    this.save();
    return { success: true };
  }

  renamePost(postId, newName) {
    const post = this.getPost(postId);
    if (!post) return { success: false, error: 'Post not found' };
    const trimmed = String(newName).trim();
    if (!trimmed) return { success: false, error: 'Name cannot be empty' };
    const oldName = post.name;
    post.name = trimmed;
    this.log(`Admin renamed ${oldName} → ${trimmed}`);
    this.save();
    return { success: true };
  }

  setTierValue(tier, newValue) {
    const tv = this._getTierValues();
    const oldValue = tv[tier];
    if (oldValue == null) return { success: false, error: `Unknown tier: ${tier}` };
    tv[tier] = newValue;
    let count = 0;
    for (const post of this.state.posts) {
      if (post.pointValue === oldValue) { post.pointValue = newValue; count++; }
    }
    this.log(`Admin set ${tier} tier value: ${oldValue} → ${newValue} pts (${count} posts updated)`);
    this.save();
    return { success: true };
  }

  updateSettings(newSettings) {
    const s = this.state.settings;

    if (newSettings.postCooldowns) Object.assign(s.postCooldowns, newSettings.postCooldowns);
    if (newSettings.actionCooldowns) Object.assign(s.actionCooldowns, newSettings.actionCooldowns);
    if (newSettings.shieldDuration != null) s.shieldDuration = newSettings.shieldDuration;

    if (newSettings.payoutInterval != null) {
      s.payoutInterval = newSettings.payoutInterval;
      this.state.nextPayoutAt = Date.now() + newSettings.payoutInterval * 60 * 1000;
    }
    if (newSettings.costs) Object.assign(s.costs, newSettings.costs);

    if (newSettings.tierValues) {
      const oldHigh = s.tierValues.high;
      const oldLow = s.tierValues.low;
      s.tierValues.high = newSettings.tierValues.high;
      s.tierValues.low = newSettings.tierValues.low;
      for (const p of this.state.posts) {
        if (p.pointValue === oldHigh) p.pointValue = s.tierValues.high;
        else if (p.pointValue === oldLow) p.pointValue = s.tierValues.low;
      }
    }

    if (Array.isArray(newSettings.teams)) {
      const existingIds = this.state.teams.map(t => t.id);
      const keptIds = newSettings.teams.map(t => t.id).filter(id => !String(id).startsWith('new_'));
      const removedIds = existingIds.filter(id => !keptIds.includes(id));

      for (const removedId of removedIds) {
        for (const post of this.state.posts) {
          if (post.owningTeamId === removedId) {
            post.owningTeamId = null;
            post.isSecured = false;
            post.cooldownEndsAt = null;
          }
        }
      }

      for (const updTeam of newSettings.teams) {
        if (String(updTeam.id).startsWith('new_')) {
          const newId = `t_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          this.state.teams.push({ id: newId, name: updTeam.name, color: updTeam.color, points: 0, hasSafe: false, safeEndsAt: null, cooldowns: { capture: 0, steal: 0, secure: 0, shield: 0, breakShield: 0, seek: 0 } });
          s.teams.push({ id: newId, name: updTeam.name, color: updTeam.color });
        } else {
          const existing = this.state.teams.find(t => t.id === updTeam.id);
          if (existing) { existing.name = updTeam.name; existing.color = updTeam.color; }
          const st = s.teams.find(t => t.id === updTeam.id);
          if (st) { st.name = updTeam.name; st.color = updTeam.color; }
        }
      }

      this.state.teams = this.state.teams.filter(t => !removedIds.includes(t.id));
      s.teams = s.teams.filter(t => !removedIds.includes(t.id));
    }

    this._normalizeCooldownAndDurationSettings();

    this.log('Admin updated game settings');
    this.save();
  }

  resetGame() {
    this.state = createDefaultState();
    this.state.timerPaused = true;
    this.state.pausedTimeRemaining = this.state.settings.payoutInterval * 60 * 1000;
    this.state.nextPayoutAt = Date.now() + this.state.pausedTimeRemaining;
    this.save();
  }

  resetPoints() {
    for (const t of this.state.teams) {
      t.points = 0;
    }
    this.state.roundCount = 0;
    this.state.timerPaused = true;
    this.state.pausedTimeRemaining = this.state.settings.payoutInterval * 60 * 1000;
    this.state.nextPayoutAt = Date.now() + this.state.pausedTimeRemaining;
    this.log('Admin reset all team points and restarted/paused the timer.');
    this.save();
  }
}

module.exports = GameState;
