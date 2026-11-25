// Always-hidden native integration probe. It cannot show or focus a game window.
const electron=require('electron');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const archive=path.resolve(process.argv.find(v=>v.startsWith('--archive='))?.slice(10)||'release/win-unpacked/resources/app.asar');
const output=path.resolve(process.argv.find(v=>v.startsWith('--output='))?.slice(9)||'artifacts/native-packaged-before.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
electron.app.setPath('userData',path.join(path.dirname(output),'native-probe-profile'));
const report={archive,hidden:true,events:[],errors:[]};
let nativeWindow,finished=false;
function save(){fs.writeFileSync(output,JSON.stringify(report,null,2));}
const timeout=setTimeout(()=>finish(Error('Hidden native probe timed out')),25000);
async function finish(error){if(finished)return;finished=true;clearTimeout(timeout);if(error){report.error=error.stack||String(error);report.passed=false;}save();if(nativeWindow&&!nativeWindow.isDestroyed())nativeWindow.destroy();electron.app.exit(report.passed?0:1);}
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
class HiddenWindow extends electron.BrowserWindow{
  constructor(options){super({...options,show:false,alwaysOnTop:false,skipTaskbar:true});nativeWindow=this;
    this.webContents.on('console-message',(_event,...args)=>report.events.push({kind:'console',args}));
    this.webContents.on('did-fail-load',(_event,code,message,url)=>report.errors.push({kind:'load',code,message,url}));
    this.webContents.on('render-process-gone',(_event,details)=>report.errors.push({kind:'renderer',...details}));
    this.webContents.on('did-finish-load',async()=>{
      report.url=this.webContents.getURL();
      for(let attempt=0;attempt<100;attempt++){
        try{report.renderer=await this.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,canvas:!!document.querySelector('#arena canvas'),bridge:!!window.desktop,practice:!!document.getElementById('practice'),connection:document.getElementById('connection')?.textContent})`);if(report.renderer.canvas)break;}catch(error){report.errors.push({kind:'evaluate',message:error.message});}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      report.passed=!!report.renderer?.canvas&&!!report.renderer?.bridge&&!!report.renderer?.practice&&this.isVisible()===false;
      report.visible=this.isVisible();
      const capture=await this.webContents.capturePage();fs.writeFileSync(output.replace(/\.json$/,'.png'),capture.toPNG());
      await finish();
    });
  }
  show(){report.events.push({kind:'show-suppressed'});}
  showInactive(){report.events.push({kind:'show-suppressed'});}
  focus(){report.events.push({kind:'focus-suppressed'});}
  setAlwaysOnTop(){}
}
const fakeTray=class{setToolTip(){}setContextMenu(){}on(){}};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){if(request==='electron')return{...electron,BrowserWindow:HiddenWindow,Tray:fakeTray,globalShortcut:{register:()=>true,unregisterAll:()=>{}}};return originalLoad.call(this,request,parent,isMain);};
require(path.join(archive,'desktop/main.cjs'));
