// Explicit manual validation against local data. Does not log in, launch Claude, or send prompts.
// Creates one local backup through the app if it has no backup yet.
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function hash(file) { const h = crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); }
async function originalSessions() {
  const root = path.join(os.homedir(), '.claude/projects');
  const result = {};
  for (const folder of await fs.readdir(root, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const file of await fs.readdir(path.join(root, folder.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.jsonl')) result[`${folder.name}/${file.name}`] = await hash(path.join(root, folder.name, file.name));
    }
  }
  return result;
}
const before = await originalSessions();
const executablePath = path.join(repo, 'release/Claude Switch-darwin-arm64/Claude Switch.app/Contents/MacOS/Claude Switch');
const app = await electron.launch({ executablePath, args: [], timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Đổi tài khoản, mang theo session Code.' }).waitFor({ timeout: 60000 });
  let snapshot = await page.evaluate(() => window.claudeSwitch.load());
  assert.ok(snapshot.sessions.length > 0);
  const initialBackups = snapshot.backups.length;
  if (!initialBackups) {
    await page.locator('[data-view="vault"].nav-item').click();
    await page.getByRole('button', { name: 'Tạo bản sao lưu', exact: true }).click();
    await page.getByRole('button', { name: 'Mở bản sao' }).first().waitFor({ timeout: 120000 });
    snapshot = await page.evaluate(() => window.claudeSwitch.load());
  }
  const backup = snapshot.backups[0];
  const manifest = JSON.parse(await fs.readFile(path.join(backup.path, 'manifest.json')));
  for (const file of manifest.files) assert.equal(await hash(path.join(backup.path, file.path)), file.sha256, `Checksum failed: ${file.path}`);
  assert.deepEqual(await originalSessions(), before, 'Original session files must remain byte-for-byte unchanged');
  await page.locator('[data-view="overview"].nav-item').click();
  await fs.mkdir(path.join(repo, '.local/qa'), { recursive: true });
  await page.screenshot({ path: path.join(repo, '.local/qa/overview-live.png') });
  console.log(JSON.stringify({ packagedApp: true, sessions: snapshot.sessions.length, sessionReadWarnings: snapshot.warnings.length, authStates: snapshot.profiles.map(p => p.auth.state), originalSessionHashesUnchanged: true, backup: { files: backup.files, bytes: backup.bytes, warnings: backup.warnings, symlinks: backup.links, verifiedHashes: manifest.files.length, path: backup.path }, appData: snapshot.inventory.dataDir }, null, 2));
} finally { await app.close(); }
