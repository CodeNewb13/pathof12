# 🏴 CTF Tracker

A real-time web application for running a **Capture the Flag**-style team game. Built for live game management — multiple devices (laptop, tablet, phone) share the same live game state via WebSockets.

---

## Features

- **9 posts** grouped by point tier (High / Mid / Low), displayed in side-by-side columns
- **Real-time sync** — all connected clients update instantly on every action
- **Point payout timer** — auto-awards points every 30 minutes (configurable), with manual trigger and pause/resume
- **Edit Mode** — toggle to add/delete/rename posts and add/delete teams without cluttering the normal UI
- **Persistent state** — game state saved to disk; survives server restarts

### Actions

| Action | Description |
|---|---|
| 🚩 **Capture** | Take an uncooled post for your team; starts cooldown timer |
| 💸 **Steal** | Take 30% of a target team's points (costs points) |
| 🔒 **Secure** | Lock one of your posts; extends its cooldown |
| 🛡️ **Shield** | Activate immunity — no one can steal from you |
| ⚔️ **Break Shield** | Strip an immune team's Shield (does not auto-steal) |

### Admin Controls

- Manual point adjustments per team (+/- quick buttons or custom input)
- Remove Secured status from any post
- Remove Shield from any team
- Pause / Resume / Reset payout timer
- Manual payout trigger
- Settings panel: team names/colors, cooldown duration, secured cooldown multiplier, payout interval, all action costs
- Tier value adjustment: change pts/cycle for an entire tier mid-game

---

## Tech Stack

- **Backend:** Node.js + Express
- **Real-time:** Socket.io (WebSockets)
- **Persistence:** JSON file (`data/gameState.json`)
- **Frontend:** Vanilla HTML/CSS/JS (dark theme, responsive)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v16+

### Install & Run

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser. Share the URL on your local network for multi-device access.

For development with auto-restart:

```bash
npm run dev
```

---

## Post Tiers (Default)

| Tier | Posts | Points/Cycle |
|---|---|---|
| 🔴 High | 2 posts | 50 pts |
| 🟡 Mid | 3 posts | 40 pts |
| 🔵 Low | 4 posts | 30 pts |

Tier values can be changed live in Edit Mode → ⚙️ Settings.

---

## Deployment

This app is ready to deploy on [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io).

Set the `PORT` environment variable if needed (defaults to `3000`).

---

## Project Structure

```
├── server/
│   ├── index.js        # Express + Socket.io server
│   ├── gameState.js    # All game logic
│   └── store.js        # JSON file persistence
├── public/
│   ├── index.html      # App shell
│   ├── style.css       # Dark theme styles
│   └── app.js          # Client-side rendering & socket handling
├── data/
│   └── gameState.json  # Auto-created on first run (gitignored)
└── package.json
```
