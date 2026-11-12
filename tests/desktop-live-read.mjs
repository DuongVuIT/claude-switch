// Opens our packaged app and reads official Claude metadata. Never calls desktop:switch/quit/login.
import { _electron as electron } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = path.join(repo, 'release/Claude Switch-darwin-arm64/Claude Switch.app/Contents');
const bridge = path.join(bundle, 'Resources/desktop-bridge');
const before = JSON.parse((await exec(bridge, ['status'])).stdout);
const app = await electron.launch({ executablePath: path.join(bundle, 'MacOS/Claude Switch'), args: [], timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Đổi tài khoản, mang theo session Code.' }).waitFor({ timeout: 60000 });
  const snapshot = await page.evaluate(() => window.claudeSwitch.desktopLoad());
  assert.equal(snapshot.app.installed, true);
  assert.equal(snapshot.app.running, before.running);
  assert.ok(snapshot.profiles.length > 0);
  assert.ok(snapshot.profiles[0].sessionCount > 0);
  assert.ok(snapshot.profiles.some(p => p.id === snapshot.activeId));
  const emptyProfiles = snapshot.profiles.filter(p => !p.active && p.sessionCount === 0 && !p.orgIds?.length);
  assert.ok(emptyProfiles.every(p => p.switchBlockReason?.includes('thiếu')));
  for (const p of emptyProfiles) assert.equal(await page.locator('.account-card').filter({ hasText: p.name }).getByRole('button', { name: 'Dùng tài khoản này' }).isDisabled(), true);
  await page.screenshot({ path: path.join(repo, '.local/qa/desktop-live.png') });
  const after = JSON.parse((await exec(bridge, ['status'])).stdout);
  assert.deepEqual(after.pids, before.pids);
  const snapshotFile = path.join(repo, '.local/qa/desktop-validation.json');
  const result = { packagedApp: true, officialAppRunning: after.running, officialAppPidsUnchanged: true, desktopProfiles: snapshot.profiles.length, desktopSessions: snapshot.profiles[0].sessionCount, hasCachedAccountId: !!snapshot.profiles[0].accountId, recoveryRequired: snapshot.recoveryRequired, didSwitchOfficialApp: false };
  await fs.writeFile(snapshotFile, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await app.close(); }
