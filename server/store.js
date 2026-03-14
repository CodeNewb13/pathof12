const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gameState.json');

class Store {
  load() {
    try {
      if (!fs.existsSync(DATA_FILE)) return null;
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to load state:', e.message);
      return null;
    }
  }

  save(state) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (e) {
      console.error('Failed to save state:', e.message);
    }
  }
}

module.exports = Store;
