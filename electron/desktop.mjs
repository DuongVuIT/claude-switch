import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readJSON } from './core.mjs';
import { buckets, transferPlan, prepareTransfer } from './session-transfer.mjs';

async function stat(file) { try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function identity(s) { return s ? `${s.dev}:${s.ino}` : null; }
async function writeJSON(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, file);
}

// Uses the official app's fixed user-data location. No token extraction, cookie rewriting,
// alternate signing identity, private API requests, or in-place edits to Chromium databases.
export class DesktopProfiles {
  constructor({ dataDir, liveDir = path.join(os.homedir(), 'Library/Application Support/Claude'), adapter, rename = fs.rename }) {
    this.dataDir = path.resolve(dataDir);
    this.liveDir = path.resolve(liveDir);
    this.root = path.join(this.dataDir, 'desktop-profiles');
    this.stateFile = path.join(this.dataDir, 'desktop-profiles.json');
    this.journalFile = path.join(this.dataDir, 'desktop-switch-journal.json');
    this.adapter = adapter;
    this.rename = rename;
    this.runningSwitch = false;
  }
  async init() {
    const relative = path.relative(this.liveDir, this.dataDir);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Kho hồ sơ desktop phải nằm ngoài dữ liệu Claude.');
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.chmod(this.root, 0o700);
    const live = await stat(this.liveDir);
    if (live?.isSymbolicLink()) throw new Error('Thư mục Claude đang là symlink. Chưa thể chuyển hồ sơ an toàn.');
    if (live) {
      const realRelative = path.relative(await fs.realpath(this.liveDir), await fs.realpath(this.root));
      if (!realRelative || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== '..' && !path.isAbsolute(realRelative))) throw new Error('Kho hồ sơ không được liên kết vào thư mục Claude đang dùng.');
    }
    this.state = await readJSON(this.stateFile, null);
    if (!this.state) {
      this.state = { version: 1, activeId: 'original', profiles: [{ id: 'original', name: 'Claude hiện tại', createdAt: new Date().toISOString() }] };
      await fs.mkdir(path.dirname(this.stored('original')), { recursive: true, mode: 0o700 });
      await this.save();
    }
    return this;
  }
  async save() { await writeJSON(this.stateFile, this.state); }
  profile(id) { const p = this.state.profiles.find(p => p.id === id); if (!p) throw new Error('Không tìm thấy hồ sơ Claude desktop.'); return p; }
  stored(id) {
    if (id !== 'original' && !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id)) throw new Error('ID hồ sơ không hợp lệ.');
    return path.join(this.root, id, 'user-data');
  }
  location(id) { this.profile(id); return id === this.state.activeId ? this.liveDir : this.stored(id); }
  async describe(id) {
    const directory = this.location(id);
    const config = await readJSON(path.join(directory, 'config.json'), {});
    const sessions = [];
    const codeDir = path.join(directory, 'claude-code-sessions');
    const warnings = [];
    const walk = async (dir, depth) => {
      if (depth > 2) return;
      const items = await fs.readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
      for (const item of items) {
        if (item.isDirectory()) await walk(path.join(dir, item.name), depth + 1);
        else if (item.isFile() && /^local_[a-f\d-]+\.json$/.test(item.name)) {
          try {
            const s = await readJSON(path.join(dir, item.name), {});
            sessions.push({ id: s.sessionId, cliSessionId: s.cliSessionId, title: typeof s.title === 'string' ? s.title : 'Session Claude desktop', cwd: s.cwd, isArchived: !!s.isArchived, updatedAt: s.lastActivityAt || s.createdAt });
          } catch { warnings.push(`Không đọc được một metadata session trong ${path.basename(dir)}.`); }
        }
      }
    };
    await walk(codeDir, 0);
    const accountId = typeof config.lastKnownAccountUuid === 'string' ? config.lastKnownAccountUuid : null;
    return { ...this.profile(id), active: id === this.state.activeId, directory, accountId, orgIds: await buckets(directory, accountId), hasData: !!(await stat(directory)), sessionCount: sessions.length, sessions: sessions.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), warnings };
  }
  async snapshot() {
    const profiles = await Promise.all(this.state.profiles.map(p => this.describe(p.id)));
    const current = profiles.find(p => p.active);
    return { activeId: this.state.activeId, profiles: profiles.map(p => ({ ...p, switchBlockReason: p.active ? null : this.continuityBlock(current, p) })), liveDir: this.liveDir, recoveryRequired: !!(await stat(this.journalFile)), app: await this.adapter.status() };
  }
  continuityBlock(current, target) {
    if (current.warnings.length || target.warnings.length) return 'Chưa đọc đủ metadata session. Không chuyển hồ sơ để tránh làm lịch sử hiện tại biến mất khỏi giao diện.';
    const targetIds = new Set(target.sessions.map(s => s.id).filter(Boolean));
    const missing = current.sessions.filter(s => !s.id || !targetIds.has(s.id)).length;
    if (missing) return `Hồ sơ đích thiếu ${missing} session đang có. Chưa chuyển: bản này chưa hỗ trợ mang lịch sử sang tài khoản khác.`;
    if (current.sessions.length && (!current.accountId || !target.accountId || current.accountId !== target.accountId)) return 'Chưa xác minh quyền tiếp tục các session bằng tài khoản đích. Giữ nguyên hồ sơ hiện tại; bản này chưa hỗ trợ chuyển lịch sử giữa tài khoản desktop.';
    return null;
  }
  async requireContinuity(id) {
    const [current, target] = await Promise.all([this.describe(this.state.activeId), this.describe(id)]);
    const reason = this.continuityBlock(current, target);
    if (reason) throw new Error(reason);
  }
  async create(name) {
    if (await stat(this.journalFile)) throw new Error('Cần khôi phục lần chuyển bị gián đoạn trước khi tạo hồ sơ.');
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new Error('Tên hồ sơ cần có từ 1 đến 60 ký tự.');
    const id = crypto.randomUUID();
    await fs.mkdir(path.dirname(this.stored(id)), { recursive: true, mode: 0o700 });
    await fs.mkdir(this.stored(id), { mode: 0o700 });
    this.state.profiles.push({ id, name, createdAt: new Date().toISOString() });
    try { await this.save(); } catch (e) { this.state.profiles.pop(); throw e; }
    return id;
  }
  async renameProfile(id, name) {
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new Error('Tên hồ sơ cần có từ 1 đến 60 ký tự.');
    this.profile(id).name = name;
    await this.save();
  }
  async apply(id, { carryHistory = false, orgId } = {}) {
    this.profile(id);
    if (this.runningSwitch) throw new Error('Đang chuyển hồ sơ.');
    if (await stat(this.journalFile)) throw new Error('Có lần chuyển chưa hoàn tất. Bấm Khôi phục để tiếp tục an toàn.');
    if (id === this.state.activeId) { await this.adapter.open(); return { opened: true, changed: false }; }
    this.runningSwitch = true;
    let journal;
    try {
      const fromId = this.state.activeId;
      const fromStored = this.stored(fromId);
      const target = this.stored(id);
      if (await stat(fromStored)) throw new Error('Kho hồ sơ đang dùng đã có dữ liệu. Không ghi đè; hãy kiểm tra kho trước.');
      const targetStat = await stat(target);
      if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Dữ liệu hồ sơ đích không hợp lệ.');
      const makePlan = () => transferPlan({ source: this.liveDir, target, orgId, ...(this.transcriptRoot ? { transcriptRoot: this.transcriptRoot } : {}) });
      if (carryHistory) await makePlan();
      else await this.requireContinuity(id);
      await this.adapter.quit();
      if ((await this.adapter.status()).running) throw new Error('Claude vẫn đang chạy. Dữ liệu chưa được chuyển.');
      let transfer;
      if (carryHistory) {
        transfer = await prepareTransfer(await makePlan(), path.join(this.dataDir, 'backups'));
        this.profile(id).lastTransfer = transfer;
        await this.save();
      } else await this.requireContinuity(id);
      // Recheck after quitting: Chrome databases are now closed, and native quit has flushed writes.
      let sourceStat = await stat(this.liveDir);
      if (!sourceStat) { await fs.mkdir(this.liveDir, { recursive: true, mode: 0o700 }); sourceStat = await stat(this.liveDir); }
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Thư mục Claude gốc không hợp lệ.');
      journal = { fromId, toId: id, fromIdentity: identity(sourceStat), targetIdentity: identity(targetStat), createdAt: new Date().toISOString() };
      await fs.mkdir(path.dirname(fromStored), { recursive: true, mode: 0o700 });
      await writeJSON(this.journalFile, journal);
      await this.rename(this.liveDir, fromStored);
      await this.rename(target, this.liveDir);
      this.state.activeId = id;
      await this.save();
      await fs.rm(this.journalFile);
      journal = null;
      try { await this.adapter.open(); return { changed: true, opened: true, transfer }; }
      catch { return { changed: true, opened: false, warning: 'Hồ sơ đã chuyển thành công. Không mở được Claude tự động; hãy mở Claude trong Applications.' }; }
    } catch (error) {
      if (journal) {
        try { await this.recoverStopped(); } catch { throw new Error(`${error.message} Lần chuyển cần khôi phục; mọi thư mục được giữ nguyên trong kho hồ sơ.`); }
      }
      throw error;
    } finally { this.runningSwitch = false; }
  }
  async recover() {
    await this.adapter.quit();
    await this.recoverStopped();
    await this.adapter.open();
  }
  async recoverStopped() {
    if ((await this.adapter.status()).running) throw new Error('Phải thoát Claude trước khi khôi phục.');
    const j = await readJSON(this.journalFile, null);
    if (!j) return;
    this.profile(j.fromId); this.profile(j.toId);
    const from = this.stored(j.fromId), target = this.stored(j.toId);
    const liveID = identity(await stat(this.liveDir));
    const fromID = identity(await stat(from)), targetID = identity(await stat(target));
    if (liveID === j.fromIdentity && !fromID && targetID === j.targetIdentity) {
      this.state.activeId = j.fromId;
    } else if (!liveID && fromID === j.fromIdentity && targetID === j.targetIdentity) {
      await fs.rename(from, this.liveDir);
      this.state.activeId = j.fromId;
    } else if (liveID === j.targetIdentity && fromID === j.fromIdentity && !targetID) {
      this.state.activeId = j.toId;
    } else {
      throw new Error('Đường dẫn đã thay đổi ngoài ứng dụng. Không ghi đè dữ liệu; cần kiểm tra các thư mục hồ sơ.');
    }
    await this.save();
    await fs.rm(this.journalFile);
  }
}
