/* global state & socket */
const socket = io();
let gs = null; // gameState
let tickInterval = null;
let newTeamCounter = 0;
let editMode = false;
let authUser = null; // null if not logged in
let draggingLocationTeamId = null;

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
  renderTeamLocations();
  renderRecoveryStatus();
  if (authUser) {
    renderEventLog();
    renderRequests();
  }
  startTick();
}

// ── Posts ───────────────────────────────────────────────────────
function renderPosts() {
  const allPosts = gs.posts || [];
  const maxTeamsAtAnyPost = allPosts.length
    ? Math.max(...allPosts.map((post) => gs.teams.filter((t) => t.currentLocationPostId === post.id).length))
    : 0;
  const longestHouseLabel = gs.teams && gs.teams.length
    ? Math.max(...gs.teams.map((t) => fullTeamLabel(t.name).length))
    : 0;
  const markerPressure = (maxTeamsAtAnyPost * 8) + (Math.max(0, longestHouseLabel - 7) * 3);
  const radius = allPosts.length <= 1 ? 0 : Math.max(170 + markerPressure, allPosts.length * 45 + Math.floor(markerPressure / 2)); // adaptive spacing
  const minHeight = allPosts.length === 0 ? '50px' : (radius * 2 + 150) + 'px';
  const boardActions = editMode
    ? `
      <button class="btn btn-sm btn-danger" onclick="addPost('high')" style="background:#8b0000">+ Add High Value</button>
      <button class="btn btn-sm btn-info" onclick="addPost('low')" style="background:#004080">+ Add Low Value</button>
    `
    : '';

  const actionsEl = document.getElementById('post-board-actions');
  if (actionsEl) actionsEl.innerHTML = boardActions;

  document.getElementById('posts-grid').innerHTML = `
    <div class="posts-groups" style="justify-content:center">
      <div class="post-group" style="width: 100%; border:none; padding:0; display:flex; flex-direction:column; align-items:center;">
        <div class="posts-circular" style="--count: ${allPosts.length}; min-height: ${minHeight}; margin-top: 28px;">
          ${allPosts.map((p, i) => postCard(p, editMode, i, allPosts.length)).join('')}
          ${allPosts.length === 0 ? '<div style="color:var(--text-muted);font-size:0.8rem;padding:6px;text-align:center">No posts</div>' : ''}
        </div>
      </div>
    </div>`;
}

function postCard(post, showDelete = false, index = 0, total = 1) {
  const team = gs.teams.find(t => t.id === post.owningTeamId);
  const tv = gs.settings.tierValues || { high: 50, low: 30 };
  const now = getEffectiveNow();
  const onCooldown = post.cooldownEndsAt && now < post.cooldownEndsAt;
  const isAdmin = authUser && authUser.role === 'admin';

  const isHigh = post.pointValue === tv.high;
  // Solid colors as requested
  const bgStyle = isHigh ? 'background:#8b0000; color:#fff;' : 'background:#004080; color:#fff;';
  const postBorder = team ? team.color : (isHigh ? '#ff8888' : '#88ccff');
  const borderWidth = team ? '4px' : '2px';
  const shadow = team ? `box-shadow: 0 0 12px ${team.color};` : '';
  const teamsAtPost = gs.teams.filter(t => t.currentLocationPostId === post.id);
  const baseOrbitRadius = 108;
  
  // Calculate angle for circular layout (in degrees)
  const angle = total > 1 ? (index * 360 / total) : 0;
  const radius = total <= 1 ? 0 : Math.max(160, total * 45); // match container spacing

  return `
<div class="post-card${post.isSecured ? ' secured' : ''}" style="border: ${borderWidth} solid ${postBorder}; ${bgStyle} ${shadow} --angle: ${angle}deg; --radius: ${radius}px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 12px; gap: 8px;" data-angle="${angle}" data-post-id="${post.id}" ondragover="handleLocationDragOver(event, '${post.id}')" ondragleave="handleLocationDragLeave(event)" ondrop="handleLocationDrop(event, '${post.id}')">
  ${showDelete
    ? `<button class="btn-delete-corner" onclick="confirmDeletePost('${post.id}')" title="Delete post">🗑</button>`
    : ''}
  <div class="post-header" style="flex-direction: column; justify-content: center; width: 100%; border-bottom: none; margin-bottom: 0;">
    ${showDelete
      ? `<input class="post-name-input" style="text-align:center; font-weight:bold; font-size:1.1rem; width:100%; margin-bottom:4px;" value="${escHtml(post.name)}"
           onblur="renamePost('${post.id}', this.value)"
           onkeydown="if(event.key==='Enter')this.blur()">`
      : `<div class="post-name" style="font-weight:bold; font-size:1.1rem; margin-bottom:4px;">${escHtml(post.name)}</div>`}
    <div class="post-value" style="font-size:0.9rem; opacity:0.9;">${post.pointValue} pts/cycle</div>
  </div>
  <div class="post-owner" style="display:flex; flex-direction:column; align-items:center; gap:6px;">
    ${team
      ? `<span class="owner-badge" style="background:${team.color}; padding:4px 8px; border-radius:4px;">${escHtml(team.name)}</span>`
      : '<span class="owner-badge unowned" style="padding:4px 8px; border-radius:4px;">Unowned</span>'}
    ${post.isSecured ? `<span class="secured-badge" id="sec-badge-${post.id}">🔒 Secured</span>` : ''}
  </div>
  ${isAdmin && post.owningTeamId ? `<button class="btn btn-xs btn-secondary" style="margin-top: 6px;" onclick="removePostOwnership('${post.id}')">🏳 Remove Owner</button>` : ''}
  <div class="post-cooldown" id="cd-wrap-${post.id}" style="margin-top: 4px;">
    ${onCooldown && !post.isSecured
      ? `<span class="cooldown-timer" id="cd-${post.id}" data-ends="${post.cooldownEndsAt}">⏳ --:--</span>`
      : (!post.isSecured ? '<span class="capturable-badge" style="background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px;">✅ Capturable</span>' : '')}
  </div>
  ${isAdmin && post.cooldownEndsAt ? `<button class="btn btn-xs btn-secondary" style="margin-top: 6px;" onclick="clearPostCooldown('${post.id}')">⌛ Clear Timer</button>` : ''}
  ${post.isSecured && authUser
    ? `<button class="btn btn-xs btn-secondary" style="margin-top: 6px;" onclick="unsecurePost('${post.id}')">🔓 Remove Secure</button>`
    : ''}
  <div class="post-team-orbit${teamsAtPost.length ? '' : ' hidden'}">
    ${teamsAtPost.map((t, idx) => {
      const count = Math.max(teamsAtPost.length, 1);
      const angle = -90 + (idx * 360 / count);
      const lane = Math.floor(idx / 12);
      const orbitRadius = baseOrbitRadius + lane * 16;
      return `<div class="post-team-marker" style="--orbit-angle:${angle}deg; --orbit-radius:${orbitRadius}px; --team-color:${t.color}; --team-color-soft:${hexToRgba(t.color, 0.28)}; --team-color-glow:${hexToRgba(t.color, 0.45)};" title="${escHtml(t.name)}">
        <span class="post-team-marker-name">${escHtml(fullTeamLabel(t.name))}</span>
        ${authUser ? `<button class="post-team-marker-clear" onclick="clearTeamLocation('${t.id}')" title="Set ${escHtml(t.name)} to idle">×</button>` : ''}
      </div>`;
    }).join('')}
  </div>
</div>`;
}

