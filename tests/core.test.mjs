import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Workspace, SHARED, cleanEnvironment, shellQuote } from '../electron/core.mjs';
const exec = promisify(execFile);
const sessionId = '11111111-1111-4111-8111-111111111111';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-switch-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'original');
  const globalConfig = path.join(root, 'global.json');
  const cwd = path.join(root, "my project ' $(touch PWNED)");
  await fs.mkdir(cwd);
  await fs.mkdir(path.join(sourceDir, 'projects', '-test'), { recursive: true });
  const sessionFile = path.join(sourceDir, 'projects', '-test', `${sessionId}.jsonl`);
  const records = [
    { type: 'user', uuid: 'u1', cwd, message: { content: 'Tiếp tục công việc với dữ liệu gốc' } },
    { type: 'assistant', uuid: 'a1', cwd, message: { content: [{ type: 'text', text: 'Đã giữ đầy đủ ngữ cảnh.' }, { type: 'tool_use', name: 'Read', input: { path: 'some-file' } }], model: 'claude-test' } },
    { type: 'custom-title', customTitle: 'Hội thoại thử nghiệm' },
  ];
  await fs.writeFile(sessionFile, records.map(r => JSON.stringify(r)).join('\n') + '\n{"partial":');
  await fs.mkdir(path.join(sourceDir, 'projects', '-test', sessionId, 'subagents'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'projects', '-test', sessionId, 'subagents', 'agent.jsonl'), 'original agent data');
  await fs.writeFile(path.join(sourceDir, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'secret', ANTHROPIC_BASE_URL: 'https://example.invalid', SAFE_VALUE: 'kept' }, apiKeyHelper: 'do-not-copy', forceLoginOrgUUID: 'old-org', permissions: { defaultMode: 'default' } }));
  await fs.writeFile(globalConfig, JSON.stringify({ oauthAccount: { emailAddress: 'test@example.invalid', displayName: 'Test User', accessToken: 'NEVER EXPOSE', accountUuid: 'account-test' }, mcpServers: { example: { command: 'example' } } }));
  const workspace = await new Workspace({ dataDir: path.join(root, 'app'), sourceDir, globalConfig }).init();
  return { root, workspace, sourceDir, sessionFile, cwd, globalConfig };
}
test('indexes original sessions, preserves malformed lines, and previews text plus tools', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(f.sessionFile);
  const { sessions, warnings } = await f.workspace.sessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, 'Hội thoại thử nghiệm');
  assert.equal(sessions[0].cwd, f.cwd);
  assert.equal(warnings.length, 1);
  const transcript = await f.workspace.transcript(sessions[0].key);
  assert.equal(transcript.messages.length, 2);
  assert.deepEqual(transcript.messages[1].tools, ['Read']);
  assert.deepEqual(await fs.readFile(f.sessionFile), before);
  assert.throws(() => f.workspace.session('../../etc/passwd'), /Session/);
});
test('new accounts isolate credentials and retain the exact session tree including subagents', async t => {
  const f = await fixture(t);
  const settingsBefore = await fs.readFile(path.join(f.sourceDir, 'settings.json'));
  const id = await f.workspace.createProfile('Work');
  const config = f.workspace.configDir(id);
  for (const item of SHARED) assert.equal(await fs.realpath(path.join(config, item)), await fs.realpath(path.join(f.sourceDir, item)));
  assert.equal(await fs.readFile(path.join(config, 'projects', '-test', sessionId, 'subagents', 'agent.jsonl'), 'utf8'), 'original agent data');
  const settings = JSON.parse(await fs.readFile(path.join(config, 'settings.json')));
  assert.deepEqual(settings.env, { SAFE_VALUE: 'kept' });
  assert.equal(settings.apiKeyHelper, undefined);
  assert.equal(settings.forceLoginOrgUUID, undefined);
  assert.equal(settings.cleanupPeriodDays, 36500);
  const global = JSON.parse(await fs.readFile(path.join(config, '.claude.json')));
  assert.equal(global.oauthAccount, undefined);
  assert.ok(global.mcpServers.example);
  assert.deepEqual(await fs.readFile(path.join(f.sourceDir, 'settings.json')), settingsBefore);
  assert.equal((await f.workspace.metadata('system')).accessToken, undefined);
  await f.workspace.activate(id);
  const reopened = await new Workspace({ dataDir: f.workspace.dataDir, sourceDir: f.sourceDir, globalConfig: f.globalConfig }).init();
  assert.equal(reopened.state.activeId, id);
  await assert.rejects(f.workspace.createProfile(''), /Tên tài khoản/);
});
test('snapshot hashes every copied file, records symlinks and restricts permissions', async t => {
  const f = await fixture(t);
  await f.workspace.createProfile('Work');
  await fs.symlink(f.root, path.join(f.sourceDir, 'outside-link'));
  const backup = await f.workspace.backup();
  const manifest = JSON.parse(await fs.readFile(path.join(backup.path, 'manifest.json')));
  assert.ok(manifest.files.length >= 7);
  assert.ok(manifest.links.some(l => l.path === 'claude/outside-link'));
  for (const file of manifest.files) {
    const saved = await fs.readFile(path.join(backup.path, file.path));
    assert.equal(saved.length, file.size);
    assert.equal(crypto.createHash('sha256').update(saved).digest('hex'), file.sha256);
    assert.equal((await fs.stat(path.join(backup.path, file.path))).mode & 0o777, 0o600);
  }
  assert.equal((await fs.stat(backup.path)).mode & 0o777, 0o700);
  assert.equal(await fs.readFile(path.join(backup.path, 'claude/projects/-test', `${sessionId}.jsonl`), 'utf8'), await fs.readFile(f.sessionFile, 'utf8'));
});
test('launcher safely quotes paths and passes exact account and session without command injection', async t => {
  const f = await fixture(t);
  const id = await f.workspace.createProfile("Work's $(touch PWNED)");
  const { sessions } = await f.workspace.sessions();
  const cli = path.join(f.root, 'fake claude');
  const output = path.join(f.root, 'arguments.json');
  await fs.writeFile(cli, `#!/bin/sh\n${shellQuote(process.execPath)} -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),config:process.env.CLAUDE_CONFIG_DIR,key:process.env.ANTHROPIC_API_KEY}))' ${shellQuote(output)} "$@"\n`, { mode: 0o700 });
  const file = await f.workspace.launcher({ profileId: id, sessionKey: sessions[0].key, cli });
  const processResult = exec('/bin/zsh', [file], { env: { ...process.env, ANTHROPIC_API_KEY: 'bad-key' } });
  processResult.child.stdin.end('\n');
  await processResult;
  const received = JSON.parse(await fs.readFile(output));
  assert.deepEqual(received.args, ['--settings', '{"cleanupPeriodDays":36500}', '--resume', sessionId]);
  assert.equal(await fs.realpath(received.cwd), await fs.realpath(f.cwd));
  assert.equal(received.config, f.workspace.configDir(id));
  assert.equal(received.key, undefined);
  await assert.rejects(fs.access(path.join(f.cwd, 'PWNED')));
  assert.equal(cleanEnvironment({ ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', PATH: '/bin' }).PATH, '/bin');
  assert.equal(Object.keys(cleanEnvironment({ CLAUDE_CODE_OAUTH_TOKEN: 'secret' })).length, 0);
  await assert.rejects(f.workspace.launcher({ profileId: id, cwd: '/this/path/does/not/exist', cli }), /Thư mục/);
});
test('transcript pagination does not drop later messages and deduplicates repeated UUIDs', async t => {
  const f = await fixture(t);
  const lines = Array.from({ length: 173 }, (_, i) => JSON.stringify({ type: 'user', uuid: `m${i}`, cwd: f.cwd, message: { content: `Message ${i}` } }));
  await fs.writeFile(f.sessionFile, [...lines, lines[0]].join('\n'));
  const { sessions } = await f.workspace.sessions();
  const first = await f.workspace.transcript(sessions[0].key);
  const second = await f.workspace.transcript(sessions[0].key, 80);
  const last = await f.workspace.transcript(sessions[0].key, 160);
  assert.equal(first.messages.length, 80);
  assert.equal(second.messages.length, 80);
  assert.equal(last.messages.length, 13);
  assert.equal(last.hasMore, false);
  assert.equal(first.total, 173);
  assert.equal(last.messages.at(-1).text, 'Message 172');
});
test('rejects recursive backup locations including symlinked data directories', async t => {
  const f = await fixture(t);
  await assert.rejects(new Workspace({ dataDir: path.join(f.sourceDir, 'app'), sourceDir: f.sourceDir }).init(), /sao lưu đệ quy/);
  await fs.mkdir(path.join(f.sourceDir, 'nested'));
  await fs.symlink(path.join(f.sourceDir, 'nested'), path.join(f.root, 'linked-data'));
  await assert.rejects(new Workspace({ dataDir: path.join(f.root, 'linked-data'), sourceDir: f.sourceDir }).init(), /liên kết/);
});
