const Store = require('./store');

const POST_VALUES = [30, 30, 30, 30, 40, 40, 40, 50, 50];
const POST_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const DEFAULT_SETTINGS = {
  cooldownDuration: 5,
  securedCooldownMultiplier: 2,
  payoutInterval: 30,
  costs: { steal: 50, secure: 30, safe: 40, breakSafe: 80 },
  tierValues: { high: 50, mid: 40, low: 30 },
  teams: [
    { id: 't1', name: 'Team Red', color: '#e74c3c' },
    { id: 't2', name: 'Team Blue', color: '#3498db' }
  ]
};

function createDefaultState() {
  const now = Date.now();
  return {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    teams: DEFAULT_SETTINGS.teams.map(t => ({ ...t, points: 0, hasSafe: false })),
    posts: POST_NAMES.map((name, i) => ({
      id: `post_${name}`,
      name: `Post ${name}`,
      pointValue: POST_VALUES[i],
      owningTeamId: null,
      isSecured: false,
      cooldownEndsAt: null
    })),
    nextPayoutAt: now + DEFAULT_SETTINGS.payoutInterval * 60 * 1000,
    timerPaused: false,
    pausedTimeRemaining: null,
    eventLog: []
  };
}

class GameState {
  constructor() {
    this.store = new Store();
    const loaded = this.store.load();
    this.state = loaded || createDefaultState();
    // migrate: ensure tierValues exists in settings
    if (!this.state.settings.tierValues) {
      this.state.settings.tierValues = { high: 50, mid: 40, low: 30 };
      this.store.save(this.state);
    }
  }

  getState() { return this.state; }

  save() { this.store.save(this.state); }

