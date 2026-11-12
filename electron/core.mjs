import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const SHARED = ['projects', 'file-history', 'paste-cache', 'history.jsonl'];
const AUTH_ENV = /^(ANTHROPIC_|CLAUDE_CODE_(OAUTH|USE_|API_KEY)|CLAUDE_CONFIG_DIR|CLAUDE_CONFIG_PATH|CLAUDE_SESSION_INGRESS_TOKEN|CLAUDECODE)/;
export function cleanEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !AUTH_ENV.test(key)));
}
export const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export async function readJSON(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
async function atomicJSON(file, data) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
function contentText(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(x => x.type === 'text').map(x => x.text || '').join('\n') : '';
}

export class Workspace {
  constructor({ dataDir, sourceDir = path.join(os.homedir(), '.claude'), globalConfig = path.join(os.homedir(), '.claude.json') }) {
    this.dataDir = path.resolve(dataDir);
    this.sourceDir = path.resolve(sourceDir);
    this.globalConfig = globalConfig;
    this.stateFile = path.join(this.dataDir, 'workspace.json');
    this.sessionIndex = new Map();
  }
  async init() {
    const source = await fs.realpath(this.sourceDir).catch(e => { if (e.code === 'ENOENT') return this.sourceDir; throw e; });
    for (const candidate of new Set([source, this.sourceDir])) {
      const relative = path.relative(candidate, this.dataDir);
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Thư mục app không được nằm trong thư mục dữ liệu Claude (tránh sao lưu đệ quy).');
    }
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const realRelative = path.relative(source, await fs.realpath(this.dataDir));
    if (!realRelative || (!realRelative.startsWith(`..${path.sep}`) && realRelative !== '..' && !path.isAbsolute(realRelative))) throw new Error('Thư mục app liên kết vào dữ liệu Claude; hãy chọn vị trí khác.');
    await fs.chmod(this.dataDir, 0o700);
    for (const dir of ['profiles', 'backups', 'launchers']) await fs.mkdir(path.join(this.dataDir, dir), { recursive: true, mode: 0o700 });
    this.state = await readJSON(this.stateFile);
    if (!this.state) {
      this.state = { version: 1, activeId: 'system', profiles: [{ id: 'system', name: 'Tài khoản trên máy', system: true, createdAt: new Date().toISOString() }], backups: [] };
      await this.save();
    }
    return this;
  }
  async save() { await atomicJSON(this.stateFile, this.state); }
  profile(id) {
    const result = this.state.profiles.find(p => p.id === id);
    if (!result) throw new Error('Không tìm thấy tài khoản. Hãy làm mới ứng dụng.');
    return result;
  }
  configDir(id) { return this.profile(id).system ? this.sourceDir : path.join(this.dataDir, 'profiles', id); }
  async metadata(id) {
    const profile = this.profile(id);
    const file = profile.system ? this.globalConfig : path.join(this.configDir(id), '.claude.json');
    const config = await readJSON(file, {});
    const nested = await readJSON(path.join(this.configDir(id), '.claude.json'), {});
    const account = config.oauthAccount || nested.oauthAccount || {};
    // Only known account metadata crosses the renderer boundary. Never return tokens or raw settings.
    const fields = ['accountUuid', 'emailAddress', 'organizationUuid', 'displayName', 'fullName', 'billingType', 'seatTier', 'organizationName', 'organizationType', 'organizationRole', 'workspaceRole', 'accountCreatedAt', 'subscriptionCreatedAt', 'hasExtraUsageEnabled', 'organizationRateLimitTier', 'userRateLimitTier', 'profileFetchedAt', 'ccOnboardingFlags', 'claudeCodeTrialEndsAt', 'claudeCodeTrialDurationDays'];
    return Object.fromEntries(fields.filter(k => account[k] !== undefined).map(k => [k, account[k]]));
  }
  async profiles() {
    return Promise.all(this.state.profiles.map(async p => ({ ...p, configDir: this.configDir(p.id), metadata: await this.metadata(p.id) })));
  }
  async createProfile(name) {
    name = String(name || '').trim();
    if (!name || name.length > 60) throw new Error('Tên tài khoản cần có từ 1 đến 60 ký tự.');
    const id = crypto.randomUUID();
    const dir = path.join(this.dataDir, 'profiles', id);
    await fs.mkdir(dir, { mode: 0o700 });
    try {
      await fs.mkdir(this.sourceDir, { recursive: true, mode: 0o700 });
      for (const item of SHARED) {
        const source = path.join(this.sourceDir, item);
        // Symlinks preserve Claude's complete session tree, subagents, attachments and file history.
        if (!(await exists(source))) {
          if (item.endsWith('.jsonl')) await fs.writeFile(source, '', { flag: 'wx', mode: 0o600 });
          else await fs.mkdir(source, { mode: 0o700 });
        }
        await fs.symlink(source, path.join(dir, item));
      }
      for (const item of ['skills', 'rules', 'commands', 'agents', 'plugins', 'CLAUDE.md']) {
        if (await exists(path.join(this.sourceDir, item))) await fs.symlink(path.join(this.sourceDir, item), path.join(dir, item));
      }
      const settings = structuredClone(await readJSON(path.join(this.sourceDir, 'settings.json'), {}));
      delete settings.apiKeyHelper;
      delete settings.forceLoginOrgUUID;
      delete settings.forceLoginMethod;
      if (settings.env) settings.env = cleanEnvironment(settings.env);
      settings.cleanupPeriodDays = 36500;
      await atomicJSON(path.join(dir, 'settings.json'), settings);
      // MCP definitions are configuration, while identity and credentials belong to the new login.
      const global = await readJSON(this.globalConfig, {});
      await atomicJSON(path.join(dir, '.claude.json'), { hasCompletedOnboarding: true, ...(global.mcpServers ? { mcpServers: global.mcpServers } : {}) });
      this.state.profiles.push({ id, name, system: false, createdAt: new Date().toISOString() });
      await this.save();
      return id;
    } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
  }
  async activate(id) { this.profile(id); this.state.activeId = id; await this.save(); }
  async sessions() {
    const base = path.join(this.sourceDir, 'projects');
    this.sessionIndex.clear();
    const sessions = [];
    const warnings = [];
    const folders = await fs.readdir(base, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      for (const entry of await fs.readdir(path.join(base, folder.name), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const id = entry.name.slice(0, -6);
        if (!/^[a-f\d-]{36}$/i.test(id)) continue;
        const file = path.join(base, folder.name, entry.name);
        try {
          const stat = await fs.stat(file);
          let title = '', customTitle = '', cwd = '', count = 0, model = '', malformed = 0;
          const lines = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
          for await (const line of lines) {
            if (!line.trim()) continue;
            let record; try { record = JSON.parse(line); } catch { malformed++; continue; }
            if (record.cwd) cwd = record.cwd;
            if (record.type === 'custom-title' && record.customTitle) customTitle = record.customTitle;
            if (record.type === 'user' || record.type === 'assistant') {
              const text = contentText(record.message?.content);
              if (text) count++;
              if (!title && record.type === 'user' && text && !record.isMeta && !text.startsWith('<')) title = text.replace(/\s+/g, ' ').slice(0, 140);
              if (record.message?.model) model = record.message.model;
            }
          }
          const key = `${folder.name}/${id}`;
          const session = { key, id, title: customTitle || title || 'Phiên Claude Code', cwd, project: cwd ? path.basename(cwd) : folder.name, messages: count, model, updatedAt: stat.mtime.toISOString(), bytes: stat.size, malformed };
          this.sessionIndex.set(key, { ...session, file });
          sessions.push(session);
          if (malformed) warnings.push(`${id}: ${malformed} dòng chưa đọc được (có thể session đang ghi).`);
        } catch (e) { warnings.push(`${id}: ${e.message}`); }
      }
    }
    return { sessions: sessions.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), warnings };
  }
  session(key) {
    const session = this.sessionIndex.get(key);
    if (!session) throw new Error('Session không còn trong danh sách. Hãy quét lại dữ liệu.');
    return session;
  }
  async transcript(key, offset = 0) {
    const s = this.session(key);
    const messages = [];
    const seen = new Set();
    let count = 0;
    for await (const line of readline.createInterface({ input: createReadStream(s.file), crlfDelay: Infinity })) {
      let r; try { r = JSON.parse(line); } catch { continue; }
      if (!['user', 'assistant'].includes(r.type)) continue;
      if (r.uuid && seen.has(r.uuid)) continue;
      if (r.uuid) seen.add(r.uuid);
      const text = contentText(r.message?.content);
      const tools = Array.isArray(r.message?.content) ? r.message.content.filter(c => c.type === 'tool_use').map(c => c.name) : [];
      if (!text && !tools.length) continue;
      if (count++ < offset) continue;
      if (messages.length < 80) messages.push({ role: r.type, text, tools, timestamp: r.timestamp });
    }
    return { messages, total: count, hasMore: count > offset + messages.length };
  }
  async inventory() {
    const names = await fs.readdir(this.sourceDir).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const groups = [
      { label: 'Conversations & subagents', items: ['projects'], detail: 'Toàn bộ file JSONL và thư mục session gốc' },
      { label: 'Lịch sử & tệp đính kèm local', items: ['file-history', 'paste-cache', 'history.jsonl'], detail: 'Dùng chung giữa các tài khoản' },
      { label: 'Skills, plugins & hướng dẫn', items: ['skills', 'plugins', 'rules', 'commands', 'agents', 'CLAUDE.md'], detail: 'Kế thừa từ cấu hình trên máy' },
      { label: 'Cấu hình & bộ nhớ local', items: ['settings.json', 'settings.local.json', '.claude.json', 'session-env', 'plans', 'todos'], detail: 'Bản sao lưu giữ dữ liệu gốc; thông tin đăng nhập tách riêng' },
    ];
    return { sourceDir: this.sourceDir, dataDir: this.dataDir, entries: names, groups: groups.map(g => ({ ...g, found: g.items.filter(x => names.includes(x)) })), globalConfigPresent: await exists(this.globalConfig) };
  }
  async backup(onProgress = () => {}) {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = path.join(this.dataDir, 'backups', `${id}.partial`);
    await fs.mkdir(dir, { mode: 0o700 });
    const manifest = { version: 1, createdAt: new Date().toISOString(), sourceDir: this.sourceDir, files: [], links: [], warnings: [], exclusions: ['macOS Keychain', 'Remote-only data', 'Sockets and other special files'] };
    let bytes = 0;
    const copy = async (source, relative) => {
      const stat = await fs.lstat(source);
      const dest = path.join(dir, relative);
      if (stat.isSymbolicLink()) { manifest.links.push({ path: relative, target: await fs.readlink(source) }); return; }
      if (stat.isDirectory()) {
        await fs.mkdir(dest, { recursive: true, mode: 0o700 });
        for (const name of await fs.readdir(source)) {
          try { await copy(path.join(source, name), path.join(relative, name)); }
          catch (e) { manifest.warnings.push(`${path.join(relative, name)}: ${e.code || e.message}`); }
        }
        return;
      }
      if (!stat.isFile()) { manifest.warnings.push(`${relative}: special file skipped`); return; }
      const hash = crypto.createHash('sha256');
      let size = 0;
      await pipeline(createReadStream(source), new Transform({ transform(chunk, _, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } }), createWriteStream(dest, { mode: 0o600, flags: 'wx' }));
      const after = await fs.stat(source);
      if (stat.mtimeMs !== after.mtimeMs || stat.size !== after.size) manifest.warnings.push(`${relative}: changed during backup; close Claude and back up again for a stable snapshot`);
      manifest.files.push({ path: relative, size, sha256: hash.digest('hex') });
      bytes += size;
      if (manifest.files.length % 100 === 0) onProgress({ files: manifest.files.length, bytes });
    };
    try {
      if (await exists(this.sourceDir)) await copy(this.sourceDir, 'claude');
      if (await exists(this.globalConfig)) await copy(this.globalConfig, 'global.claude.json');
      await copy(path.join(this.dataDir, 'profiles'), 'profiles');
      await copy(this.stateFile, 'workspace.json');
      await atomicJSON(path.join(dir, 'manifest.json'), manifest);
      const finalDir = path.join(this.dataDir, 'backups', id);
      await fs.rename(dir, finalDir);
      const summary = { id, createdAt: manifest.createdAt, files: manifest.files.length, bytes, warnings: manifest.warnings, links: manifest.links.length, path: finalDir };
      this.state.backups.unshift(summary);
      await this.save();
      return summary;
    } catch (e) { throw new Error(`Sao lưu chưa hoàn tất; dữ liệu gốc không đổi. ${e.message}`); }
  }
  async launchCommand({ profileId, sessionKey, cwd, login = false, cli }) {
    const profile = this.profile(profileId);
    const session = sessionKey ? this.session(sessionKey) : null;
    const workdir = session?.cwd || cwd || os.homedir();
    if (!path.isAbsolute(workdir) || !(await fs.stat(workdir).catch(() => null))?.isDirectory()) throw new Error('Thư mục dự án không còn tồn tại. Hãy khôi phục dự án ở đường dẫn cũ để resume đúng session.');
    const args = login ? ['auth', 'login'] : ['--settings', '{"cleanupPeriodDays":36500}', ...(session ? ['--resume', session.id] : [])];
    const cleanKeys = Object.keys(process.env).filter(k => AUTH_ENV.test(k));
    // Common shell variables are explicitly cleared even when Electron did not inherit them.
    const unset = [...new Set([...cleanKeys, 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_PATH', 'CLAUDECODE'])];
    const config = profile.system ? '' : `export CLAUDE_CONFIG_DIR=${shellQuote(this.configDir(profileId))}\n`;
    return `(\nunset ${unset.filter(k => /^[A-Z_0-9]+$/.test(k)).join(' ')}\n${config}cd ${shellQuote(workdir)} || exit 1\n${shellQuote(cli)} ${args.map(shellQuote).join(' ')}\n)`;
  }
  async launcher(options) {
    const command = await this.launchCommand(options);
    const script = `#!/bin/zsh\n# Generated by Claude Switch. No credentials are stored in this launcher.\n${command}\nresult=$?\nprintf '\\nClaude exited (%s). Press Enter to close.\\n' "$result"\nread -r\nexit "$result"\n`;
    const file = path.join(this.dataDir, 'launchers', `${crypto.randomUUID()}.command`);
    await fs.writeFile(file, script, { mode: 0o700 });
    return file;
  }
}
