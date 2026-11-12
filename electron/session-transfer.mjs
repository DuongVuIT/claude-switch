import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { readJSON } from './core.mjs';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const LOCAL = /^local_[a-f\d-]{36}$/i;
const portable = ['sessionId', 'cliSessionId', 'cwd', 'originCwd', 'title', 'titleSource', 'createdAt', 'lastActivityAt', 'lastFocusedAt', 'model', 'effort', 'isArchived', 'completedTurns', 'lastAssistantUuid', 'lastAssistantCliSessionId', 'postTurnSummary', 'postTurnSummaryFor', 'titleTurn', 'gitAnchorsLookupOnly', 'gitAnchorsFolderRealpath', 'gitAnchors', 'writtenBranches', 'writtenRepositories', 'forkedFromSessionId'];
async function entries(dir) { return fs.readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; }); }
async function exists(p) { try { await fs.lstat(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
export async function buckets(root, accountId) {
  if (!UUID.test(accountId || '')) return [];
  return (await entries(path.join(root, 'claude-code-sessions', accountId))).filter(x => x.isDirectory() && UUID.test(x.name)).map(x => x.name);
}
export async function transferPlan({ source, target, orgId, transcriptRoot = path.join(os.homedir(), '.claude/projects') }) {
  const accountId = (await readJSON(path.join(target, 'config.json'), {})).lastKnownAccountUuid;
  const orgs = await buckets(target, accountId);
  if (!orgId && orgs.length === 1) orgId = orgs[0];
  if (!UUID.test(accountId || '') || !orgs.includes(orgId)) throw new Error('Đăng nhập hồ sơ đích và chọn đúng organization trước khi mang lịch sử sang.');
  const targetDir = path.join(target, 'claude-code-sessions', accountId, orgId);
  for (const directory of [path.join(source, 'claude-code-sessions'), path.join(target, 'claude-code-sessions'), path.join(target, 'claude-code-sessions', accountId), targetDir]) {
    const entry = await fs.lstat(directory).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (entry?.isSymbolicLink()) throw new Error('Thư mục metadata session là symlink. Không chuyển dữ liệu ra ngoài hồ sơ.');
  }
  const transcripts = new Map();
  for (const folder of await entries(transcriptRoot)) {
    if (!folder.isDirectory()) continue;
    for (const file of await entries(path.join(transcriptRoot, folder.name))) {
      if (file.isFile() && file.name.endsWith('.jsonl')) transcripts.set(file.name.slice(0, -6), path.join(transcriptRoot, folder.name, file.name));
    }
  }
  const sessions = new Map();
  const warnings = [];
  const base = path.join(source, 'claude-code-sessions');
  for (const account of await entries(base)) {
    if (!account.isDirectory() || !UUID.test(account.name)) continue;
    for (const org of await entries(path.join(base, account.name))) {
      if (!org.isDirectory() || !UUID.test(org.name)) continue;
      for (const file of await entries(path.join(base, account.name, org.name))) {
        if (!file.isFile() || !LOCAL.test(file.name.slice(0, -5)) || !file.name.endsWith('.json')) continue;
        const sourceFile = path.join(base, account.name, org.name, file.name);
        const record = await readJSON(sourceFile);
        if (!LOCAL.test(record?.sessionId || '') || file.name !== `${record.sessionId}.json` || !UUID.test(record.cliSessionId || '')) throw new Error(`Metadata session không hợp lệ: ${file.name}`);
        const transcript = transcripts.get(record.cliSessionId);
        if (!transcript) throw new Error(`Thiếu transcript cho ${record.title || record.sessionId}. Chưa chuyển tài khoản.`);
        const previous = sessions.get(record.sessionId);
        if (previous && previous.record.cliSessionId !== record.cliSessionId) throw new Error(`Session ID xung đột: ${record.sessionId}`);
        if (previous && String(previous.record.lastActivityAt || '') > String(record.lastActivityAt || '')) continue;
        const destination = path.join(targetDir, file.name);
        if ((await fs.lstat(destination).catch(e => { if (e.code === 'ENOENT') return null; throw e; }))?.isSymbolicLink()) throw new Error('Metadata đích là symlink. Không theo liên kết ngoài hồ sơ.');
        const existing = await readJSON(destination);
        if (existing && existing.cliSessionId !== record.cliSessionId) throw new Error(`Session đích xung đột: ${record.sessionId}. Không ghi đè.`);
        if (!record.cwd || !path.isAbsolute(record.cwd) || !(await exists(record.cwd))) warnings.push(`${record.title || record.sessionId}: thư mục dự án không còn tại đường dẫn đã lưu.`);
        sessions.set(record.sessionId, { sourceFile, destination, record, transcript, existing: !!existing });
      }
    }
  }
  return { source, target, accountId, orgId, targetDir, sessions: [...sessions.values()], warnings };
}
export async function prepareTransfer(plan, backupRoot) {
  const dir = path.join(backupRoot, `desktop-transfer-${Date.now()}-${crypto.randomUUID()}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const manifest = { version: 1, createdAt: new Date().toISOString(), source: plan.source, target: plan.target, accountId: plan.accountId, orgId: plan.orgId, status: 'preparing', sessions: [], warnings: plan.warnings, note: 'Local Code session index only; transcripts remain in shared .claude/projects. Credentials, remote connectors, permission grants and scheduled tasks are not copied.' };
  await fs.mkdir(path.join(dir, 'original-metadata'), { mode: 0o700 });
  const added = [];
  try {
    // Scratch project paths embedded in transcripts must remain valid after changing user-data.
    for (const name of ['scratch-workspaces', 'side-session-notes']) {
      const source = path.join(plan.source, name), target = path.join(plan.target, name);
      if (await exists(source)) await fs.cp(source, target, { recursive: true, force: false, errorOnExist: false, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
    }
    await fs.mkdir(plan.targetDir, { recursive: true, mode: 0o700 });
    for (const item of plan.sessions) {
      const original = await fs.readFile(item.sourceFile);
      await fs.writeFile(path.join(dir, 'original-metadata', `${item.record.sessionId}.json`), original, { mode: 0o600, flag: 'wx' });
      const entry = { id: item.record.sessionId, cliSessionId: item.record.cliSessionId, transcript: item.transcript, sourceSha256: crypto.createHash('sha256').update(original).digest('hex'), action: item.existing ? 'kept-target' : 'added' };
      manifest.sessions.push(entry);
      if (!item.existing) {
        const record = Object.fromEntries(portable.filter(k => item.record[k] !== undefined).map(k => [k, item.record[k]]));
        // Let the destination account build its own auth, connectors and tool permissions.
        record.permissionMode = 'default';
        record.remoteControlAutoEligible = false;
        const file = await fs.open(item.destination, 'wx', 0o600);
        added.push(item.destination);
        try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
      }
      const saved = await readJSON(item.destination);
      if (saved.cliSessionId !== item.record.cliSessionId) throw new Error('Không xác minh được liên kết transcript sau khi chuyển.');
    }
    manifest.status = 'prepared';
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return { path: dir, added: added.length, kept: plan.sessions.length - added.length, total: plan.sessions.length, warnings: plan.warnings, accountId: plan.accountId, orgId: plan.orgId };
  } catch (e) {
    for (const file of added) await fs.rm(file, { force: true });
    manifest.status = 'failed'; manifest.error = e.message;
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    throw e;
  }
}