function fullTeamLabel(name) {
  const cleaned = String(name || '').replace(/^House\s+/i, '').trim();
  return cleaned || 'Team';
}

function hexToRgba(hex, alpha) {
  const cleaned = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return `rgba(80, 100, 130, ${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Teams ───────────────────────────────────────────────────────
function renderTeams() {
  const addBtn = editMode
    ? `<button class="btn btn-success btn-sm" style="margin-bottom:12px" onclick="openAddTeam()">➕ Add Team</button>`
    : '';
  document.getElementById('teams-grid').innerHTML =
    addBtn + gs.teams.map(teamCard).join('');
  syncAllCaptureTargets();
}

function teamCard(team) {
  const isLogged = !!authUser;
  const isAdmin = authUser && authUser.role === 'admin';
  const isHelper = authUser && authUser.role === 'helper';
  const others = gs.teams.filter(t => t.id !== team.id);
  const ownedUnsecured = gs.posts.filter(p => p.owningTeamId === team.id && !p.isSecured);
  const shieldActiveRem = getShieldActiveRemainingMs(team);
  const shieldCooldownRem = getShieldCooldownRemainingMs(team);
  const shieldActive = team.hasSafe && shieldActiveRem > 0;
  const shieldInCooldown = shieldCooldownRem > 0;
  const canSeek = others.length >= 2;
  const secureBlockers = getSecureBlockers(team.id);
  const secureBlocked = secureBlockers.length > 0;
  const secureBlockedBy = secureBlockers.map(t => t.name).join(', ');
  const now = Date.now();
  const availCapture = gs.posts;

  return `
<div class="team-card">
  ${editMode && gs.teams.length > 1 && isLogged ? `<button class="btn-delete-corner" onclick="confirmDeleteTeam('${team.id}')" title="Delete team">🗑</button>` : ''}
  <div class="team-header" style="background:${team.color}">
    <span>${escHtml(team.name)}</span>
    <div style="display:flex;gap:6px;align-items:center">
      ${shieldActive ? '<span class="safe-badge safe-badge-active">🛡️ Active</span>' : ''}
      ${shieldInCooldown && !shieldActive ? '<span class="safe-badge">Shield Cooldown</span>' : ''}
      ${isLogged && shieldActive ? `<button class="btn btn-xs btn-secondary" onclick="removeShield('${team.id}')">✕ Remove</button>` : ''}
      ${isAdmin ? `<button class="btn btn-xs btn-secondary" onclick="clearTeamTimers('${team.id}')">⌛ Clear Timers</button>` : ''}
    </div>
  </div>
  <div class="team-body">
    <div class="team-points">
      <span class="points-label">Points:</span>
      <span class="points-value" style="color:${team.color}">${team.points}</span>
      <div class="shield-timers">
        <span id="shield-active-chip-${team.id}" class="shield-chip${shieldActive ? '' : ' hidden'}">🛡️ ${fmtTime(shieldActiveRem)}</span>
        <span id="shield-cooldown-chip-${team.id}" class="shield-chip shield-chip-cooldown${shieldInCooldown ? '' : ' hidden'}">⏳ Shield Cooldown ${fmtTime(shieldCooldownRem)}</span>
      </div>
    </div>

    ${isLogged ? `
    <div class="actions-section">
      <h4>${isHelper ? 'Request Actions' : 'Actions'}</h4>

      <!-- Capture -->
      <div class="action-row">
        <button id="btn-capture-${team.id}" class="btn btn-success btn-xs" data-orig="🚩 Capture" onclick="capturePost('${team.id}')">🚩 Capture</button>
        <select class="action-select" id="cap-${team.id}" onchange="syncAllCaptureTargets()">
          <option value="">— select post —</option>
          ${availCapture.map(p => {
            const owner = gs.teams.find(t2 => t2.id === p.owningTeamId);
            return `<option value="${p.id}">${p.name} (${p.pointValue}pts)${owner ? ' · ' + escHtml(owner.name) : ' · Unowned'}</option>`;
          }).join('')}
        </select>
      </div>

      <!-- Steal -->
      <div class="action-row">
        <button id="btn-steal-${team.id}" class="btn btn-warning btn-xs" data-orig="💸 Steal (${gs.settings.costs.steal}pts)" onclick="steal('${team.id}')">💸 Steal (${gs.settings.costs.steal}pts)</button>
        <select class="action-select" id="steal-${team.id}">
          <option value="">— target team —</option>
          ${others.map(t => `<option value="${t.id}">${escHtml(t.name)} (${t.points}pts)${t.hasSafe ? ' 🛡️' : ''}</option>`).join('')}
        </select>
      </div>

      <!-- Secure -->
      <div class="action-row">
        <button id="btn-secure-${team.id}" class="btn btn-info btn-xs" data-orig="🔒 Secure (50% pts)" onclick="securePost('${team.id}')" ${secureBlocked ? 'disabled' : ''}> 🔒 Secure (50% pts)</button>
        <select class="action-select" id="sec-${team.id}">
          <option value="">— select post —</option>
          ${ownedUnsecured.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>
      ${secureBlocked ? `<div class="action-hint action-hint-warn">Secure blocked: ${escHtml(secureBlockedBy)} is capturing your post.</div>` : ''}

      <!-- Shield -->
      <div class="action-row">
        <button id="btn-shield-${team.id}" class="btn btn-primary btn-xs" data-orig="🛡️ Shield (${gs.settings.costs.safe}pts)" onclick="activateShield('${team.id}')" ${shieldActive || shieldInCooldown ? 'disabled' : ''}>
          🛡️ Shield (${gs.settings.costs.safe}pts)
        </button>
      </div>

      <!-- Seek -->
      <div class="action-row">
        <button id="btn-seek-${team.id}" class="btn btn-seek btn-xs" data-orig="🔎 Seek (${gs.settings.costs.seek || 0}pts)" onclick="seek('${team.id}')" ${canSeek ? '' : 'disabled'}>${canSeek ? `🔎 Seek (${gs.settings.costs.seek || 0}pts)` : '🔎 Seek (need 2 opponents)'}</button>
        <select class="action-select" id="seek1-${team.id}" onchange="syncSeekTargets('${team.id}')" ${canSeek ? '' : 'disabled'}>
          <option value="">— target team 1 —</option>
          ${others.map(t => `<option value="${t.id}">${escHtml(t.name)} (${t.points}pts)</option>`).join('')}
        </select>
        <select class="action-select" id="seek2-${team.id}" ${canSeek ? '' : 'disabled'}>
          <option value="">— target team 2 —</option>
          ${others.map(t => `<option value="${t.id}">${escHtml(t.name)} (${t.points}pts)</option>`).join('')}
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
    ` : ''}
  </div>
</div>`;
}

function renderTeamLocations() {
  const wrap = document.getElementById('team-locations-list');
  if (!wrap || !gs || !Array.isArray(gs.teams)) return;
  const canDragLocation = !!authUser;

  const teamsForDisplay = [...gs.teams].sort((a, b) => {
    const aCapturing = !!a.captureTargetTeamId;
    const bCapturing = !!b.captureTargetTeamId;
    if (aCapturing !== bCapturing) return aCapturing ? -1 : 1;

    const aLocated = !!a.currentLocationPostId;
    const bLocated = !!b.currentLocationPostId;
    if (aLocated !== bLocated) return aLocated ? -1 : 1;

    return a.name.localeCompare(b.name);
  });

  const rows = teamsForDisplay.map((team) => {
    const locationPost = gs.posts.find(p => p.id === team.currentLocationPostId);
    const targetTeam = gs.teams.find(t => t.id === team.captureTargetTeamId);

    let status = 'Idle';
    if (locationPost && targetTeam) {
      status = `At ${locationPost.name} (capturing ${targetTeam.name})`;
    } else if (locationPost) {
      status = `At ${locationPost.name}`;
    }

    return `
      <div class="location-row${canDragLocation ? ' location-row-draggable' : ''}" ${canDragLocation ? `draggable="true" ondragstart="startLocationDrag(event, '${team.id}')" ondragend="endLocationDrag(event)"` : ''}>
        <span class="location-team"><span class="location-dot" style="background:${team.color}"></span>${escHtml(team.name)}${canDragLocation ? ' ⋮⋮' : ''}</span>
        <span class="location-status">${escHtml(status)}</span>
      </div>
    `;
  }).join('');

  wrap.innerHTML = rows || '<p class="log-empty">No team locations yet.</p>';
}

function startLocationDrag(event, teamId) {
  draggingLocationTeamId = teamId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', teamId);
}

function endLocationDrag() {
  draggingLocationTeamId = null;
  document.querySelectorAll('.post-card.post-drop-target').forEach((el) => el.classList.remove('post-drop-target'));
}

function handleLocationDragOver(event) {
  if (!draggingLocationTeamId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('post-drop-target');
}

function handleLocationDragLeave(event) {
  event.currentTarget.classList.remove('post-drop-target');
}

function handleLocationDrop(event, postId) {
  if (!draggingLocationTeamId) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.classList.remove('post-drop-target');
  socket.emit('setTeamLocation', { teamId: draggingLocationTeamId, postId });
  draggingLocationTeamId = null;
}

function getSecureBlockers(teamId) {
  if (!gs || !Array.isArray(gs.teams)) return [];
  return gs.teams.filter(t => t.id !== teamId && t.captureTargetTeamId === teamId);
}

// ── Event Log & Requests ─────────────────────────────────────────

function renderRequests() {
  const el = document.getElementById('requests-list');
  const container = document.getElementById('requests-section');
  if (!el || !container || !gs.requestsQueue) return;
  
  if (authUser && (authUser.role === 'admin' || authUser.role === 'helper')) {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
    return;
  }

  if (!gs.requestsQueue.length) {
    el.innerHTML = '<p class="log-empty">No pending requests.</p>';
    return;
  }

  const canModerateRequests = authUser && (authUser.role === 'admin' || authUser.role === 'helper');
  el.innerHTML = gs.requestsQueue.map(req => `
    <div style="background:var(--bg2); border:1px solid var(--border); padding:10px; border-radius:var(--radius); font-size:0.9rem;">
      <div style="font-weight:bold; margin-bottom:4px; color:var(--blue);">${escHtml(req.actionName)}</div>
      <div style="color:var(--text-muted); margin-bottom:8px;">${escHtml(req.payloadStr)} (Req by: ${escHtml(req.username)})</div>
      <div style="display:flex; gap:6px;">
        ${canModerateRequests ? `<button class="btn btn-success btn-xs" onclick="approveRequest('${req.id}')">✔ Approve</button>` : ''}
        ${canModerateRequests ? `<button class="btn btn-danger btn-xs" onclick="rejectRequest('${req.id}')">✖ Reject</button>` : ''}
        ${authUser && authUser.role !== 'admin' ? `<button class="btn btn-warning btn-xs" onclick="cancelRequest('${req.id}')">Cancel Request</button>` : ''}
      </div>
    </div>
  `).join('');
}

function approveRequest(id) { socket.emit('approveRequest', { id }); }
function rejectRequest(id) { socket.emit('rejectRequest', { id }); }
function cancelRequest(id) { socket.emit('cancelRequest', { id }); }

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
  const now = getEffectiveNow();

  // Payout countdown
  const pcEl = document.getElementById('payout-countdown');
  if (pcEl) {
    const rem = gs.timerPaused
      ? gs.pausedTimeRemaining
      : Math.max(0, gs.nextPayoutAt - now);
    pcEl.textContent = gs.timerPaused ? '⏸ ' + fmtTime(rem) : fmtTime(rem);
    pcEl.style.color = gs.timerPaused ? '#8b949e' : (rem < 60000 ? '#f85149' : '#f0c040');
  }

  const roundsEl = document.getElementById('round-counter');
  if (roundsEl) {
    roundsEl.textContent = `Rounds: ${gs.roundCount || 0}`;
  }

  // Pause button label
  const pauseBtn = document.getElementById('pause-btn');
  if (pauseBtn) {
    pauseBtn.textContent = gs.timerPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.className = gs.timerPaused ? 'btn btn-success btn-sm' : 'btn btn-secondary btn-sm';
  }

  // Post cooldowns
  gs.posts.forEach(post => {
    const rem = Math.max(0, post.cooldownEndsAt - now);
    
    if (post.isSecured) {
      const secBadge = document.getElementById(`sec-badge-${post.id}`);
      if (secBadge && rem > 0) {
        secBadge.innerHTML = `🔒 Secured (⏳ ${fmtTime(rem)})`;
      }
    }

    const cdEl = document.getElementById(`cd-${post.id}`);
    if (!cdEl) return;
    if (rem === 0 && !post.isSecured) {
      const wrap = document.getElementById(`cd-wrap-${post.id}`);
      if (wrap) wrap.innerHTML = '<span class="capturable-badge">✅ Capturable</span>';
    } else if (!post.isSecured) {
      cdEl.textContent = `⏳ ${fmtTime(rem)}`;
    }
  });

  // Action cooldowns
  gs.teams.forEach(t => {
    const secureBlocked = getSecureBlockers(t.id).length > 0;
    ['capture', 'steal', 'secure', 'shield', 'seek'].forEach(act => {
      const btn = document.getElementById(`btn-${act}-${t.id}`);
      if (btn) {
        const cdEnds = t.cooldowns?.[act] || 0;
        const rem = Math.max(0, cdEnds - now);
        const orig = btn.dataset.orig || '';
        const shieldActiveRem = getShieldActiveRemainingMs(t);
        const shieldCooldownRem = getShieldCooldownRemainingMs(t);
        const shieldActive = t.hasSafe && shieldActiveRem > 0;
        const shieldInCooldown = shieldCooldownRem > 0;

        if (act === 'shield') {
          btn.textContent = orig;
          btn.disabled = shieldActive || shieldInCooldown || rem > 0;
        } else if (act === 'secure') {
          if (rem > 0) {
            btn.textContent = `${orig} (⏳ ${fmtTime(rem)})`;
            btn.disabled = true;
          } else {
            btn.textContent = orig;
            btn.disabled = secureBlocked;
          }
        } else if (rem > 0) {
          btn.textContent = `${orig} (⏳ ${fmtTime(rem)})`;
          btn.disabled = true;
        } else {
          btn.textContent = orig;
          btn.disabled = false;
        }
      }
    });

    const shieldActiveChip = document.getElementById(`shield-active-chip-${t.id}`);
    if (shieldActiveChip) {
      const shieldActiveRem = getShieldActiveRemainingMs(t);
      const shieldActive = t.hasSafe && shieldActiveRem > 0;
      shieldActiveChip.textContent = `🛡️ ${fmtTime(shieldActiveRem)}`;
      shieldActiveChip.classList.toggle('hidden', !shieldActive);
    }

    const shieldCooldownChip = document.getElementById(`shield-cooldown-chip-${t.id}`);
    if (shieldCooldownChip) {
      const shieldCooldownRem = getShieldCooldownRemainingMs(t);
      shieldCooldownChip.textContent = `⏳ Shield Cooldown ${fmtTime(shieldCooldownRem)}`;
      shieldCooldownChip.classList.toggle('hidden', shieldCooldownRem <= 0);
    }
  });

  syncAllCaptureTargets();
}

function getShieldActiveRemainingMs(team) {
  if (!team || !team.safeEndsAt) return 0;
  return Math.max(0, team.safeEndsAt - getEffectiveNow());
}

function getShieldCooldownRemainingMs(team) {
  if (!team || !team.shieldCooldownEndsAt) return 0;
  return Math.max(0, team.shieldCooldownEndsAt - getEffectiveNow());
}

function getEffectiveNow() {
  return gs && gs.timerPaused && gs.globalTimerPausedAt ? gs.globalTimerPausedAt : Date.now();
}

function syncSeekTargets(teamId) {
  const first = document.getElementById(`seek1-${teamId}`);
  const second = document.getElementById(`seek2-${teamId}`);
  if (!first || !second) return;

  const selectedFirst = first.value;
  Array.from(second.options).forEach((opt) => {
    if (!opt.value) return;
    opt.disabled = !!selectedFirst && opt.value === selectedFirst;
  });

  if (selectedFirst && second.value === selectedFirst) {
    second.value = '';
  }
}

function syncAllCaptureTargets() {
  if (!gs || !Array.isArray(gs.teams)) return;

  const selectedByTeam = new Map();
  gs.teams.forEach((team) => {
    const select = document.getElementById(`cap-${team.id}`);
    if (!select) return;
    const value = select.value;
    if (value) selectedByTeam.set(team.id, value);
  });

  gs.teams.forEach((team) => {
    const select = document.getElementById(`cap-${team.id}`);
    if (!select) return;

    Array.from(select.options).forEach((opt) => {
      if (!opt.value) return;
      const post = gs.posts.find(p => p.id === opt.value);
      if (!post) return;
      const owner = gs.teams.find(t2 => t2.id === post.owningTeamId);
      const now = getEffectiveNow();
      const cooldownRem = post.cooldownEndsAt && now < post.cooldownEndsAt ? (post.cooldownEndsAt - now) : 0;
      const cooldownDisabled = cooldownRem > 0;
      const takenByOther = Array.from(selectedByTeam.entries()).some(([otherTeamId, postId]) => otherTeamId !== team.id && postId === opt.value);

      opt.disabled = cooldownDisabled || takenByOther;

      let label = `${post.name} (${post.pointValue}pts)${owner ? ' · ' + owner.name : ' · Unowned'}`;
      if (cooldownDisabled) label += ` (In cooldown ${fmtTime(cooldownRem)})`;
      if (takenByOther) label += ' (Taken)';
      opt.textContent = label;
    });
  });
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// ── Actions ──────────────────────────────────────────────────────
function capturePost(teamId) {
  const selections = collectCaptureSelections();
  if (!selections.length) { showToast('Select at least one post to capture', 'warn'); return; }

  const message = [
    'Confirm capture?',
    ...selections.map(item => `${item.teamName} -> ${item.postName}`)
  ].join('\n');

  confirmAction(message, () => {
    selections.forEach(({ teamId: selectedTeamId, postId }) => {
      socket.emit('capturePost', { postId, teamId: selectedTeamId });
    });
  });
}

function collectCaptureSelections() {
  if (!gs || !Array.isArray(gs.teams)) return [];

  const selections = gs.teams
    .map(team => {
      const select = document.getElementById(`cap-${team.id}`);
      const postId = select ? select.value : '';
      if (!postId) return null;

      const post = gs.posts.find(p => p.id === postId);
      if (!post) return null;

      return {
        teamId: team.id,
        teamName: team.name,
        postId: post.id,
        postName: post.name
      };
    })
    .filter(Boolean);

  const selectedPostIds = selections.map(item => item.postId);
  if (new Set(selectedPostIds).size !== selectedPostIds.length) {
    showToast('A post can only be selected by one team at a time', 'warn');
    return [];
  }

  return selections;
}

function clearTeamLocation(teamId) {
  socket.emit('clearTeamLocation', { teamId });
}

function steal(actingTeamId) {
  const targetId = document.getElementById(`steal-${actingTeamId}`).value;
  if (!targetId) { showToast('Select a target team', 'warn'); return; }
  const actor = gs.teams.find(t => t.id === actingTeamId);
  const target = gs.teams.find(t => t.id === targetId);
  
  if (target.hasSafe) {
    const cost = gs.settings.costs.breakSafe || 80;
    confirmAction(`Reminder: ${target.name} has a shield active, prompting steal will result in a shield break.\nCost: ${cost} pts from ${actor.name} to break shield. Proceed?`,
      () => socket.emit('steal', { actingTeamId, targetTeamId: targetId }));
    return;
  }

  const approx = Math.floor(target.points * 0.3);
  const cost = gs.settings.costs.steal;
  confirmAction(`Steal ~${approx} pts from ${target.name}?\nCost: ${cost} pts from ${actor.name}`,
    () => socket.emit('steal', { actingTeamId, targetTeamId: targetId }));
}

function securePost(actingTeamId) {
  const blockers = getSecureBlockers(actingTeamId);
  if (blockers.length) {
    showToast(`Secure blocked: ${blockers.map(t => t.name).join(', ')} is capturing your post`, 'warn');
    return;
  }

  const postId = document.getElementById(`sec-${actingTeamId}`).value;
  if (!postId) { showToast('Select a post to secure', 'warn'); return; }
  const team = gs.teams.find(t => t.id === actingTeamId);
  const post = gs.posts.find(p => p.id === postId);
  const cost = Math.floor(post.pointValue * 0.5);
  confirmAction(`Secure ${post.name} for ${team.name}?\nCost: ${cost} pts`,
    () => socket.emit('secure', { actingTeamId, postId }));
}

function activateShield(actingTeamId) {
  const team = gs.teams.find(t => t.id === actingTeamId);
  const cost = gs.settings.costs.safe;
  confirmAction(`Activate Shield (immunity) for ${team.name}?\nCost: ${cost} pts`,
    () => socket.emit('shield', { actingTeamId }));
}

function seek(actingTeamId) {
  const actor = gs.teams.find(t => t.id === actingTeamId);
  const others = gs.teams.filter(t => t.id !== actingTeamId);
  if (others.length < 2) { showToast('Seek needs at least 2 opponent teams', 'warn'); return; }

  const t1 = document.getElementById(`seek1-${actingTeamId}`).value;
  const t2 = document.getElementById(`seek2-${actingTeamId}`).value;
  if (!t1 || !t2) { showToast('Select two target teams', 'warn'); return; }
  if (t1 === t2) { showToast('Select two different teams', 'warn'); return; }
  const target1 = gs.teams.find(t => t.id === t1);
  const target2 = gs.teams.find(t => t.id === t2);
  confirmAction(`Seek ${target1.name} and ${target2.name} points for ${actor.name}?\nCost: 0 pts`,
    () => socket.emit('seek', { actingTeamId, targetTeamId1: t1, targetTeamId2: t2 }));
}

function unsecurePost(postId) {
  const post = gs.posts.find(p => p.id === postId);
  confirmAction(`Remove Secured status from ${post.name}? (Admin override)`,
    () => socket.emit('unsecurePost', { postId }));
}

function removePostOwnership(postId) {
  const post = gs.posts.find(p => p.id === postId);
  const owner = gs.teams.find(t => t.id === post.owningTeamId);
  confirmAction(`Remove owner from ${post.name}${owner ? ` (currently ${owner.name})` : ''}?`,
    () => socket.emit('removePostOwnership', { postId }));
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
  confirmAction('⚠️ RESET ALL GAME DATA to defaults? This fully resets posts, points, teams, and the timer. Timer will also be paused.',
    () => socket.emit('resetGame'));
}

function confirmResetPoints() {
  confirmAction('⚠️ Reset Points? This resets all team points to 0 and pauses/restarts the timer to its default payout interval.',
    () => socket.emit('resetPoints'));
}

function confirmRecovery() {
  confirmAction('♻ Restore the last good save snapshot? This overwrites the current live state if the backup is available.',
    () => socket.emit('recoverGameState'));
}

function clearPostCooldown(postId) {
  confirmAction('Clear this post timer?', () => socket.emit('clearPostCooldown', { postId }));
}

function clearTeamTimers(teamId) {
  confirmAction('Clear this team\'s running timers?', () => socket.emit('clearTeamTimers', { teamId }));
}

// ── Settings ─────────────────────────────────────────────────────
function openSettings() {
  if (!gs || !authUser) return;
  const s = gs.settings;
  const tv = s.tierValues || { high: 50, low: 30 };
  const postCd = s.postCooldowns || { capture: 5, secure: 10 };
  const actCd = s.actionCooldowns || { capture: 0, steal: 5, secure: 0, shield: 0, seek: 0 };
  const shieldDuration = s.shieldDuration ?? 15;
  const shieldCooldownMinutes = s.shieldCooldownMinutes ?? 10;
  
  let html = `
    <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div class="settings-section" style="flex:1;min-width:260px">
          <h3>Game Timings (Minutes)</h3>
          <label>Payout Interval <input type="number" id="set-payout" value="${s.payoutInterval}"></label>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">Frequency of points given for owned posts.</div>

            <label>Post Cooldown <input type="number" id="set-post-cap-cd" value="${postCd.capture}"></label>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">Immunity time after a post is normally captured.</div>

            <label>Secure Duration <input type="number" id="set-post-sec-cd" value="${postCd.secure}"></label>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">Immunity time when a team manually Secures a post.</div>
            
            <h3 style="margin-top:16px;">Team Action Cooldowns (Minutes)</h3>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Time team must wait to reuse an ability (0 = instant).</div>
            <label>Capture Ability <input type="number" id="set-tcd-cap" value="${actCd.capture}"></label>
            <label>Steal Ability <input type="number" id="set-tcd-steal" value="${actCd.steal}"></label>
            <label>Secure Ability <input type="number" id="set-tcd-sec" value="${actCd.secure}"></label>
            <label>Shield Ability <input type="number" id="set-tcd-shield" value="${actCd.shield}"></label>
            <label>Seek Ability <input type="number" id="set-tcd-seek" value="${actCd.seek}"></label>
            <label>Shield Duration <input type="number" id="set-shield-duration" value="${shieldDuration}"></label>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">How long Shield immunity stays active after activation.</div>
            <label>Shield Cooldown <input type="number" id="set-shield-cooldown" value="${shieldCooldownMinutes}"></label>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:-4px; margin-bottom:12px;">How long a team must wait before buying another Shield.</div>
            
            <h3 style="margin-top:16px;">Point Tier Values</h3>
            <label>High Tier <input type="number" id="set-high-tier" value="${tv.high}"></label>
            <label>Low Tier <input type="number" id="set-low-tier" value="${tv.low}"></label>
        </div>
        <div class="settings-section" style="flex:1;min-width:260px">
          <h3>Action Costs</h3>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Cost for abilities. Secure Cost is a percentage (1-100) of the post's base value.</div>
            <label>Capture Point Cost <input type="number" id="set-cost-cap" value="${s.costs.capture || 0}"></label>
            <label>Steal Point Cost <input type="number" id="set-cost-steal" value="${s.costs.steal}"></label>
            <label>Secure Cost (%) <input type="number" id="set-cost-sec" value="${s.costs.secure ?? 50}"></label>
            <label>Shield Point Cost <input type="number" id="set-cost-safe" value="${s.costs.safe}"></label>
            <label>Seek Point Cost <input type="number" id="set-cost-seek" value="${s.costs.seek || 0}"></label>
  
          <h3 style="margin-top:16px;">Teams Config</h3>
          <div id="set-teams-list" style="display:flex;flex-direction:column;gap:8px">
            ${s.teams.map(t => `
              <div class="team-edit-row" data-id="${t.id}" style="display:flex; gap:8px">
                <input type="text" class="t-name" value="${escHtml(t.name)}" style="flex:1">
                <input type="color" class="t-color" value="${t.color}">
                <button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">✕</button>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-sm btn-success" style="margin-top:8px;" onclick="addTeamRow()">+ Add Team</button>

          <h3 style="margin-top:16px;">Recovery</h3>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">Restore the last known-good snapshot if the live state becomes corrupted or incomplete.</div>
          <button class="btn btn-warning btn-sm" onclick="confirmRecovery()">♻ Restore Last Good Save</button>
        </div>
      </div>
    `;
    document.getElementById('settings-body').innerHTML = html;
    document.getElementById('settings-modal').classList.remove('hidden');
}

function renderRecoveryStatus() {
  const el = document.getElementById('recovery-status');
  if (!el || !gs) return;
  const info = gs.recovery || {};
  if (info.available) {
    el.style.display = 'inline-block';
    el.textContent = info.recoveredAt ? 'Recovered snapshot available' : 'Recovery ready';
  } else {
    el.style.display = 'none';
    el.textContent = '';
  }
}

function addTeamRow() {
  const div = document.createElement('div');
  div.className = 'team-edit-row';
  div.dataset.id = 'new_' + Date.now();
  div.innerHTML = `
    <input type="text" class="settings-input t-name" placeholder="New Team" style="flex:1">
    <input type="color" class="t-color" value="#ffffff">
    <button class="btn btn-xs btn-danger" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('set-teams-list').appendChild(div);
}

function saveSettings() {
  const getInt = (id, def) => { const v = document.getElementById(id).value; return v === '' ? def : parseInt(v); };
  const getFloat = (id, def) => { const v = document.getElementById(id).value; return v === '' ? def : parseFloat(v); };

  const teams = [];
  document.querySelectorAll('.team-edit-row').forEach(row => {
    teams.push({
      id: row.dataset.id,
      name: row.querySelector('.t-name').value,
      color: row.querySelector('.t-color').value
    });
  });

  const payload = {
    payoutInterval: getInt('set-payout', 30),
    postCooldowns: {
      capture: getFloat('set-post-cap-cd', 5),
      secure: getFloat('set-post-sec-cd', 10)
    },
    actionCooldowns: {
      capture: getFloat('set-tcd-cap', 0),
      steal: getFloat('set-tcd-steal', 0),
      secure: getFloat('set-tcd-sec', 0),
      shield: getFloat('set-tcd-shield', 0),
      seek: getFloat('set-tcd-seek', 0)
    },
    shieldDuration: getFloat('set-shield-duration', 15),
    shieldCooldownMinutes: getFloat('set-shield-cooldown', 10),
    costs: {
      capture: getInt('set-cost-cap', 0),
      steal: getInt('set-cost-steal', 50),
      secure: getInt('set-cost-sec', 50),
      safe: getInt('set-cost-safe', 40),
      seek: getInt('set-cost-seek', 0)
    },
    tierValues: {
      high: getInt('set-high-tier', 50),
      low: getInt('set-low-tier', 30)
    },
    teams
  };
  
  socket.emit('updateSettings', payload);
  closeSettings();
}


function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
  newTeamCounter = 0;
}

function modalBackdropClick(e, id) {
  if (e.target !== document.getElementById(id)) return;
  if (id === 'add-team-modal') closeAddTeam();
  else if (id === 'login-modal') closeLoginModal();
  else if (id === 'accounts-modal') closeAccountsModal();
  else closeSettings();
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

// ── Auth ─────────────────────────────────────────────────────────
async function initAuth() {
  console.log('[initAuth] Checking current session...');
  try {
    const res = await fetch('/auth/me');
    const { user } = await res.json();
    console.log('[initAuth] Fetched user:', user);
    authUser = user;
  } catch (e) {
    console.error('[initAuth] Failed to fetch session:', e);
    authUser = null;
  }
  updateAuthUI();
  if (gs) render();
}

function updateAuthUI() {
  const isLogged = !!authUser;
  const isAdmin = isLogged && authUser.role === 'admin';
  console.log('[AuthUI] Updating UI... \nUser:', authUser, '\nisLogged:', isLogged, '\nisAdmin:', isAdmin);
  
  // Helpers see what admins see, actions are queued on the backend.
  // Hide features ONLY if the user is completely logged out.
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !isLogged);
    console.log('[AuthUI] Toggling feature element hidden=', !isLogged, el);
  });
  
  const authArea = document.getElementById('auth-area');
  if (authArea) {
    authArea.innerHTML = isLogged
      ? `<span class="admin-badge" style="background:var(--bg3); padding:4px 8px; border-radius:4px; border:1px solid var(--border);">👤 ${escHtml(authUser.username)} (${authUser.role})</span>
         ${isAdmin ? `<button class="btn btn-secondary btn-sm" onclick="openAccountsModal()">👥 Accounts</button>` : ''}
         <button class="btn btn-secondary btn-sm" onclick="logout()">🚪 Logout</button>`
      : `<button class="btn btn-secondary btn-sm" onclick="openLoginModal()">🔐 Login</button>`;
  }
  document.getElementById('log-section').classList.toggle('hidden', !isLogged);
}

function openLoginModal() {
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('login-username').focus(), 50);
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
}

async function submitLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (!username || !password) { errEl.textContent = 'Enter username and password'; errEl.style.display = 'block'; return; }
  console.log('[Login] Attempting to login as', username);
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    console.log('[Login] Response status:', res.status);
    const data = await res.json();
    console.log('[Login] Response data:', data);
    
    if (!res.ok) { 
      errEl.textContent = data.error || 'Login failed'; 
      errEl.style.display = 'block'; 
      return; 
    }
    
    // Login successful: we MUST reload the entire page. 
    // Express-session creates a brand new connection cookie that the currently 
    // open Socket.IO connection is entirely unaware of! Reloading safely forces 
    // Socket.IO to reconnect using the new authenticated session cookie.
    window.location.reload();
  } catch (e) {
    console.error('[Login] Fetch error:', e);
    errEl.textContent = 'Login failed. Try again.';
    errEl.style.display = 'block';
  }
}

async function logout() {
  console.log('[Logout] Requesting logout...');
  await fetch('/auth/logout', { method: 'POST' });
  // Reload the page to drop the local Socket.IO session context
  window.location.reload();
}

// ── Admin Accounts Modal ──────────────────────────────────────────
async function openAccountsModal() {
  document.getElementById('accounts-modal').classList.remove('hidden');
  await refreshAccountsList();
}

function closeAccountsModal() {
  document.getElementById('accounts-modal').classList.add('hidden');
}

async function refreshAccountsList() {
  const body = document.getElementById('accounts-body');
  body.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px 0">Loading…</p>';
  try {
    const res = await fetch('/auth/accounts');
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<p style="color:var(--red);font-size:0.85rem">${escHtml(data.error || 'Failed to load accounts.')}</p>`;
      return;
    }
    const accounts = Array.isArray(data) ? data : [];
    body.innerHTML = `
      <div style="margin-bottom:16px">
        <h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Current Accounts</h4>
        ${accounts.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);gap:8px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:220px;flex:1">
              <span style="font-size:0.84rem;color:${a.online ? '#2ea043' : '#8b949e'}">${a.online ? '● Online' : '○ Offline'}</span>
              <span style="font-size:0.78rem;color:${a.loggedIn ? '#58a6ff' : '#8b949e'}">${a.loggedIn ? 'Logged in' : 'Logged out'}</span>
              <span style="font-size:0.76rem;color:var(--text-muted)">(${a.role})</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;flex:1">
              <input id="acc-name-${a.id}" class="adjust-input" style="width:130px" value="${escHtml(a.username)}" />
              <button class="btn btn-xs btn-info" onclick="renameAccount('${a.id}','${escHtml(a.username)}')">Rename</button>
              ${a.id !== authUser.id
                ? `<button class="btn btn-xs btn-danger" onclick="deleteAccount('${a.id}','${escHtml(a.username)}')">🗑 Remove</button>`
                : '<span style="font-size:0.75rem;color:var(--text-muted)">(you)</span>'}
            </div>
          </div>`).join('')}
      </div>`;
  } catch (e) {
    body.innerHTML = '<p style="color:var(--red);font-size:0.85rem">Failed to load accounts.</p>';
  }
}

async function addAccount() {
  const username = document.getElementById('new-admin-user').value.trim();
  const password = document.getElementById('new-admin-pass').value;
  const role = document.getElementById('new-admin-role').value;
  if (!username || !password) return showToast('Username and password required', 'error');

  try {
    const res = await fetch('/auth/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    if (!res.ok) {
      const { error } = await res.json();
      return showToast(error || 'Failed to add account', 'error');
    }
    showToast(`Added ${role} ${username}`, 'success');
    document.getElementById('new-admin-user').value = '';
    document.getElementById('new-admin-pass').value = '';
    refreshAccountsList();
  } catch (e) {
    showToast('Failed to add account', 'error');
  }
}

async function deleteAccount(id, username) {
  confirmAction(`Remove admin account "${username}"?`, async () => {
    try {
      const res = await fetch(`/auth/accounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { showToast(data.error, 'error'); return; }
      showToast(`Admin "${username}" removed`, 'info');
      await refreshAccountsList();
    } catch (e) {
      showToast('Failed to remove account', 'error');
    }
  });
}

async function renameAccount(id, oldUsername) {
  const input = document.getElementById(`acc-name-${id}`);
  if (!input) return;
  const username = input.value.trim();
  if (!username) {
    showToast('Username cannot be empty', 'error');
    input.value = oldUsername;
    return;
  }
  if (username === oldUsername) return;

  try {
    const res = await fetch(`/auth/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to rename account', 'error');
      input.value = oldUsername;
      return;
    }
    showToast(`Renamed ${oldUsername} to ${username}`, 'success');
    await refreshAccountsList();
    if (authUser && authUser.id === id) {
      authUser.username = username;
      updateAuthUI();
    }
  } catch (e) {
    showToast('Failed to rename account', 'error');
    input.value = oldUsername;
  }
}

initAuth();

// ── Helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
