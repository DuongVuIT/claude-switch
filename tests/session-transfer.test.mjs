import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { transferPlan, prepareTransfer } from '../electron/session-transfer.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', org = '33333333-3333-4333-8333-333333333333', cli = '44444444-4444-4444-8444-444444444444';
async function setup(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'transfer-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'source'), target = path.join(root, 'target'), transcriptRoot = path.join(root, 'projects');
 const src = path.join(source, 'claude-code-sessions', a, org), dst = path.join(target, 'claude-code-sessions', b, org);
 for (const dir of [src, dst, path.join(transcriptRoot, '-test')]) await fs.mkdir(dir, { recursive: true });
 await fs.writeFile(path.join(target, 'config.json'), JSON.stringify({ lastKnownAccountUuid: b, token: 'TARGET_ONLY' }));
 const record = { sessionId: `local_${a}`, cliSessionId: cli, cwd: root, title: 'Test', permissionMode: 'bypassPermissions', remoteMcpServersConfig: { token: 'SOURCE_SECRET' }, spawnSeed: 'SOURCE_AUTH', alwaysAllowedReasons: ['all'], remoteControlAutoEligible: true };
 const srcFile = path.join(src, `${record.sessionId}.json`);
 await fs.writeFile(srcFile, JSON.stringify(record));
 await fs.writeFile(path.join(transcriptRoot, '-test', `${cli}.jsonl`), 'transcript content untouched');
 return { root, source, target, transcriptRoot, srcFile, dst, record };
}
test('transfer prepares exact transcript IDs in target account without copying auth, grants, or editing history', async t => {
 const f = await setup(t);
 const plan = await transferPlan(f);
 const result = await prepareTransfer(plan, path.join(f.root, 'backups'));
 assert.equal(result.added, 1);
 const record = JSON.parse(await fs.readFile(path.join(f.dst, `${f.record.sessionId}.json`)));
 assert.equal(record.cliSessionId, cli);
 assert.equal(record.permissionMode, 'default');
 assert.equal(record.remoteMcpServersConfig, undefined);
 assert.equal(record.spawnSeed, undefined);
 assert.equal(record.alwaysAllowedReasons, undefined);
 assert.equal(record.remoteControlAutoEligible, false);
 assert.equal(await fs.readFile(path.join(f.transcriptRoot, '-test', `${cli}.jsonl`), 'utf8'), 'transcript content untouched');
 assert.deepEqual(JSON.parse(await fs.readFile(f.srcFile)), f.record);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.target, 'config.json'))).token, 'TARGET_ONLY');
 const second = await prepareTransfer(await transferPlan(f), path.join(f.root, 'backups'));
 assert.equal(second.added, 0);
 assert.equal(second.kept, 1);
});
test('missing transcript, mismatched target session and ambiguous organization all block transfer', async t => {
 const f = await setup(t);
 await fs.writeFile(path.join(f.dst, `${f.record.sessionId}.json`), JSON.stringify({ ...f.record, cliSessionId: b }));
 await assert.rejects(transferPlan(f), /xung đột/);
 await fs.rm(path.join(f.dst, `${f.record.sessionId}.json`));
 await fs.mkdir(path.join(f.target, 'claude-code-sessions', b, a));
 await assert.rejects(transferPlan(f), /organization/);
 await fs.rm(path.join(f.transcriptRoot, '-test', `${cli}.jsonl`));
 await assert.rejects(transferPlan({ ...f, orgId: org }), /Thiếu transcript/);
});
test('missing project folders are reported and preserved, existing target metadata is never replaced', async t => {
 const f = await setup(t);
 await fs.writeFile(f.srcFile, JSON.stringify({ ...f.record, cwd: '/not-present/old-project' }));
 const target = { ...f.record, title: 'Target newer title' };
 await fs.writeFile(path.join(f.dst, `${f.record.sessionId}.json`), JSON.stringify(target));
 const plan = await transferPlan(f);
 assert.equal(plan.warnings.length, 1);
 await prepareTransfer(plan, path.join(f.root, 'backups'));
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.dst, `${f.record.sessionId}.json`))), target);
});
