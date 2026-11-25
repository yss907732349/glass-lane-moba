const {app,BrowserWindow,ipcMain,globalShortcut,Menu,Tray,nativeImage,screen}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {createGameServer}=require('../build/server.cjs');
const diagnosticMode=process.argv.includes('--hidden-smoke-test');
const diagnosticOnline=diagnosticMode&&process.env.GLASS_LANE_DIAGNOSTIC_ONLINE==='1';
const diagnosticOutput=path.resolve(process.argv.find(value=>value.startsWith('--diagnostics-output='))?.slice(21)||path.join(process.cwd(),'artifacts','native-hidden-report.json'));
if(diagnosticMode){fs.mkdirSync(path.dirname(diagnosticOutput),{recursive:true});app.setPath('userData',path.join(path.dirname(diagnosticOutput),'native-hidden-profile'));}
let win,service,tray,resizeGesture,origin,quitting=false;
let uiScale=.8,uiOpacity=1;
const BASE={width:1220,height:780};
const diagnostics={startedAt:new Date().toISOString(),diagnosticMode,events:[],errors:[]};
function record(kind,detail={}){diagnostics.events.push({at:Date.now(),kind,...detail});if(diagnostics.events.length>80)diagnostics.events.shift();try{fs.writeFileSync(path.join(app.getPath('userData'),'startup-diagnostics.json'),JSON.stringify(diagnostics,null,2));}catch{}}
function layout(){return{scale:uiScale,opacity:uiOpacity};}
function saveLayout(){if(diagnosticMode)return;try{fs.writeFileSync(path.join(app.getPath('userData'),'lane-layout.json'),JSON.stringify(layout()));}catch{}}
function emitLayout(){win?.webContents.send('lane-layout',layout());}
function clientServer(){
  const configured=process.env.GLASS_LANE_SERVER_URL;
  try{const saved=JSON.parse(fs.readFileSync(path.join(__dirname,'client-config.json'),'utf8'));return configured||saved.serverUrl||'';}catch{return configured||'';}
}
function setScale(value,anchor){
  if(!win||!Number.isFinite(value))return;
  const current=win.getBounds(),area=screen.getDisplayMatching(current).workArea;
  uiScale=Math.max(.5,Math.min(1.2,value,area.width/BASE.width,area.height/BASE.height));
  const width=Math.round(BASE.width*uiScale),height=Math.round(BASE.height*uiScale);
  const x=Math.max(area.x,Math.min(area.x+area.width-width,anchor?anchor.right-width:current.x));
  const y=Math.max(area.y,Math.min(area.y+area.height-height,anchor?anchor.bottom-height:current.y));
  win.setBounds({x:Math.round(x),y:Math.round(y),width,height});
  win.webContents.setZoomFactor(uiScale);emitLayout();saveLayout();
}
function show(){if(win&&!diagnosticMode){win.show();win.focus();}}
function toggle(){if(diagnosticMode)return;if(win?.isVisible())win.hide();else show();}
function restore(){if(!win)return;setScale(1);win.center();uiOpacity=1;win.setOpacity(1);emitLayout();saveLayout();show();}
function errorMarkup(){return`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>html{background:#171c22;color:#e0e5ea;font:14px 'Microsoft YaHei',sans-serif}body{margin:35px;line-height:1.8}h1{font-size:19px}button{background:#354352;color:#eef2f5;border:1px solid #718395;border-radius:5px;padding:9px 15px;margin-right:10px;cursor:pointer}p{color:#aebbc8}</style><h1>游戏暂时未能启动</h1><p>请重试打开。若仍不能进入，请关闭客户端后重新运行。</p><button onclick="window.desktop.retry()">重新打开</button><button onclick="window.desktop.close()">关闭客户端</button></html>`;}
async function startupFailure(error){
  const message=error?.stack||String(error);diagnostics.errors.push(message);record('startup-failure',{message});
  if(diagnosticMode)return finishDiagnostics(error);
  if(!win||win.isDestroyed?.()){app.quit();return;}
  try{await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(errorMarkup()));win.setOpacity(1);show();}catch{app.quit();}
}
async function waitForRenderer(expression,timeout=12000){
  const until=Date.now()+timeout;
  while(Date.now()<until){try{const value=await win.webContents.executeJavaScript(expression);if(value)return value;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  throw Error('游戏画面未能完成加载。');
}
async function finishDiagnostics(error){
  if(quitting)return;quitting=true;
  if(error){diagnostics.passed=false;diagnostics.error=error.stack||String(error);}
  diagnostics.visible=!!win?.isVisible();diagnostics.finishedAt=new Date().toISOString();
  try{fs.writeFileSync(diagnosticOutput,JSON.stringify(diagnostics,null,2));}catch{}
  await service?.close().catch(()=>{});app.exit(diagnostics.passed?0:1);
}
async function verifyHiddenClient(){
  diagnostics.renderer=await waitForRenderer(`document.querySelector('#arena canvas')&&window.desktop&&document.getElementById('practice')?({canvas:true,bridge:true,practice:true,title:document.title,connection:document.getElementById('connection')?.textContent}):null`);
  await waitForRenderer(`document.getElementById('connection')?.textContent==='房间服务已连接'`,diagnosticOnline?65000:12000);
  diagnostics.serviceInfo=await win.webContents.executeJavaScript(`window.desktop.info()`);
  diagnostics.connection=await win.webContents.executeJavaScript(`document.getElementById('connection')?.textContent`);
  fs.writeFileSync(diagnosticOutput.replace(/\.json$/,'.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.getElementById('practice').click()`);
  diagnostics.practice=await waitForRenderer(`!document.getElementById('hud').hidden&&document.getElementById('clock')?.textContent!=='00:00'?({hud:!document.getElementById('hud').hidden,clock:document.getElementById('clock').textContent,skills:document.querySelectorAll('#hud .ability').length}):null`,diagnosticOnline?55000:12000);
  fs.writeFileSync(diagnosticOutput.replace(/\.json$/,'-practice.png'),(await win.webContents.capturePage()).toPNG());
  diagnostics.passed=diagnostics.practice.skills===4&&win.isVisible()===false&&diagnostics.errors.length===0;
  await finishDiagnostics();
}
async function loadGame(){
  await win.loadURL(origin);setScale(uiScale);win.setOpacity(uiOpacity);emitLayout();
  await waitForRenderer(`!!document.querySelector('#arena canvas')&&!!window.desktop`);
  record('renderer-ready',{url:origin});
  if(diagnosticMode)await verifyHiddenClient();else show();
}
app.setAppUserModelId('friends.glass.lane');
const hasInstanceLock=app.requestSingleInstanceLock();
if(!hasInstanceLock)app.quit();
else{
  app.on('second-instance',show);
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(null);
    if(!diagnosticMode)try{const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'lane-layout.json'),'utf8'));if(Number.isFinite(saved.scale))uiScale=Math.max(.5,Math.min(1.2,saved.scale));if(Number.isFinite(saved.opacity))uiOpacity=Math.max(.15,Math.min(1,saved.opacity));}catch{}
    const opts={port:diagnosticMode?0:4327,host:diagnosticMode?'127.0.0.1':'0.0.0.0',staticDir:path.join(__dirname,'../dist')};
    try{service=await createGameServer(opts);}catch(error){if(error.code!=='EADDRINUSE')throw error;service=await createGameServer({...opts,port:0});}
    origin=`http://127.0.0.1:${service.port}`;
    const area=screen.getPrimaryDisplay().workArea;
    win=new BrowserWindow({width:Math.min(area.width,Math.round(BASE.width*uiScale)),height:Math.min(area.height,Math.round(BASE.height*uiScale)),minWidth:400,minHeight:260,frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,alwaysOnTop:!diagnosticMode,resizable:false,show:false,skipTaskbar:diagnosticMode,title:'透明单线 · 桌面竞技场',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:!diagnosticMode}});
    record('window-created',{hidden:diagnosticMode});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{try{if(new URL(url).origin!==origin)event.preventDefault();}catch{event.preventDefault();}});
    win.webContents.on('before-input-event',(event,input)=>{if(input.control&&['+','-','=','0'].includes(input.key))event.preventDefault();});
    win.webContents.on('did-fail-load',(_event,code,message,url)=>record('load-failed',{code,message,url}));
    win.webContents.on('render-process-gone',(_event,details)=>{if(!quitting)void startupFailure(Error('游戏画面进程退出：'+details.reason));});
    win.webContents.on('console-message',(_event,...args)=>{const details=typeof args[0]==='object'?args[0]:{level:args[0],message:args[1]};if(details.level==='error'||details.level===3){diagnostics.errors.push(details.message);record('renderer-error',{message:details.message});}});
    ipcMain.handle('lane-info',event=>{if(event?.sender&&event.sender!==win.webContents)return{addresses:[]};return{addresses:Object.values(require('node:os').networkInterfaces()).flat().filter(value=>value&&value.family==='IPv4'&&!value.internal).map(value=>`http://${value.address}:${service.port}`),localUrl:origin,defaultServerUrl:diagnosticMode&&!diagnosticOnline?origin:clientServer(),diagnosticMode,...layout()};});
    ipcMain.on('lane-control',(event,action,value)=>{if(event.sender!==win?.webContents)return;
      if(action==='hide')win.hide();if(action==='close')app.quit();if(action==='pin')win.setAlwaysOnTop(!!value);
      if(action==='retry')void loadGame().catch(startupFailure);
      if(action==='opacity'&&Number.isFinite(value)){uiOpacity=Math.max(.15,Math.min(1,value));win.setOpacity(uiOpacity);emitLayout();saveLayout();}
      if(action==='scale')setScale(value);
      if(action==='resize-start'&&Number.isFinite(value?.x)&&Number.isFinite(value?.y)){resizeGesture={x:value.x,y:value.y,scale:uiScale,bounds:win.getBounds()};}
      if(action==='resize'&&resizeGesture&&Number.isFinite(value?.x)&&Number.isFinite(value?.y)){const start=resizeGesture,delta=-((value.x-start.x)*BASE.width+(value.y-start.y)*BASE.height)/(BASE.width**2+BASE.height**2);setScale(start.scale+delta,{right:start.bounds.x+start.bounds.width,bottom:start.bounds.y+start.bounds.height});}
      if(action==='resize-end')resizeGesture=undefined;
      if(action==='passthrough')win.setIgnoreMouseEvents(!!value,{forward:true});
    });
    if(!diagnosticMode){
      globalShortcut.register('Control+Shift+J',toggle);globalShortcut.register('Control+Shift+0',restore);
      const icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAK0lEQVQ4T2NkoBAwUqifgWQA8B8DAwPj////GRgYGIg1gGE0DBgNg4YBAOTXGhHBY7bDAAAAAElFTkSuQmCC');
      tray=new Tray(icon);tray.setToolTip('透明单线 · Ctrl+Shift+J 显示或隐藏');tray.setContextMenu(Menu.buildFromTemplate([{label:'显示游戏',click:show},{label:'恢复窗口与透明度',click:restore},{type:'separator'},{label:'退出',click:()=>app.quit()}]));tray.on('double-click',show);
    }
    await loadGame();
  }).catch(startupFailure);
}
app.on('window-all-closed',()=>{if(!quitting)app.quit();});
app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();service?.close();});
