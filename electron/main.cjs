const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const exec = promisify(execFile);
let workspace, desktop, win, cli, core;
let mutation = Promise.resolve();
let scan = null;
const entry = pathToFileURL(path.join(__dirname, '../src/index.html')).href;
app.setName('Claude Switch');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

async function findCLI() {
  const candidates = [process.env.CLAUDE_SWITCH_CLI, path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...String(process.env.PATH || '').split(path.delimiter).map(p => path.join(p, 'claude'))].filter(Boolean);
  for (const p of candidates) { try { await fs.access(p, 1); return p; } catch {} }
  return null;
}
async function auth(id, cwd = os.homedir()) {
  if (!cli) return { state: 'missing', message: 'Chưa tìm thấy Claude Code.' };
  const profile = workspace.profile(id);
  const env = core.cleanEnvironment();
  if (!profile.system) env.CLAUDE_CONFIG_DIR = workspace.configDir(id);
  let output;
  try { output = (await exec(cli, ['auth', 'status'], { env, cwd, timeout: 15000, maxBuffer: 1024 * 1024 })).stdout; }
  catch (e) {
    if (e.stdout && !e.killed) output = e.stdout;
    else return { state: 'unknown', message: 'Không kiểm tra được đăng nhập. Mở Terminal để kiểm tra lại.' };
  }
  try {
    const value = JSON.parse(output);
    const fields = ['loggedIn', 'authMethod', 'apiProvider', 'email', 'orgId', 'orgName', 'subscriptionType'];
    return { state: value.loggedIn ? 'connected' : 'signed-out', ...Object.fromEntries(fields.filter(k => value[k] !== undefined).map(k => [k, value[k]])) };
  } catch { return { state: 'unknown', message: 'CLI trả về trạng thái không nhận diện được.' }; }
}
async function snapshot(refreshAuth = false) {
  if (!scan) scan = workspace.sessions().finally(() => { scan = null; });
  const [{ sessions, warnings }, profiles, inventory] = await Promise.all([scan, workspace.profiles(), workspace.inventory()]);
  if (refreshAuth) await Promise.all(profiles.map(async p => { p.auth = await auth(p.id); }));
  return { profiles, sessions, warnings, inventory, activeId: workspace.state.activeId, backups: workspace.state.backups, cli, desktop: await desktop.snapshot() };
}
function handle(channel, fn, write = false) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame?.url !== entry) throw new Error('Untrusted frame.');
    const action = async () => fn(...args);
    if (!write) return action();
    const next = mutation.then(action, action);
    mutation = next.catch(() => {});
    return next;
  });
}
function setupIPC() {
  handle('workspace:load', () => snapshot(true));
  handle('desktop:load', () => desktop.snapshot());
  handle('desktop:create', async name => { const id = await desktop.create(name); return { id, desktop: await desktop.snapshot() }; }, true);
  handle('desktop:rename', async (id, name) => { await desktop.renameProfile(id, name); return desktop.snapshot(); }, true);
  handle('desktop:switch', async (id, options) => { const result = await desktop.apply(id, { carryHistory: options?.carryHistory === true, orgId: options?.orgId }); return { ...result, desktop: await desktop.snapshot() }; }, true);
  handle('desktop:recover', async () => { await desktop.recover(); return desktop.snapshot(); }, true);
  handle('desktop:reveal', id => shell.openPath(desktop.location(id)));
  handle('profile:create', async name => {
    if (!String(name || '').trim() || String(name).length > 60) throw new Error('Tên tài khoản cần có từ 1 đến 60 ký tự.');
    if (!workspace.state.backups.length) await workspace.backup(progress => win?.webContents.send('backup:progress', progress));
    const id = await workspace.createProfile(name);
    return { id, snapshot: await snapshot(true) };
  }, true);
  handle('profile:activate', async id => { await workspace.activate(id); return id; }, true);
  handle('session:read', (key, offset) => workspace.transcript(String(key), Math.max(0, Number(offset) || 0)));
  handle('terminal:launch', async args => {
    if (!cli) throw new Error('Chưa tìm thấy Claude Code. Cài Claude Code rồi mở lại ứng dụng.');
    workspace.profile(args.profileId);
    if (!args.login) {
      const status = await auth(args.profileId);
      if (status.state !== 'connected') throw new Error('Tài khoản chưa được xác nhận đăng nhập. Bấm Đăng nhập, hoàn tất trong Terminal, rồi Làm mới.');
    }
    if (!args.login && !args.sessionKey && !args.cwd) {
      const selected = await dialog.showOpenDialog(win, { title: 'Chọn thư mục để làm việc với Claude', properties: ['openDirectory'] });
      if (selected.canceled) return { canceled: true };
      args.cwd = selected.filePaths[0];
    }
    const cwd = args.sessionKey ? workspace.session(args.sessionKey).cwd : args.cwd;
    if (!args.login && cwd) {
      const [accountStatus, projectStatus] = await Promise.all([auth(args.profileId), auth(args.profileId, cwd)]);
      if (projectStatus.state !== 'connected' || ['authMethod', 'email', 'orgId'].some(k => accountStatus[k] !== projectStatus[k])) throw new Error('Cấu hình xác thực của dự án khác tài khoản đã chọn. Kiểm tra env/apiKeyHelper trong cấu hình Claude của dự án trước khi mở.');
    }
    const launcher = await workspace.launcher({ profileId: args.profileId, sessionKey: args.sessionKey, cwd: args.cwd, login: args.login === true, cli });
    await exec('/usr/bin/open', ['-a', 'Terminal', launcher]);
    return { opened: true };
  }, true);
  handle('session:copy-command', async args => {
    if (!cli) throw new Error('Chưa tìm thấy Claude Code.');
    const command = await workspace.launchCommand({ profileId: args.profileId, sessionKey: args.sessionKey, cli });
    clipboard.writeText(command);
    return true;
  });
  handle('backup:create', () => workspace.backup(progress => win?.webContents.send('backup:progress', progress)), true);
  handle('backup:reveal', id => {
    const backup = workspace.state.backups.find(b => b.id === id);
    if (!backup) throw new Error('Không tìm thấy bản sao lưu.');
    shell.showItemInFolder(path.join(backup.path, 'manifest.json'));
  });
  handle('data:reveal', () => shell.openPath(workspace.dataDir));
}
async function createWindow() {
  win = new BrowserWindow({ width: 1400, height: 920, minWidth: 820, minHeight: 620, title: 'Claude Switch', backgroundColor: '#f6f5f1', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await win.loadFile(path.join(__dirname, '../src/index.html'));
}
app.whenReady().then(async () => {
  core = await import('./core.mjs');
  workspace = await new core.Workspace({ dataDir: process.env.CLAUDE_SWITCH_DATA_DIR || app.getPath('userData'), sourceDir: process.env.CLAUDE_SWITCH_SOURCE_DIR, globalConfig: process.env.CLAUDE_SWITCH_GLOBAL_CONFIG }).init();
  const { DesktopProfiles } = await import('./desktop.mjs');
  const bridge = app.isPackaged ? path.join(process.resourcesPath, 'desktop-bridge') : path.join(__dirname, '../native/desktop-bridge');
  const call = async action => {
    try { const { stdout } = await exec(bridge, [action], { timeout: 35000, maxBuffer: 1024 * 64 }); return JSON.parse(stdout); }
    catch (e) { let message; try { message = JSON.parse(e.stdout).error; } catch {} throw new Error(message || 'Không điều khiển được Claude desktop. Kiểm tra ứng dụng Claude đã cài và thử lại.'); }
  };
  const stopDesktop = async () => {
    await call('quit');
    // The main window can exit before its Claude Code workers. Never move their live databases.
    const roots = ['/Applications/Claude.app/', path.join(os.homedir(), 'Applications/Claude.app/'), path.join(os.homedir(), 'Library/Application Support/Claude/')];
    for (let attempt = 0; attempt < 80; attempt++) {
      const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
      const workers = stdout.split('\n').filter(line => roots.some(root => line.trim().replace(/^\d+\s+/, '').startsWith(root)));
      if (!workers.length) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Claude còn tiến trình con đang chạy. Chưa chuyển dữ liệu; dừng tác vụ Code/Cowork rồi thử lại.');
  };
  let adapter = { status: () => call('status'), quit: stopDesktop, open: () => call('open') };
  if (!app.isPackaged && process.env.CLAUDE_SWITCH_TEST_DESKTOP === '1') {
    let running = false;
    adapter = { status: async () => ({ installed: true, running }), quit: async () => { running = false; }, open: async () => { running = true; } };
  }
  desktop = await new DesktopProfiles({ dataDir: workspace.dataDir, liveDir: process.env.CLAUDE_SWITCH_DESKTOP_DIR, adapter }).init();
  cli = await findCLI();
  setupIPC();
  await createWindow();
}).catch(e => { dialog.showErrorBox('Không mở được Claude Switch', e.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (workspace && BrowserWindow.getAllWindows().length === 0) createWindow(); });
