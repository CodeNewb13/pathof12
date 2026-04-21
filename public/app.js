/* global state & socket */
const socket = io();
let gs = null; // gameState
let tickInterval = null;
let newTeamCounter = 0;
let editMode = false;
let authUser = null; // null if not logged in

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
  if (authUser) {
    renderEventLog();
    renderRequests();
  }
  startTick();
}

// ── Posts ───────────────────────────────────────────────────────
function renderPosts() {
  const tv = (gs.settings.tierValues) || { high: 50, low: 30 };
  const allPosts = gs.posts || [];
  const radius = allPosts.length <= 1 ? 0 : Math.max(160, allPosts.length * 45); // adjusted spacing
  const minHeight = allPosts.length === 0 ? '50px' : (radius * 2 + 150) + 'px';

  document.getElementById('posts-grid').innerHTML = `
    <div class="posts-groups" style="justify-content:center">
      <div class="post-group" style="width: 100%; border:none; padding:0; display:flex; flex-direction:column; align-items:center;">
        <div class="post-group-actions" style="margin-bottom: 24px; display:flex; gap:12px; justify-content:center; z-index:10;">
          ${editMode ? `
            <button class="btn btn-sm btn-danger" onclick="addPost('high')" style="background:#8b0000">+ Add High Value</button>
            <button class="btn btn-sm btn-info" onclick="addPost('low')" style="background:#004080">+ Add Low Value</button>
          ` : ''}
        </div>
        <div class="posts-circular" style="--count: ${allPosts.length}; min-height: ${minHeight}">
          ${allPosts.map((p, i) => postCard(p, editMode, i, allPosts.length)).join('')}
          ${allPosts.length === 0 ? '<div style="color:var(--text-muted);font-size:0.8rem;padding:6px;text-align:center">No posts</div>' : ''}
        </div>
      </div>
    </div>`;
}

