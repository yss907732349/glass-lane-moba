import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const require=createRequire(import.meta.url);
const {createGameServer}=require('../build/server.cjs');
const root=path.resolve(import.meta.dirname,'..');
const passed=[],errors=[],clients=[];
let local,remote,browser;
const out=path.join(root,'artifacts','room-connection-playtest.json');
await mkdir(path.dirname(out),{recursive:true});
async function snapshot(page,label){await page.screenshot({path:path.join(root,'artifacts',`room-connection-${label}.png`),omitBackground:true});}
async function frames(page){return page.evaluate(()=>window.__connectionFrames);}
function serviceOrigin(endpoint){const url=new URL(endpoint);url.protocol=url.protocol==='wss:'?'https:':url.protocol==='ws:'?'http:':url.protocol;return url.origin;}
async function waitMessage(page,type,predicate='true'){
  await page.waitForFunction(({type,predicate})=>window.__connectionFrames.some(frame=>frame.direction==='received'&&frame.message.type===type&&Function('m',`return ${predicate}`)(frame.message)),{type,predicate},{timeout:15000});
  return page.evaluate(({type,predicate})=>window.__connectionFrames.filter(frame=>frame.direction==='received'&&frame.message.type===type&&Function('m',`return ${predicate}`)(frame.message)).at(-1).message,{type,predicate});
}
try{
  local=await createGameServer({port:0,host:'127.0.0.1',staticDir:path.join(root,'dist')});
  remote=await createGameServer({port:0,host:'127.0.0.1',staticDir:path.join(root,'dist')});
  const remotePort=remote.port,localUrl=`http://127.0.0.1:${local.port}`,remoteUrl=`http://127.0.0.1:${remotePort}`;
  await remote.close();remote=null;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  async function client(){
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    await context.addInitScript(({localUrl,remoteUrl})=>{
      window.desktop={info:async()=>({addresses:[],localUrl,defaultServerUrl:remoteUrl,scale:1,opacity:1}),pin(){},opacity(){},scale(){},startResize(){},resize(){},endResize(){},onLayout(){return()=>{};},hide(){},close(){},passthrough(){}};
      window.__connectionFrames=[];const Native=window.WebSocket;
      window.WebSocket=class extends Native{
        constructor(...args){super(...args);const endpoint=String(args[0]);window.__connectionFrames.push({direction:'connecting',endpoint});this.addEventListener('message',event=>{const message=JSON.parse(event.data);window.__connectionFrames.push({direction:'received',endpoint,message});});}
        send(data){window.__connectionFrames.push({direction:'sent',endpoint:this.url,message:JSON.parse(data)});return super.send(data);}
      };
    },{localUrl,remoteUrl});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));clients.push(page);await page.goto(localUrl);await page.locator('#arena canvas').waitFor();return page;
  }
  const a=await client();
  await a.waitForFunction(()=>document.getElementById('connection').textContent.includes('重连')||document.getElementById('connection').textContent.includes('不可用'));
  await a.locator('[data-hero="dain"]').click();
  await a.locator('#practice').click();await a.locator('#hud').waitFor({state:'visible'});
  await a.waitForFunction(()=>document.getElementById('clock')?.textContent!=='00:00');
  assert.equal(await a.locator('#server-url').inputValue(),localUrl);
  const localCreate=(await frames(a)).find(frame=>frame.direction==='sent'&&frame.message.type==='create');
  assert.equal(serviceOrigin(localCreate.endpoint),localUrl);assert.equal(localCreate.message.protocol,'glass-lane-v2');assert.equal(localCreate.message.hero,'dain');
  passed.push('默认联机服务实际不可用时，练习通过独立本机服务开局');
  await snapshot(a,'local-practice');

  remote=await createGameServer({port:remotePort,host:'127.0.0.1',staticDir:path.join(root,'dist')});
  const upgrades=remote.server.listeners('upgrade');remote.server.removeAllListeners('upgrade');
  remote.server.on('upgrade',(...args)=>setTimeout(()=>{for(const listener of upgrades)listener.apply(remote.server,args);},2000));
  await a.locator('#menu-button').click();await a.locator('#leave-match').click();await a.locator('#entry').waitFor({state:'visible'});
  await a.locator('[data-hero="fenn"]').click();
  await a.locator('#name').fill('切换验证甲');await a.locator('#password').fill('room-test');
  assert.notEqual(await a.locator('#connection').textContent(),'房间服务已连接','create is requested before remote handshake completes');await a.locator('#create').click();
  await a.locator('#room-detail').waitFor({state:'visible'});
  const created=await waitMessage(a,'welcome','m.room.players[0].name==="切换验证甲"');
  const aFrames=await frames(a),multiplayerCreates=aFrames.filter(frame=>frame.direction==='sent'&&frame.message.type==='create'&&frame.message.name==='切换验证甲');
  assert.equal(multiplayerCreates.length,1);assert.equal(serviceOrigin(multiplayerCreates[0].endpoint),remoteUrl);
  assert.equal(multiplayerCreates[0].message.protocol,'glass-lane-v2');assert.equal(multiplayerCreates[0].message.hero,'fenn');assert.equal(created.room.players[0].hero,'fenn');
  assert.equal(await a.locator('#server-url').inputValue(),remoteUrl);
  assert((await a.locator('#room-service-label').getAttribute('title')).includes(remoteUrl));
  passed.push('离开本机练习后立即创建联机房间，请求切回默认服务且只发送一次');
  await snapshot(a,'restored-online-room');

  const b=await client();
  await b.locator('[data-hero="sylra"]').click();
  const formatted=`　${created.room.code.replace(/[0-9]/g,d=>String.fromCharCode(d.charCodeAt(0)+0xfee0))} `;
  await b.locator('#name').fill('切换验证乙');await b.locator('#password').fill('wrong-password');
  await b.locator('#room-code').evaluate((node,value)=>{const clipboardData=new DataTransfer();clipboardData.setData('text/plain',value);const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData});const prevented=!node.dispatchEvent(event);if(!prevented){node.value=value.slice(0,node.maxLength<0?undefined:node.maxLength);node.dispatchEvent(new Event('input',{bubbles:true}));}},formatted);
  assert.notEqual(await b.locator('#connection').textContent(),'房间服务已连接','join is requested before remote handshake completes');await b.locator('#join').click();
  await waitMessage(b,'error','/房间不存在或密码错误/.test(m.message)');
  const firstJoin=(await frames(b)).find(frame=>frame.direction==='sent'&&frame.message.type==='join');
  assert.equal(firstJoin.message.code,created.room.code,'fullwidth and surrounding whitespace normalize to six ASCII digits');
  assert.equal(firstJoin.message.protocol,'glass-lane-v2');assert.equal(firstJoin.message.hero,'sylra');
  assert.equal(serviceOrigin(firstJoin.endpoint),remoteUrl);
  assert.equal(await b.locator('#entry').isVisible(),true);
  passed.push('粘贴带空白的全角房间号归一化；错误密码可在原界面改正');
  await snapshot(b,'wrong-password');

  await b.locator('#password').fill('room-test');await b.locator('#join').click();await b.locator('#ready').waitFor();
  await b.locator('#ready').click();await a.locator('#ready').click();await a.locator('#start').click();
  await Promise.all([a.locator('#hud').waitFor({state:'visible'}),b.locator('#hud').waitFor({state:'visible'})]);
  await Promise.all([waitMessage(a,'state','m.state.time>0'),waitMessage(b,'state','m.state.time>0')]);
  for(const page of [a,b]){
    assert.equal(await page.locator('#server-url').inputValue(),remoteUrl);
    const final=(await frames(page)).filter(frame=>frame.direction==='sent'&&['create','join'].includes(frame.message.type)&&!frame.message.password?.match(/^[a-f0-9]{32}$/));
    assert(final.length>0);for(const frame of final)assert.equal(serviceOrigin(frame.endpoint),remoteUrl);
  }
  passed.push('修正密码后两位玩家在同一默认服务完成加入、准备与真实同步开局');
  const aState=await waitMessage(a,'state','m.state.time>0'),bState=await waitMessage(b,'state','m.state.time>0');assert.equal(aState.state.units.find(u=>u.id==='hero-0').heroKind,'fenn');assert.equal(bState.state.units.find(u=>u.id==='hero-1').heroKind,'sylra');
  passed.push('新版协议握手携带四英雄名单中的有效ID，真实房间使用Fenn与Sylra');
  await snapshot(a,'multiplayer');
  assert.deepEqual(errors,[]);
  const report={passed,errors,localUrl,remoteUrl,visibleWindows:false,verifiedAt:new Date().toISOString()};
  await writeFile(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(out,JSON.stringify({passed,errors,failure:String(error)},null,2));throw error;}
finally{
  for(const page of clients){try{await page.evaluate(()=>{const leave=document.getElementById('leave-match');if(leave&&!leave.hidden)leave.click();});}catch{}}
  await browser?.close();await remote?.close();await local?.close();
}
