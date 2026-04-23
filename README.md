# Olympus Games

Olympus Games is a real-time, capture-the-flag inspired game control panel for live events.

Teams solve puzzles/challenges and compete for points by capturing posts, defending assets, and using tactical actions. The web app keeps all connected screens in sync, so admins and helpers can run the game from laptops, tablets, or phones at the same time.

---

## Core Gameplay

- Real-time shared game state via Socket.IO
- Team-vs-team point economy with cooldowns and action costs
- Capture posts to own payout sources
- Secure posts to extend protection
- Shield to gain temporary immunity
- Seek to reveal other teams' current points
- Steal to transfer points (or break an active shield)

---

## Current Features

### Live Board

- Circular post display with ownership, cooldown, and secure state indicators
- Team cards with points, action controls, and immunity status chip
- Event log and pending request queue
- Round counter next to payout timer

### Actions

| Action | Description |
|---|---|
| Capture | Captures an available post for a team and applies post/team cooldowns |
| Steal | Steals 30% from a target team (costs points) |
| Secure | Protects an owned post and extends cooldown |
| Shield | Grants temporary immunity for configured duration |
| Seek | Reveals two selected target teams' current points |

### Roles and Approval Flow

- Admin accounts can execute actions directly
- Helper accounts can submit requests for approval
- Admins can approve/reject queued helper requests

### Admin Controls

- Manual point adjustment (+/- quick buttons and custom input)
- Manual payout trigger
- Pause/resume/reset payout timer
- Remove secure status from posts
- Remove active shield from teams
- Add/delete/rename posts
- Add/delete/edit teams
- Reset points or reset full game

### Settings

- Payout interval
- Post cooldowns (capture, secure)
- Team action cooldowns (capture, steal, secure, shield, seek)
- Shield duration
- Action costs (capture, steal, secure %, shield, seek)
- Tier values (high/low)

---

## Persistence and Sessions

- Game state is persisted to `data/gameState.json`
- Admin accounts use Redis storage when `REDIS_URL` is available, with file fallback for local development
- Session/auth uses `express-session`, with Redis session store in production when configured

---

## Tech Stack

- Backend: Node.js + Express
- Realtime: Socket.IO
- Auth Sessions: express-session + connect-redis
- Data Store: JSON file + optional Redis-backed account/session data
- Frontend: Vanilla HTML/CSS/JS

---

## Getting Started

### Prerequisites

- Node.js 18+

### Install

```bash
npm install
```

### Run

```bash
npm start
```

### Development Mode

```bash
npm run dev
```

Open `http://localhost:3000`.

---

## Deployment Notes

Recommended env vars:

- `PORT` (optional, defaults to `3000`)
- `SESSION_SECRET` (required in production)
- `REDIS_URL` (recommended for production sessions/account storage)
- `NODE_ENV=production`

When deploying behind HTTPS proxies (e.g., Railway), cookie and proxy settings are already handled in server config.

---

## Project Structure

```text
.
├── public/
│   ├── app.js
│   ├── index.html
│   └── style.css
├── server/
│   ├── adminStore.js
│   ├── gameState.js
│   ├── index.js
│   └── store.js
├── data/
│   ├── admins.json
│   └── gameState.json
└── package.json
```