  log(message) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.state.eventLog.unshift({ timestamp, message });
    if (this.state.eventLog.length > 300) this.state.eventLog.length = 300;
  }

  getTeam(teamId) { return this.state.teams.find(t => t.id === teamId); }
  getPost(postId) { return this.state.posts.find(p => p.id === postId); }

  capturePost(postId, teamId) {
    const post = this.getPost(postId);
    const team = this.getTeam(teamId);
    if (!post || !team) return { success: false, error: 'Not found' };

    const now = Date.now();
    if (post.cooldownEndsAt && now < post.cooldownEndsAt) {
      const secs = Math.ceil((post.cooldownEndsAt - now) / 1000);
      return { success: false, error: `${post.name} is on cooldown for ${secs}s` };
    }

    const prevOwner = post.owningTeamId ? this.getTeam(post.owningTeamId)?.name : null;
    post.owningTeamId = teamId;
    post.isSecured = false;
    post.cooldownEndsAt = now + this.state.settings.cooldownDuration * 60 * 1000;

    const msg = prevOwner
      ? `${team.name} captured ${post.name} from ${prevOwner} (cooldown: ${this.state.settings.cooldownDuration} min)`
      : `${team.name} captured ${post.name} (cooldown: ${this.state.settings.cooldownDuration} min)`;
    this.log(msg);
    this.save();
    return { success: true };
  }

  steal(actingTeamId, targetTeamId) {
    const actor = this.getTeam(actingTeamId);
    const target = this.getTeam(targetTeamId);
    if (!actor || !target) return { success: false, error: 'Team not found' };
    if (target.hasSafe) return { success: false, error: `${target.name} has immunity. Use Break Safe first.` };

    const cost = this.state.settings.costs.steal;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    const stolen = Math.floor(target.points * 0.3);
    actor.points -= cost;
    target.points -= stolen;
    actor.points += stolen;

    this.log(`${actor.name} stole ${stolen} pts from ${target.name} (cost: ${cost} pts)`);
    this.save();
    return { success: true };
  }

  secure(actingTeamId, postId) {
    const actor = this.getTeam(actingTeamId);
    const post = this.getPost(postId);
    if (!actor || !post) return { success: false, error: 'Not found' };
    if (post.owningTeamId !== actingTeamId) return { success: false, error: 'You do not own this post' };
    if (post.isSecured) return { success: false, error: 'Post is already secured' };

    const cost = this.state.settings.costs.secure;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    post.isSecured = true;

    const now = Date.now();
    const mult = this.state.settings.securedCooldownMultiplier;
    if (post.cooldownEndsAt && now < post.cooldownEndsAt) {
      post.cooldownEndsAt = now + (post.cooldownEndsAt - now) * mult;
    } else {
      post.cooldownEndsAt = now + this.state.settings.cooldownDuration * mult * 60 * 1000;
    }

    this.log(`${actor.name} secured ${post.name} (cost: ${cost} pts, extended cooldown x${mult})`);
    this.save();
    return { success: true };
  }

  safe(actingTeamId) {
    const actor = this.getTeam(actingTeamId);
    if (!actor) return { success: false, error: 'Team not found' };
    if (actor.hasSafe) return { success: false, error: 'Already has immunity' };

    const cost = this.state.settings.costs.safe;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    actor.hasSafe = true;

    this.log(`${actor.name} activated Safe (immunity) (cost: ${cost} pts)`);
    this.save();
    return { success: true };
  }

  breakSafe(actingTeamId, targetTeamId) {
    const actor = this.getTeam(actingTeamId);
    const target = this.getTeam(targetTeamId);
    if (!actor || !target) return { success: false, error: 'Team not found' };
    if (!target.hasSafe) return { success: false, error: `${target.name} does not have immunity` };

    const cost = this.state.settings.costs.breakSafe;
    if (actor.points < cost) return { success: false, error: `Not enough points (need ${cost}, have ${actor.points})` };

    actor.points -= cost;
    target.hasSafe = false;

    this.log(`${actor.name} broke ${target.name}'s immunity (Break Safe) (cost: ${cost} pts)`);
    this.save();
    return { success: true };
  }

  processPayout() {
    const payouts = {};
    for (const post of this.state.posts) {
      if (post.owningTeamId) {
        payouts[post.owningTeamId] = (payouts[post.owningTeamId] || 0) + post.pointValue;
      }
    }

    const parts = Object.entries(payouts).map(([teamId, pts]) => {
      const team = this.getTeam(teamId);
      if (team) { team.points += pts; return `${team.name} +${pts}`; }
      return null;
    }).filter(Boolean);

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

  removeSafe(teamId) {
    const team = this.getTeam(teamId);
    if (!team) return { success: false, error: 'Team not found' };
    team.hasSafe = false;
    this.log(`Admin removed immunity from ${team.name}`);
    this.save();
    return { success: true };
  }

  _nextPostName() {
    const used = new Set(this.state.posts.map(p => p.name.replace('Post ', '')));
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      if (!used.has(letter)) return `Post ${letter}`;
    }
    // fallback to numbers
    for (let i = 1; i < 200; i++) {
      const n = String(i);
      if (!used.has(n)) return `Post ${n}`;
    }
    return `Post ${Date.now()}`;
  }

  _getTierValues() {
    // Always returns a valid tier map, migrating in-place if necessary
    if (!this.state.settings.tierValues) {
      this.state.settings.tierValues = { high: 50, mid: 40, low: 30 };
    }
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

    if (newSettings.cooldownDuration != null) s.cooldownDuration = newSettings.cooldownDuration;
    if (newSettings.securedCooldownMultiplier != null) s.securedCooldownMultiplier = newSettings.securedCooldownMultiplier;
    if (newSettings.payoutInterval != null) {
      s.payoutInterval = newSettings.payoutInterval;
      this.state.nextPayoutAt = Date.now() + newSettings.payoutInterval * 60 * 1000;
    }
    if (newSettings.costs) Object.assign(s.costs, newSettings.costs);

    if (Array.isArray(newSettings.teams)) {
      const existingIds = this.state.teams.map(t => t.id);
      const keptIds = newSettings.teams.map(t => t.id).filter(id => !String(id).startsWith('new_'));
      const removedIds = existingIds.filter(id => !keptIds.includes(id));

      // Release posts owned by removed teams
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
          this.state.teams.push({ id: newId, name: updTeam.name, color: updTeam.color, points: 0, hasSafe: false });
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

    this.log('Admin updated game settings');
    this.save();
  }

  resetGame() {
    this.state = createDefaultState();
    this.save();
  }
}

module.exports = GameState;
