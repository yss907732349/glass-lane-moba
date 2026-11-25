import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';

test('desktop controls scale the whole transparent window, anchor resize, clamp opacity and recover without GUI', async()=>{
  const events=new Map<string,Function>(),handlers=new Map<string,Function>(),shortcuts=new Map<string,Function>(),writes:string[]=[];
  const area={x:0,y:0,width:1920,height:1080};let window:FakeWindow|undefined;
  class FakeWindow {
    bounds:{x:number;y:number;width:number;height:number}; options:any;opacity=1;visible=false;zoom=1;
    webContents=Object.assign(new EventEmitter(),{setWindowOpenHandler:()=>{},setZoomFactor:(value:number)=>this.zoom=value,send:(name:string,value:unknown)=>events.set(`emitted:${name}`,()=>value),executeJavaScript:async()=>true});
    constructor(options:any){this.options=options;this.bounds={x:100,y:100,width:options.width,height:options.height};window=this;}
    getBounds(){return{...this.bounds};}setBounds(next:any){this.bounds={...next};}setOpacity(v:number){this.opacity=v;}
    center(){this.bounds.x=(area.width-this.bounds.width)/2;this.bounds.y=(area.height-this.bounds.height)/2;}
    setAlwaysOnTop(){}setIgnoreMouseEvents(){}show(){this.visible=true;}hide(){this.visible=false;}focus(){}isVisible(){return this.visible;}
    async loadURL(){}
  }
  const app={setAppUserModelId:()=>{},requestSingleInstanceLock:()=>true,on:()=>{},quit:()=>{},whenReady:()=>Promise.resolve(),getPath:()=>'/test-profile'};
  const electron={app,BrowserWindow:FakeWindow,ipcMain:{handle:(k:string,f:Function)=>handlers.set(k,f),on:(k:string,f:Function)=>events.set(k,f)},globalShortcut:{register:(k:string,f:Function)=>shortcuts.set(k,f),unregisterAll:()=>{}},Menu:{setApplicationMenu:()=>{},buildFromTemplate:()=>[]},Tray:class{setToolTip(){}setContextMenu(){}on(){}},nativeImage:{createFromDataURL:()=>({})},screen:{getPrimaryDisplay:()=>({workArea:area}),getDisplayMatching:()=>({workArea:area})}};
  const source=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  const fakeRequire=(name:string)=>{
    if(name==='electron')return electron;if(name==='node:path')return path;
    if(name==='node:fs')return{readFileSync:()=>{throw Error('no saved settings');},writeFileSync:(_name:string,text:string)=>writes.push(text)};
    if(name==='node:os')return{networkInterfaces:()=>({wifi:[{address:'192.168.1.6',family:'IPv4',internal:false}]})};
    if(name==='../build/server.cjs')return{createGameServer:async()=>({port:4327,close:()=>{}})};
    throw Error(`Unexpected require ${name}`);
  };
  vm.runInNewContext(source,{require:fakeRequire,__dirname:'/app/desktop',console,process:{argv:[],env:{},cwd:()=>'/app'},setTimeout});
  await new Promise<void>(resolve=>setImmediate(resolve));assert.ok(window);const w=window!;
  assert.equal(w.options.transparent,true);assert.equal(w.options.show,false);assert.equal(w.options.backgroundColor,'#00000000');
  assert.equal(w.zoom,.8);assert.equal(w.bounds.width,976);assert.equal(w.bounds.height,624);
  const control=events.get('lane-control')!,sender={sender:w.webContents};
  control(sender,'scale',.5);assert.equal(w.zoom,.5);assert.equal(w.bounds.width,610);assert.equal(w.bounds.height,390);
  control(sender,'scale',100);assert.equal(w.zoom,1.2);assert.ok(w.bounds.x+w.bounds.width<=area.width);
  control(sender,'scale',NaN);assert.equal(w.zoom,1.2);
  control({sender:{}},'opacity',.15);assert.equal(w.opacity,1);
  control(sender,'opacity',.01);assert.equal(w.opacity,.15);
  control(sender,'scale',.8);w.setBounds({...w.getBounds(),x:300,y:300});const before=w.getBounds();control(sender,'resize-start',{x:100,y:100});control(sender,'resize',{x:0,y:0});control(sender,'resize-end');assert.ok(w.zoom>.8);assert.ok(Math.abs(w.bounds.x+w.bounds.width-before.x-before.width)<=1);assert.ok(Math.abs(w.bounds.y+w.bounds.height-before.y-before.height)<=1);
  const size=w.bounds.width;control(sender,'resize',{x:-100,y:-100});assert.equal(w.bounds.width,size);
  shortcuts.get('Control+Shift+J')!();assert.equal(w.visible,false);shortcuts.get('Control+Shift+J')!();assert.equal(w.visible,true);
  shortcuts.get('Control+Shift+0')!();assert.equal(w.zoom,1);assert.equal(w.opacity,1);assert.equal(w.visible,true);
  const info=handlers.get('lane-info')!();assert.equal(info.scale,1);assert.equal(info.opacity,1);assert.deepEqual([...info.addresses],['http://192.168.1.6:4327']);assert.ok(writes.length>0);
});

test('a second client instance exits before starting another room service or window',async()=>{
  const source=await readFile(new URL('../desktop/main.cjs',import.meta.url),'utf8');
  let quit=0,ready=0,servers=0;
  const app={setAppUserModelId:()=>{},requestSingleInstanceLock:()=>false,quit:()=>quit++,on:()=>{},whenReady:()=>{ready++;return Promise.resolve();}};
  vm.runInNewContext(source,{__dirname:'/app/desktop',console,process:{argv:[],env:{},cwd:()=>'/app'},setTimeout,require:(name:string)=>{
    if(name==='electron')return{app};if(name==='node:path')return path;if(name==='node:fs')return{};
    if(name==='../build/server.cjs')return{createGameServer:async()=>{servers++;}};
    throw Error(name);
  }});
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(quit,1);assert.equal(ready,0);assert.equal(servers,0);
});
