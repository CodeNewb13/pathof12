const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ADMINS_FILE = path.join(DATA_DIR, 'admins.json');

class AdminStore {
  _load() {
    try {
      if (!fs.existsSync(ADMINS_FILE)) return [];
      return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
    } catch (e) {
      console.error('Failed to load admins:', e.message);
      return [];
    }
  }

  _save(admins) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
    } catch (e) {
      console.error('Failed to save admins:', e.message);
    }
  }

  async seed() {
    const admins = this._load();
    if (admins.length === 0) {
      const hash1 = await bcrypt.hash('admin', 10);
      const hash2 = await bcrypt.hash('helper', 10);
      this._save([
        { id: 'admin_default', username: 'admin', passwordHash: hash1, role: 'admin' },
        { id: 'helper_default', username: 'helper', passwordHash: hash2, role: 'helper' }
      ]);
      console.log('Default accounts created (admin/admin, helper/helper)');
    } else {
      // Migrate old accounts
      let changed = false;
      admins.forEach(a => {
        if (!a.role) { a.role = a.username === 'admin' ? 'admin' : 'helper'; changed = true; }
      });
      if (!admins.find(a => a.username === 'helper')) {
        const hash2 = await bcrypt.hash('helper', 10);
        admins.push({ id: 'helper_default', username: 'helper', passwordHash: hash2, role: 'helper' });
        changed = true;
      }
      if (changed) this._save(admins);
    }
  }

  async verify(username, password) {
    const admins = this._load();
    const found = admins.find(a => a.username === username);
    if (!found) return null;
    const ok = await bcrypt.compare(password, found.passwordHash);
    return ok ? { id: found.id, username: found.username, role: found.role || 'helper' } : null;
  }

  getAll() {
    return this._load().map(({ id, username, role }) => ({ id, username, role }));
  }

  async create(username, password, role = 'helper') {
    if (!username || !password) return { success: false, error: 'Username and password required' };
    const admins = this._load();
    if (admins.find(a => a.username === username)) return { success: false, error: 'Username already exists' };
    const hash = await bcrypt.hash(password, 10);
    const newAdmin = { id: `admin_${Date.now()}`, username, passwordHash: hash, role };
    admins.push(newAdmin);
    this._save(admins);
    return { success: true, admin: { id: newAdmin.id, username, role } };
  }

  delete(id) {
    const admins = this._load();
    if (admins.length <= 1) return { success: false, error: 'Cannot delete the last admin account' };
    const idx = admins.findIndex(a => a.id === id);
    if (idx === -1) return { success: false, error: 'Admin not found' };
    admins.splice(idx, 1);
    this._save(admins);
    return { success: true };
  }
}

module.exports = AdminStore;
