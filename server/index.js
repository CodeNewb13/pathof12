const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameState = require('./gameState');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

const game = new GameState();

function broadcast() {
  io.emit('gameState', game.getState());
}

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

  function handle(action) {
    const result = action();
    if (result && result.success === false) socket.emit('actionError', result.error);
    else broadcast();
  }

  socket.on('capturePost', ({ postId, teamId }) => handle(() => game.capturePost(postId, teamId)));
  socket.on('steal', ({ actingTeamId, targetTeamId }) => handle(() => game.steal(actingTeamId, targetTeamId)));
  socket.on('secure', ({ actingTeamId, postId }) => handle(() => game.secure(actingTeamId, postId)));
  socket.on('shield', ({ actingTeamId }) => handle(() => game.shield(actingTeamId)));
  socket.on('breakShield', ({ actingTeamId, targetTeamId }) => handle(() => game.breakShield(actingTeamId, targetTeamId)));
  socket.on('manualPayout', () => handle(() => { game.processPayout(); return { success: true }; }));
  socket.on('resetTimer', () => handle(() => { game.resetPayoutTimer(); return { success: true }; }));
  socket.on('pauseTimer', () => handle(() => game.pauseTimer()));
  socket.on('resumeTimer', () => handle(() => game.resumeTimer()));
  socket.on('adjustPoints', ({ teamId, amount }) => handle(() => game.adjustPoints(teamId, amount)));
  socket.on('unsecurePost', ({ postId }) => handle(() => game.unsecurePost(postId)));
  socket.on('removeShield', ({ teamId }) => handle(() => game.removeShield(teamId)));
  socket.on('updateSettings', (settings) => handle(() => { game.updateSettings(settings); return { success: true }; }));
  socket.on('addPost', ({ tier }) => handle(() => game.addPost(tier)));
  socket.on('deletePost', ({ postId }) => handle(() => game.deletePost(postId)));
  socket.on('renamePost', ({ postId, newName }) => handle(() => game.renamePost(postId, newName)));
  socket.on('setTierValue', ({ tier, newValue }) => handle(() => game.setTierValue(tier, newValue)));
  socket.on('resetGame', () => handle(() => { game.resetGame(); return { success: true }; }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`CTF Webapp running on http://localhost:${PORT}`);
});
