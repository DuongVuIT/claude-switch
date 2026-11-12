const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '../assets/icon.svg'));
  const image = await win.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, '../assets/icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
