import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {chromium} from '@playwright/test';
export const root=path.resolve(import.meta.dirname,'..'),artifact=path.join(root,'artifacts');
await mkdir(artifact,{recursive:true});
const original=await readFile(path.join(root,'server/index.ts'),'utf8');
const marker="room.match=createMatch(choices,room.players.filter(p=>p.bot).map(p=>p.team));";
if(original.split(marker).length!==2)throw Error('Test fixture initialization hook no longer matches the server start path');
const entry=original.replace(marker,marker+'options.onTestMatch?.(room.match,room.code);')+"\nexport { HEROES,HERO_IDS,WORLD,TERRAIN,SOURCE_UNIT,SOURCE_HEROES } from '../src/shared/data.ts';\nexport { recalcSourceHero } from '../src/shared/simulation.ts';";
const output=await build({stdin:{contents:entry,resolveDir:path.join(root,'server'),sourcefile:'playtest-service.ts',loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false,external:['ws'],logLevel:'silent'});
const fixtureModule=path.join(artifact,'playtest-service.cjs');await writeFile(fixtureModule,output.outputFiles[0].contents);
const api=createRequire(import.meta.url)(fixtureModule);
export const {HERO_IDS,HEROES,WORLD,TERRAIN,SOURCE_UNIT,SOURCE_HEROES,recalcSourceHero}=api;
// The generated service changes only match initialization. All commands, simulation and team snapshots remain production code.
export async function testService(onTestMatch){return api.createGameServer({port:0,host:'127.0.0.1',staticDir:path.join(root,'dist'),onTestMatch});}
export async function launch(){return chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});}
export async function client(browser,url,errors=[]){const context=await browser.newContext({viewport:{width:1280,height:800}});await context.addInitScript(()=>{window.__frames=[];window.__sent=[];const Native=window.WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);window.__socket=this;this.addEventListener('message',event=>{const m=JSON.parse(event.data);window.__frames.push(m);if(window.__frames.length>1800)window.__frames.shift();if(m.type==='state')window.__state=m.state;if(m.type==='welcome'||m.type==='room')window.__room=m.room;});}send(data){window.__sent.push(JSON.parse(data));return super.send(data);}};});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});await page.goto(url);await page.waitForFunction(()=>document.getElementById('connection').textContent==='房间服务已连接');await page.locator('#arena canvas').waitFor();return page;}
export async function room(a,b,heroA,heroB){await a.locator(`[data-hero="${heroA}"]`).click();await b.locator(`[data-hero="${heroB}"]`).click();for(const [p,name]of [[a,'测试甲'],[b,'测试乙']]){await p.locator('#name').fill(name);await p.locator('#password').fill('four-hero-test');}await a.locator('#create').click();await a.locator('#room-detail').waitFor({state:'visible'});const code=await a.evaluate(()=>window.__room.code);await b.locator('#room-code').fill(code);await b.locator('#join').click();await b.locator('#ready').waitFor();await b.locator('#ready').click();await a.locator('#ready').click();await a.waitForFunction(()=>window.__room.players.every(p=>p.ready));await a.locator('#start').click();await Promise.all([a.locator('#hud').waitFor({state:'visible'}),b.locator('#hud').waitFor({state:'visible'})]);await a.waitForFunction(()=>window.__state?.time>0);return code;}
export async function screenshot(page,name){await page.screenshot({path:path.join(artifact,name+'.png'),omitBackground:true});}
export async function send(page,command){await page.evaluate(command=>window.__socket.send(JSON.stringify({type:'command',command})),command);}
export async function state(page){return page.evaluate(()=>window.__state);}
export async function point(page,target){await page.keyboard.press('Space');await page.waitForTimeout(120);const own=await page.evaluate(()=>window.__state.units.find(u=>u.id==='hero-0')),bounds=await page.locator('#arena canvas').boundingBox();const dx=(target.x-own.x)*.72+(target.y-own.y)*.42,dy=(target.y-own.y)*.52-(target.x-own.x)*.14;const p={x:bounds.x+bounds.width/2+dx*1.25*bounds.width/1600,y:bounds.y+bounds.height/2+dy*1.25*bounds.height/750};await page.mouse.move(p.x,p.y);return p;}
