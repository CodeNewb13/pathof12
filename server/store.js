const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gameState.json');
const BACKUP_FILE = path.join(DATA_DIR, 'gameState.backup.json');
const DEFAULT_PREFIX = 'ctfapp:';
const GAME_STATE_KEY = 'gameState';
const GAME_STATE_BACKUP_KEY = 'gameState:backup';

function parseJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

class Store {
  constructor(options = {}) {
    this.redisClient = options.redisClient || null;
    this.redisPrefix = options.redisPrefix || DEFAULT_PREFIX;
    this.pendingSave = Promise.resolve();
  }

  get _redisKeys() {
    return {
      state: `${this.redisPrefix}${GAME_STATE_KEY}`,
      backup: `${this.redisPrefix}${GAME_STATE_BACKUP_KEY}`
    };
  }

  _canUseRedis() {
    return !!(this.redisClient && this.redisClient.isOpen);
  }

  load() {
    return this._load();
  }

  async _load() {
    this.lastLoadSource = null;
    if (this._canUseRedis()) {
      const redisPrimary = await this._loadRedisValue(this._redisKeys.state, 'primary');
      if (redisPrimary.ok) {
        this.lastLoadSource = 'redis';
        return redisPrimary.state;
      }

      const redisBackup = await this._loadRedisValue(this._redisKeys.backup, 'backup');
      if (redisBackup.ok) {
        this.lastLoadSource = 'redis-backup';
        console.warn('Recovered game state from Redis backup snapshot.');
        return redisBackup.state;
      }
    }

    const primary = this._loadFile(DATA_FILE, 'primary');
    if (primary.ok) {
      this.lastLoadSource = 'file';
      return primary.state;
    }

    const backup = this._loadFile(BACKUP_FILE, 'backup');
    if (backup.ok) {
      this.lastLoadSource = 'file-backup';
      console.warn('Recovered game state from backup snapshot.');
      return backup.state;
    }

    console.error('Failed to load state from Redis and file snapshots.');
    return null;
  }

  save(state) {
    const serialized = JSON.stringify(state, null, 2);
    this.pendingSave = this.pendingSave
      .then(() => this._save(serialized))
      .catch((e) => console.error('Failed to save state:', e.message));
    return this.pendingSave;
  }

  async _save(serialized) {
    if (this._canUseRedis()) {
      try {
        const previous = await this.redisClient.get(this._redisKeys.state);
        if (previous) {
          await this.redisClient.set(this._redisKeys.backup, previous);
        } else {
          await this.redisClient.set(this._redisKeys.backup, serialized);
        }
        await this.redisClient.set(this._redisKeys.state, serialized);
        return;
      } catch (e) {
        console.error('Failed to save state to Redis:', e.message);
      }
    }

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, BACKUP_FILE);
      }
      fs.writeFileSync(DATA_FILE, serialized);
      if (!fs.existsSync(BACKUP_FILE)) {
        fs.writeFileSync(BACKUP_FILE, serialized);
      }
    } catch (e) {
      console.error('Failed to save file snapshot:', e.message);
    }
  }

  recover() {
    return this._recover();
  }

  async _recover() {
    const backup = await this._loadRedisValue(this._redisKeys.backup, 'backup');
    if (backup.ok) {
      try {
        await this.redisClient.set(this._redisKeys.state, JSON.stringify(backup.state, null, 2));
        return { success: true, state: backup.state };
      } catch (e) {
        console.error('Failed to write recovered Redis state:', e.message);
      }
    }

    const fileBackup = this._loadFile(BACKUP_FILE, 'backup');
    if (!fileBackup.ok) return { success: false, error: 'No recoverable snapshot found' };

    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(fileBackup.state, null, 2));
      return { success: true, state: fileBackup.state };
    } catch (e) {
      console.error('Failed to write recovered state:', e.message);
      return { success: false, error: 'Failed to write recovered snapshot' };
    }
  }

  async _loadRedisValue(key, label) {
    try {
      if (!this._canUseRedis()) return { ok: false };
      const raw = await this.redisClient.get(key);
      if (!raw) return { ok: false };
      return { ok: true, state: JSON.parse(raw) };
    } catch (e) {
      console.error(`Failed to load ${label} state from Redis:`, e.message);
      return { ok: false };
    }
  }

  _loadFile(filePath, label) {
    try {
      const state = parseJsonFile(filePath);
      if (!state) return { ok: false };
      return { ok: true, state };
    } catch (e) {
      console.error(`Failed to load ${label} state snapshot:`, e.message);
      return { ok: false };
    }
  }
}

module.exports = Store;