function postCard(post, showDelete = false, index = 0, total = 1) {
  const team = gs.teams.find(t => t.id === post.owningTeamId);
  const tv = gs.settings.tierValues || { high: 50, low: 30 };
  const now = Date.now();
  const onCooldown = post.cooldownEndsAt && now < post.cooldownEndsAt;

  const isHigh = post.pointValue === tv.high;
  // Solid colors as requested
  const bgStyle = isHigh ? 'background:#8b0000; color:#fff;' : 'background:#004080; color:#fff;';
  const postBorder = team ? team.color : (isHigh ? '#ff8888' : '#88ccff');
  const borderWidth = team ? '4px' : '2px';
  const shadow = team ? `box-shadow: 0 0 12px ${team.color};` : '';
  
  // Calculate angle for circular layout (in degrees)
  const angle = total > 1 ? (index * 360 / total) : 0;
  const radius = total <= 1 ? 0 : Math.max(160, total * 45); // match container spacing

  return `
<div class="post-card${post.isSecured ? ' secured' : ''}" style="border: ${borderWidth} solid ${postBorder}; ${bgStyle} ${shadow} --angle: ${angle}deg; --radius: ${radius}px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 16px 12px; gap: 8px;" data-angle="${angle}">
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
  <div class="post-cooldown" id="cd-wrap-${post.id}" style="margin-top: 4px;">
    ${onCooldown && !post.isSecured
      ? `<span class="cooldown-timer" id="cd-${post.id}" data-ends="${post.cooldownEndsAt}">⏳ --:--</span>`
      : (!post.isSecured ? '<span class="capturable-badge" style="background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px;">✅ Capturable</span>' : '')}
  </div>
  ${post.isSecured && authUser
    ? `<button class="btn btn-xs btn-secondary" style="margin-top: 6px;" onclick="unsecurePost('${post.id}')">🔓 Remove Secure</button>`
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
  const isLogged = !!authUser;
  const isAdmin = authUser && authUser.role === 'admin';
  const isHelper = authUser && authUser.role === 'helper';
  const others = gs.teams.filter(t => t.id !== team.id);
  const ownedUnsecured = gs.posts.filter(p => p.owningTeamId === team.id && !p.isSecured);
  const now = Date.now();
  const availCapture = gs.posts.filter(p => {
    const cd = p.cooldownEndsAt && now < p.cooldownEndsAt;
    return !cd && p.owningTeamId !== team.id;
  });

  return `
<div class="team-card">
  ${editMode && gs.teams.length > 1 && isLogged ? `<button class="btn-delete-corner" onclick="confirmDeleteTeam('${team.id}')" title="Delete team">🗑</button>` : ''}
  <div class="team-header" style="background:${team.color}">
    <span>${escHtml(team.name)}</span>
    <div style="display:flex;gap:6px;align-items:center">
      ${team.hasSafe ? '<span class="safe-badge">🛡️ Immune</span>' : ''}
      ${isLogged && team.hasSafe ? `<button class="btn btn-xs btn-secondary" onclick="removeShield('${team.id}')">✕ Remove</button>` : ''}
    </div>
  </div>
  <div class="team-body">
    <div class="team-points">
      <span class="points-label">Points:</span>
      <span class="points-value" style="color:${team.color}">${team.points}</span>
    </div>

    ${isLogged ? `
    <div class="actions-section">
      <h4>${isHelper ? 'Request Actions' : 'Actions'}</h4>

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
        <button class="btn btn-info btn-xs" onclick="securePost('${team.id}')">🔒 Secure (50% pts)</button>
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
    ` : ''}
  </div>
</div>`;
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

  const isAdmin = authUser && authUser.role === 'admin';
  el.innerHTML = gs.requestsQueue.map(req => `
    <div style="background:var(--bg2); border:1px solid var(--border); padding:10px; border-radius:var(--radius); font-size:0.9rem;">
      <div style="font-weight:bold; margin-bottom:4px; color:var(--blue);">${escHtml(req.actionName)}</div>
      <div style="color:var(--text-muted); margin-bottom:8px;">${escHtml(req.payloadStr)} (Req by: ${escHtml(req.username)})</div>
      <div style="display:flex; gap:6px;">
        ${isAdmin ? `<button class="btn btn-success btn-xs" onclick="approveRequest('${req.id}')">✔ Approve</button>` : ''}
        ${isAdmin ? `<button class="btn btn-danger btn-xs" onclick="rejectRequest('${req.id}')">✖ Reject</button>` : ''}
        ${!isAdmin ? `<button class="btn btn-warning btn-xs" onclick="cancelRequest('${req.id}')">Cancel Request</button>` : ''}
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

function breakShield(actingTeamId) {
  const targetId = document.getElementById(`bs-${actingTeamId}`).value;
  if (!targetId) { showToast('No immune team selected', 'warn'); return; }
  const actor = gs.teams.find(t => t.id === actingTeamId);
  const target = gs.teams.find(t => t.id === targetId);
  const cost = gs.settings.costs.breakSafe;
  confirmAction(`Break ${target.name}'s immunity?\nCost: ${cost} pts from ${actor.name}`,
    () => socket.emit('breakShield', { actingTeamId, targetTeamId: targetId }));
}


function seek(actingTeamId) {
  const t1 = document.getElementById(`seek1-${actingTeamId}`).value;
  const t2 = document.getElementById(`seek2-${actingTeamId}`).value;
  if (!t1 || !t2) { showToast('Select two target teams', 'warn'); return; }
  if (t1 === t2) { showToast('Select two different teams', 'warn'); return; }
  const actor = gs.teams.find(t => t.id === actingTeamId);
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

// ── Settings ─────────────────────────────────────────────────────
function openSettings() {
  if (!gs || !authUser) return;
  const s = gs.settings;
  const tv = s.tierValues || { high: 50, low: 30 };
  const postCd = s.postCooldowns || { capture: 5, secure: 10 };
  const actCd = s.actionCooldowns || { capture: 0, steal: 5, secure: 0, shield: 0, breakShield: 0, seek: 0 };
  
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
            <label>Break Shield Ability <input type="number" id="set-tcd-bs" value="${actCd.breakShield}"></label>
            <label>Seek Ability <input type="number" id="set-tcd-seek" value="${actCd.seek}"></label>
            
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
            <label>Break Shield Point Cost <input type="number" id="set-cost-bs" value="${s.costs.breakSafe}"></label>
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
        </div>
      </div>
    `;
    document.getElementById('settings-body').innerHTML = html;
    document.getElementById('settings-modal').classList.remove('hidden');
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
      breakShield: getFloat('set-tcd-bs', 0),
      seek: getFloat('set-tcd-seek', 0)
    },
    costs: {
      capture: getInt('set-cost-cap', 0),
      steal: getInt('set-cost-steal', 50),
      secure: getInt('set-cost-sec', 50),
      safe: getInt('set-cost-safe', 40),
      breakSafe: getInt('set-cost-bs', 80),
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
    
    authUser = data.user;
    console.log('[Login] Success! authUser set to:', authUser);
    
    closeLoginModal();
    updateAuthUI();
    if (gs) render();
    showToast(`Logged in as ${authUser.username}`, 'info');
  } catch (e) {
    console.error('[Login] Fetch error:', e);
    errEl.textContent = 'Login failed. Try again.';
    errEl.style.display = 'block';
  }
}

async function logout() {
  console.log('[Logout] Requesting logout...');
  await fetch('/auth/logout', { method: 'POST' });
  authUser = null;
  editMode = false;
  console.log('[Logout] Success, authUser is null, editMode disabled.');
  updateAuthUI();
  if (gs) render();
  showToast('Logged out', 'info');
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
    const accounts = await res.json();
    body.innerHTML = `
      <div style="margin-bottom:16px">
        <h4 style="font-size:0.85rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Current Accounts</h4>
        ${accounts.map(a => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="font-size:0.9rem">👤 ${escHtml(a.username)} <span style="font-size:0.75rem;color:var(--text-muted)">(${a.role})</span></span>
            ${a.id !== authUser.id
              ? `<button class="btn btn-xs btn-danger" onclick="deleteAccount('${a.id}','${escHtml(a.username)}')">🗑 Remove</button>`
              : '<span style="font-size:0.75rem;color:var(--text-muted)">(you)</span>'}
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

initAuth();

// ── Helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
