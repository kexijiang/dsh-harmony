const { app, BrowserWindow, session, Menu, nativeTheme, screen } = require('electron');
const { join } = require('node:path');
let window, state, quitting = false, origin, geometry;
const send = value => { if (process.connected) process.send(value); };
const reportWindow = () => { if (window && !window.isDestroyed()) send({type:'window-state',value:{visible:window.isVisible(),focused:window.isFocused(),alwaysOnTop:window.isAlwaysOnTop(),bounds:window.getBounds()}}); };
// Electron's default "floating" level does not retain WS_EX_TOPMOST on this
// Windows runtime. Use its explicit Windows topmost band only when pinned.
const setPinned = value => window.setAlwaysOnTop(!!value, value ? 'pop-up-menu' : 'normal');
function resize() {
  if (!window || !geometry) return;
  const bounds = screen.getDisplayMatching(window.getBounds()).workAreaSize;
  const height = Math.round(Math.min(bounds.height - 100, 720 * state.scale / 100));
  const width = Math.max(240, Math.min(bounds.width - 80, Math.round((height - (geometry.chromeHeight || 84)) * geometry.width / geometry.height)));
  window.setSize(width, height);
}
process.on('message', async message => {
  try {
    if (message.type === 'init') {
      origin = message.origin; state = message.state;
      app.setName('DSH Harmony Mirror'); app.setPath('userData', join(message.dataDir, 'native-window'));
      app.setAppUserModelId('dsh.harmony.mirror');
      await app.whenReady();
      const ownedSession = session.fromPartition(`harmony-${process.pid}`);
      ownedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      window = new BrowserWindow({ width:380, height:760, minWidth:240, minHeight:320, frame:false, show:false, title:'鸿蒙投屏 · DSH', backgroundColor:state.theme.mode === 'dark' ? '#17181b' : '#ffffff', webPreferences:{session:ownedSession, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true} });
      ownedSession.webRequest.onBeforeSendHeaders({urls:[`${origin}/*`]}, (details, callback) => {
        const headers = {...details.requestHeaders};
        if (details.webContentsId === window?.webContents.id) headers['X-Harmony-Native'] = message.token;
        callback({requestHeaders:headers});
      });
      window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/harmony/')) event.preventDefault(); });
      window.on('close', event => { if (!quitting) {event.preventDefault(); window.hide(); send({type:'closed'});} });
      for (const event of ['show','hide','focus','blur','resize','always-on-top-changed']) window.on(event, reportWindow);
      await window.loadURL(origin + '/harmony/?surface=mirror');
      setPinned(state.alwaysOnTop); window.show(); window.moveTop(); window.focus(); reportWindow(); send({type:'ready'});
    } else if (message.type === 'state') {
      const scaleChanged = state.scale !== message.state.scale;
      const pinChanged = state.alwaysOnTop !== message.state.alwaysOnTop;
      const themeChanged = state.theme.mode !== message.state.theme.mode;
      state = message.state;
      if (themeChanged) nativeTheme.themeSource = state.theme.mode;
      // Calling setAlwaysOnTop(false) repeatedly lowers a Windows window behind its host.
      if (pinChanged) setPinned(state.alwaysOnTop);
      if (scaleChanged) resize();
    } else if (message.type === 'geometry') {
      if (!geometry || geometry.width !== message.width || geometry.height !== message.height || geometry.chromeHeight !== message.chromeHeight) {geometry = message; resize();}
    } else if (message.type === 'hide') window?.hide();
    else if (message.type === 'focus') {window?.show(); window?.moveTop(); window?.focus();}
    else if (message.type === 'menu') Menu.buildFromTemplate([
      {label:'窗口置顶', type:'checkbox', checked:!!state.alwaysOnTop, click:item => {state.alwaysOnTop = item.checked; setPinned(item.checked); send({type:'pin',value:item.checked});}},
      {type:'separator'},
      ...[['screenshot','截图'],['record','录屏 / 停止'],['reconnect','重新连接'],['details','连接详情']].map(([command,label])=>({label,click:()=>send({type:'command',command})})),
      {type:'separator'}, {label:'关闭投屏',click:()=>window.close()},
    ]).popup({window});
    else if (message.type === 'quit') {quitting = true; app.quit();}
    // Window events can fire before the native property has settled on Windows.
    setImmediate(reportWindow);
  } catch (error) {send({type:'error',message:error.message}); quitting = true; app.quit();}
});
process.on('disconnect', () => {quitting = true; app.quit();});
app.on('window-all-closed', () => {if (quitting) app.quit();});
