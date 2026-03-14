/* global state & socket */
const socket = io();
let gs = null; // gameState
let tickInterval = null;
let newTeamCounter = 0;
let editMode = false;

// ── Socket ──────────────────────────────────────────────────────
socket.on('gameState', (state) => {
  gs = state;
  render();
});

socket.on('actionError', (msg) => showToast(msg, 'error'));

// ── Edit Mode ────────────────────────────────────────────────────
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('edit-mode-btn');
  if (editMode) {
    btn.textContent = '✏️ Editing…';
    btn.classList.add('btn-edit-active');
    btn.classList.remove('btn-secondary');
  } else {
    btn.textContent = '✏️ Edit Mode';
    btn.classList.remove('btn-edit-active');
    btn.classList.add('btn-secondary');
  }
  render();
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  if (!gs) return;
  renderPosts();
  renderTeams();
  renderEventLog();
  startTick();
}

// ── Posts ───────────────────────────────────────────────────────
function renderPosts() {
  const tv = (gs.settings.tierValues) || { high: 50, mid: 40, low: 30 };
  const groups = [
    { tier: 'high', value: tv.high, label: `🔴 High Value — ${tv.high} pts/cycle`, cls: 'post-group-50' },
    { tier: 'mid',  value: tv.mid,  label: `🟡 Mid Value — ${tv.mid} pts/cycle`,   cls: 'post-group-40' },
    { tier: 'low',  value: tv.low,  label: `🔵 Low Value — ${tv.low} pts/cycle`,   cls: 'post-group-30' },
  ];

  document.getElementById('posts-grid').innerHTML = `
    <div class="posts-groups">
      ${groups.map(g => {
        const groupPosts = gs.posts.filter(p => p.pointValue === g.value);
        return `
          <div class="post-group ${g.cls}">
            <span class="post-group-label">${g.label}</span>
            <div class="post-group-actions">
              ${editMode ? `<button class="btn btn-xs btn-success" onclick="addPost('${g.tier}')">+ Post</button>` : ''}
            </div>
            <div class="posts-grid">
              ${groupPosts.map(p => postCard(p, editMode)).join('')}
              ${groupPosts.length === 0 ? '<div style="color:var(--text-muted);font-size:0.8rem;padding:6px">No posts</div>' : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function postCard(post, showDelete = false) {
  const team = gs.teams.find(t => t.id === post.owningTeamId);
  const now = Date.now();
  const onCooldown = post.cooldownEndsAt && now < post.cooldownEndsAt;

  const borderStyle = team ? `border-color:${team.color};` : '';
  const bgStyle = team ? `background:${team.color}18;` : '';

  return `
<div class="post-card${post.isSecured ? ' secured' : ''}" style="${borderStyle}${bgStyle}">
  ${showDelete
    ? `<button class="btn-delete-corner" onclick="confirmDeletePost('${post.id}')" title="Delete post">🗑</button>`
    : ''}
  <div class="post-header">
    ${showDelete
      ? `<input class="post-name-input" value="${escHtml(post.name)}"
           onblur="renamePost('${post.id}', this.value)"
           onkeydown="if(event.key==='Enter')this.blur()">`
      : `<span class="post-name">${escHtml(post.name)}</span>`}
    <span class="post-value">${post.pointValue} pts/cycle</span>
  </div>
  <div class="post-owner">
    ${team
      ? `<span class="owner-badge" style="background:${team.color}">${escHtml(team.name)}</span>`
      : '<span class="owner-badge unowned">Unowned</span>'}
    ${post.isSecured ? '<span class="secured-badge">🔒 Secured</span>' : ''}
  </div>
  <div class="post-cooldown" id="cd-wrap-${post.id}">
    ${onCooldown
      ? `<span class="cooldown-timer" id="cd-${post.id}" data-ends="${post.cooldownEndsAt}">⏳ --:--</span>`
      : '<span class="capturable-badge">✅ Capturable</span>'}
  </div>
  ${post.isSecured
    ? `<button class="btn btn-xs btn-secondary" onclick="unsecurePost('${post.id}')">🔓 Remove Secure</button>`
    : ''}
</div>`;
}

// ── Teams ───────────────────────────────────────────────────────
function renderTeams() {
  const addBtn = editMode
    ? `<button class="btn btn-success btn-sm" style="margin-bottom:12px" onclick="openAddTeam()">➕ Add Team</button>`
    : '';
  document.getElementById('teams-grid').innerHTML =
    addBtn + gs.teams.map(teamCard).join('');
}

function teamCard(team) {
  const others = gs.teams.filter(t => t.id !== team.id);
  const ownedUnsecured = gs.posts.filter(p => p.owningTeamId === team.id && !p.isSecured);
  const now = Date.now();
  const availCapture = gs.posts.filter(p => {
    const cd = p.cooldownEndsAt && now < p.cooldownEndsAt;
    return !cd && p.owningTeamId !== team.id;
  });

  return `
<div class="team-card">
  ${editMode && gs.teams.length > 1 ? `<button class="btn-delete-corner" onclick="confirmDeleteTeam('${team.id}')" title="Delete team">🗑</button>` : ''}
  <div class="team-header" style="background:${team.color}">
    <span>${escHtml(team.name)}</span>
    <div style="display:flex;gap:6px;align-items:center">
      ${team.hasSafe ? '<span class="safe-badge">🛡️ Immune</span>' : ''}
      ${team.hasSafe ? `<button class="btn btn-xs btn-secondary" onclick="removeShield('${team.id}')">✕ Remove</button>` : ''}
    </div>
  </div>
  <div class="team-body">
    <div class="team-points">
      <span class="points-label">Points:</span>
      <span class="points-value" style="color:${team.color}">${team.points}</span>
    </div>

    <div class="actions-section">
      <h4>Actions</h4>

      <!-- Capture -->
      <div class="action-row">
        <button class="btn btn-success btn-xs" onclick="capturePost('${team.id}')">🚩 Capture</button>
        <select class="action-select" id="cap-${team.id}">
          <option value="">— select post —</option>
          ${availCapture.map(p => {
            const owner = gs.teams.find(t2 => t2.id === p.owningTeamId);
            return `<option value="${p.id}">${p.name} (${p.pointValue}pts)${owner ? ' · ' + escHtml(owner.name) : ' · Unowned'}</option>`;
          }).join('')}
        </select>
      </div>

      <!-- Steal -->
      <div class="action-row">
        <button class="btn btn-warning btn-xs" onclick="steal('${team.id}')">💸 Steal (${gs.settings.costs.steal}pts)</button>
        <select class="action-select" id="steal-${team.id}">
          <option value="">— target team —</option>
          ${others.map(t => `<option value="${t.id}">${escHtml(t.name)} (${t.points}pts)${t.hasSafe ? ' 🛡️' : ''}</option>`).join('')}
        </select>
      </div>

      <!-- Secure -->
      <div class="action-row">
        <button class="btn btn-info btn-xs" onclick="securePost('${team.id}')">🔒 Secure (${gs.settings.costs.secure}pts)</button>
        <select class="action-select" id="sec-${team.id}">
          <option value="">— select post —</option>
          ${ownedUnsecured.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>

      <!-- Shield -->
      <div class="action-row">
        <button class="btn btn-primary btn-xs" onclick="activateShield('${team.id}')" ${team.hasSafe ? 'disabled' : ''}>
          🛡️ Shield (${gs.settings.costs.safe}pts)${team.hasSafe ? ' · Active' : ''}
        </button>
      </div>

      <!-- Break Shield -->
      <div class="action-row">
        <button class="btn btn-danger btn-xs" onclick="breakShield('${team.id}')">⚔️ Break Shield (${gs.settings.costs.breakSafe}pts)</button>
        <select class="action-select" id="bs-${team.id}">
          <option value="">— immune team —</option>
          ${others.filter(t => t.hasSafe).map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="adjust-section">
      <h4>Manual Adjust</h4>
      <div class="adjust-quick">
        ${[-100,-10,-1,1,10,100].map(n =>
          `<button class="btn btn-xs ${n<0?'btn-danger':'btn-success'}" onclick="quickAdjust('${team.id}',${n})">${n>0?'+':''}${n}</button>`
        ).join('')}
      </div>
      <div class="adjust-custom">
        <input type="number" id="adj-${team.id}" class="adjust-input" placeholder="Amount">
        <button class="btn btn-sm btn-secondary" onclick="customAdjust('${team.id}')">Apply</button>
      </div>
    </div>
  </div>
</div>`;
}

// ── Event Log ────────────────────────────────────────────────────
function renderEventLog() {
  const el = document.getElementById('event-log');
  if (!gs.eventLog.length) {
    el.innerHTML = '<p class="log-empty">No events yet.</p>';
    return;
  }
  el.innerHTML = gs.eventLog.map(e =>
    `<div class="log-entry"><span class="log-time">${e.timestamp}</span><span class="log-msg">${escHtml(e.message)}</span></div>`
  ).join('');
}

// ── Countdown Tick ───────────────────────────────────────────────
function startTick() {
  if (tickInterval) return; // already running
  tickInterval = setInterval(tick, 500);
  tick();
}

function tick() {
  if (!gs) return;
  const now = Date.now();

  // Payout countdown
  const pcEl = document.getElementById('payout-countdown');
  if (pcEl) {
    const rem = gs.timerPaused
      ? gs.pausedTimeRemaining
      : Math.max(0, gs.nextPayoutAt - now);
    pcEl.textContent = gs.timerPaused ? '⏸ ' + fmtTime(rem) : fmtTime(rem);
    pcEl.style.color = gs.timerPaused ? '#8b949e' : (rem < 60000 ? '#f85149' : '#f0c040');
  }

  // Pause button label
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = gs.timerPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.className = gs.timerPaused ? 'btn btn-success btn-sm' : 'btn btn-secondary btn-sm';
  }

  // Post cooldowns
  gs.posts.forEach(post => {
    const cdEl = document.getElementById(`cd-${post.id}`);
    if (!cdEl) return;
    const rem = Math.max(0, post.cooldownEndsAt - now);
    if (rem === 0) {
      const wrap = document.getElementById(`cd-wrap-${post.id}`);
      if (wrap) wrap.innerHTML = '<span class="capturable-badge">✅ Capturable</span>';
    } else {
      cdEl.textContent = `⏳ ${fmtTime(rem)}`;
    }
  });
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// ── Actions ──────────────────────────────────────────────────────
function capturePost(teamId) {
  const postId = document.getElementById(`cap-${teamId}`).value;
  if (!postId) { showToast('Select a post to capture', 'warn'); return; }
  const team = gs.teams.find(t => t.id === teamId);
  const post = gs.posts.find(p => p.id === postId);
  confirmAction(`Capture ${post.name} for ${team.name}?`,
    () => socket.emit('capturePost', { postId, teamId }));
}

function steal(actingTeamId) {
  const targetId = document.getElementById(`steal-${actingTeamId}`).value;
  if (!targetId) { showToast('Select a target team', 'warn'); return; }
  const actor = gs.teams.find(t => t.id === actingTeamId);
  const target = gs.teams.find(t => t.id === targetId);
  const approx = Math.floor(target.points * 0.3);
  const cost = gs.settings.costs.steal;
  confirmAction(`Steal ~${approx} pts from ${target.name}?\nCost: ${cost} pts from ${actor.name}`,
    () => socket.emit('steal', { actingTeamId, targetTeamId: targetId }));
}

function securePost(actingTeamId) {
  const postId = document.getElementById(`sec-${actingTeamId}`).value;
  if (!postId) { showToast('Select a post to secure', 'warn'); return; }
  const team = gs.teams.find(t => t.id === actingTeamId);
  const post = gs.posts.find(p => p.id === postId);
  const cost = gs.settings.costs.secure;
  confirmAction(`Secure ${post.name} for ${team.name}?\nCost: ${cost} pts`,
    () => socket.emit('secure', { actingTeamId, postId }));
}

function activateShield(actingTeamId) {
  const team = gs.teams.find(t => t.id === actingTeamId);
  const cost = gs.settings.costs.safe;
  confirmAction(`Activate Shield (immunity) for ${team.name}?\nCost: ${cost} pts`,
    () => socket.emit('shield', { actingTeamId }));
}

function breakShield(actingTeamId) {
  const targetId = document.getElementById(`bs-${actingTeamId}`).value;
  if (!targetId) { showToast('No immune team selected', 'warn'); return; }
  const actor = gs.teams.find(t => t.id === actingTeamId);
  const target = gs.teams.find(t => t.id === targetId);
  const cost = gs.settings.costs.breakSafe;
  confirmAction(`Break ${target.name}'s immunity?\nCost: ${cost} pts from ${actor.name}`,
    () => socket.emit('breakShield', { actingTeamId, targetTeamId: targetId }));
}

function unsecurePost(postId) {
  const post = gs.posts.find(p => p.id === postId);
  confirmAction(`Remove Secured status from ${post.name}? (Admin override)`,
    () => socket.emit('unsecurePost', { postId }));
}

function removeShield(teamId) {
  const team = gs.teams.find(t => t.id === teamId);
  confirmAction(`Remove immunity (Shield) from ${team.name}? (Admin override)`,
    () => socket.emit('removeShield', { teamId }));
}

function addPost(tier) {
  socket.emit('addPost', { tier });
}

function confirmDeletePost(postId) {
  const post = gs.posts.find(p => p.id === postId);
  confirmAction(`Delete ${post.name}? This cannot be undone.`,
    () => socket.emit('deletePost', { postId }));
}

function renamePost(postId, newName) {
  const post = gs.posts.find(p => p.id === postId);
  const trimmed = newName.trim();
  if (!trimmed || trimmed === post.name) return; // no change
  socket.emit('renamePost', { postId, newName: trimmed });
}

function confirmDeleteTeam(teamId) {
  const team = gs.teams.find(t => t.id === teamId);
  confirmAction(`Delete ${team.name}? Their posts will be released.`,
    () => {
      const remaining = gs.settings.teams.filter(t => t.id !== teamId);
      socket.emit('updateSettings', { teams: remaining });
    });
}

function triggerPayout() {
  confirmAction('Trigger point payout now?', () => socket.emit('manualPayout'));
}

function resetTimer() {
  confirmAction('Reset the payout timer?', () => socket.emit('resetTimer'));
}

function togglePause() {
  if (gs.timerPaused) {
    socket.emit('resumeTimer');
  } else {
    socket.emit('pauseTimer');
  }
}

function quickAdjust(teamId, amount) {
  const team = gs.teams.find(t => t.id === teamId);
  const sign = amount > 0 ? '+' : '';
  confirmAction(`Adjust ${team.name} points by ${sign}${amount}?`,
    () => socket.emit('adjustPoints', { teamId, amount }));
}

function customAdjust(teamId) {
  const input = document.getElementById(`adj-${teamId}`);
  const amount = parseInt(input.value, 10);
  if (isNaN(amount)) { showToast('Enter a valid number', 'warn'); return; }
  const team = gs.teams.find(t => t.id === teamId);
  const sign = amount > 0 ? '+' : '';
  confirmAction(`Adjust ${team.name} points by ${sign}${amount}?`,
    () => { socket.emit('adjustPoints', { teamId, amount }); input.value = ''; });
}

function confirmResetGame() {
  confirmAction('⚠️ RESET ALL GAME DATA? This cannot be undone!',
    () => socket.emit('resetGame'));
}

// ── Settings ─────────────────────────────────────────────────────
function openSettings() {
  const s = gs.settings;
  const tv = s.tierValues || { high: 50, mid: 40, low: 30 };
  document.getElementById('settings-body').innerHTML = `
    <div class="settings-section">
      <h3>Post Tier Values (pts/cycle)</h3>
      <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">Changing a tier value updates ALL posts in that tier immediately.</p>
      <label>🔴 High Value posts
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="tv-high" value="${tv.high}" min="1" style="width:80px">
          <button class="btn btn-xs btn-warning" onclick="applyTierValue('high')">Apply</button>
        </div>
      </label>
      <label>🟡 Mid Value posts
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="tv-mid" value="${tv.mid}" min="1" style="width:80px">
          <button class="btn btn-xs btn-warning" onclick="applyTierValue('mid')">Apply</button>
        </div>
      </label>
      <label>🔵 Low Value posts
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" id="tv-low" value="${tv.low}" min="1" style="width:80px">
          <button class="btn btn-xs btn-warning" onclick="applyTierValue('low')">Apply</button>
        </div>
      </label>
    </div>

    <div class="settings-section">
      <h3>Teams (rename / recolor)</h3>
      <div id="team-settings-list">
        ${gs.teams.map(t => `
          <div class="team-setting-row" data-tid="${t.id}">
            <input type="text"  class="team-name-input adjust-input" style="flex:1" value="${escHtml(t.name)}" placeholder="Team Name">
            <input type="color" class="team-color-input" value="${t.color}">
          </div>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <h3>Timers</h3>
      <label>Capture Cooldown (min) <input type="number" id="s-cd" value="${s.cooldownDuration}" min="1" max="120"></label>
      <label>Secured Cooldown Multiplier <input type="number" id="s-mult" value="${s.securedCooldownMultiplier}" min="1" max="10" step="0.5"></label>
      <label>Payout Interval (min) <input type="number" id="s-pi" value="${s.payoutInterval}" min="1" max="120"></label>
    </div>

    <div class="settings-section">
      <h3>Action Costs (pts)</h3>
      <label>Steal          <input type="number" id="s-steal"    value="${s.costs.steal}"    min="0"></label>
      <label>Secure         <input type="number" id="s-secure"   value="${s.costs.secure}"   min="0"></label>
      <label>Shield         <input type="number" id="s-safe"     value="${s.costs.safe}"     min="0"></label>
      <label>Break Shield   <input type="number" id="s-breaksafe" value="${s.costs.breakSafe}" min="0"></label>
    </div>`;
  document.getElementById('settings-modal').classList.remove('hidden');
}

function applyTierValue(tier) {
  const input = document.getElementById(`tv-${tier}`);
  const newValue = parseInt(input.value, 10);
  if (isNaN(newValue) || newValue < 1) { showToast('Enter a valid point value', 'warn'); return; }
  const tv = gs.settings.tierValues || { high: 50, mid: 40, low: 30 };
  const label = tier === 'high' ? '🔴 High' : tier === 'mid' ? '🟡 Mid' : '🔵 Low';
  confirmAction(`Set ${label} tier to ${newValue} pts/cycle?\nAll posts in this tier will be updated.`,
    () => socket.emit('setTierValue', { tier, newValue }));
}

function saveSettings() {
  const rows = document.querySelectorAll('.team-setting-row');
  const teams = Array.from(rows).map(r => ({
    id: r.dataset.tid,
    name: r.querySelector('.team-name-input').value.trim(),
    color: r.querySelector('.team-color-input').value
  })).filter(t => t.name);

  socket.emit('updateSettings', {
    teams,
    cooldownDuration: parseFloat(document.getElementById('s-cd').value),
    securedCooldownMultiplier: parseFloat(document.getElementById('s-mult').value),
    payoutInterval: parseFloat(document.getElementById('s-pi').value),
    costs: {
      steal:     parseInt(document.getElementById('s-steal').value, 10),
      secure:    parseInt(document.getElementById('s-secure').value, 10),
      safe:      parseInt(document.getElementById('s-safe').value, 10),
      breakSafe: parseInt(document.getElementById('s-breaksafe').value, 10)
    }
  });
  closeSettings();
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  newTeamCounter = 0;
}

function modalBackdropClick(e, id) {
  if (e.target === document.getElementById(id)) {
    if (id === 'add-team-modal') closeAddTeam();
    else closeSettings();
  }
}

// ── Add Team Modal ────────────────────────────────────────────────
function openAddTeam() {
  document.getElementById('new-team-name').value = '';
  document.getElementById('add-team-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('new-team-name').focus(), 50);
}

function closeAddTeam() {
  document.getElementById('add-team-modal').classList.add('hidden');
}

function submitAddTeam() {
  const name = document.getElementById('new-team-name').value.trim();
  const color = document.getElementById('new-team-color').value;
  if (!name) { showToast('Enter a team name', 'warn'); return; }
  const existing = gs.settings.teams.map(t => ({ id: t.id, name: t.name, color: t.color }));
  existing.push({ id: `new_1`, name, color });
  socket.emit('updateSettings', { teams: existing });
  closeAddTeam();
}

// ── Confirm Modal ────────────────────────────────────────────────
let _confirmCb = null;

function confirmAction(msg, cb) {
  document.getElementById('confirm-message').textContent = msg;
  _confirmCb = cb;
  const okBtn = document.getElementById('confirm-ok');
  okBtn.onclick = () => { closeConfirm(); cb(); };
  document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.add('hidden');
  _confirmCb = null;
}

// ── Toasts ───────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 350);
  }, 3500);
}

// ── Helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
