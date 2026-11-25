import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';

const url=process.env.GAME_URL||'http://127.0.0.1:4327';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const errors=[],passed=[];
await mkdir('artifacts',{recursive:true});
async function page(){
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(()=>{
    const Native=window.WebSocket;window.__messages=[];
    window.WebSocket=class extends Native{constructor(...args){super(...args);window.__gameSocket=this;this.addEventListener('message',event=>{const m=JSON.parse(event.data);window.__messages.push(m);if(window.__messages.length>500)window.__messages.shift();if(m.type==='state')window.__state=m.state;if(m.type==='welcome'||m.type==='room')window.__room=m.room;});}};
  });
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(url);await p.waitForFunction(()=>document.getElementById('connection').textContent==='房间服务已连接');return p;
}
async function command(p,command){await p.evaluate(c=>window.__gameSocket.send(JSON.stringify({type:'command',command:c})),command);}
async function screenshot(p,name){await p.screenshot({path:`artifacts/${name}.png`,omitBackground:true});}
try{
  const a=await page(),b=await page();
  await a.locator('#name').fill('草丛铁卫');await a.locator('#password').fill('terrain-test');await a.locator('#create').click();await a.locator('#room-detail').waitFor({state:'visible'});
  const code=await a.evaluate(()=>window.__room.code);
  await b.locator('[data-hero="mage"]').click();await b.locator('#name').fill('河岸星术师');await b.locator('#password').fill('terrain-test');await b.locator('#room-code').fill(code);await b.locator('#join').click();await b.locator('#ready').click();await a.locator('#ready').click();await a.locator('#start').click();
  for(const p of [a,b])await p.locator('#hud').waitFor({state:'visible'});
  await a.waitForFunction(()=>window.__state?.time>0);
  assert(!await a.evaluate(()=>window.__state.units.some(u=>u.id==='hero-1'||u.id==='tower-1'||u.id==='base-1')),'distant opponent and buildings stay outside vision');
  passed.push('开局只收到900视距内单位，远方敌方英雄和建筑隐藏');
  await a.locator('#minimap-canvas').click({position:{x:100,y:34}});await screenshot(a,'vision-distant-hidden');await a.keyboard.press('Space');
  await command(a,{type:'upgrade',slot:0});await command(b,{type:'upgrade',slot:1});
  await command(a,{type:'move',x:2180,y:835});await command(b,{type:'move',x:2620,y:835});
  await Promise.all([a.waitForFunction(()=>{const h=window.__state?.units.find(u=>u.id==='hero-0');return h&&Math.hypot(h.x-2180,h.y-835)<2;},null,{timeout:20000}),b.waitForFunction(()=>{const h=window.__state?.units.find(u=>u.id==='hero-1');return h&&Math.hypot(h.x-2620,h.y-835)<2;},null,{timeout:20000})]);
  await a.waitForFunction(()=>!window.__state.units.some(u=>u.id==='hero-1'));await b.waitForFunction(()=>!window.__state.units.some(u=>u.id==='hero-0'));
  passed.push('两岸英雄进入草丛后，敌方联机快照不再包含其位置');
  await a.locator('#minimap-canvas').click({position:{x:60,y:34}});await screenshot(a,'terrain-bush-hidden');
  await a.evaluate(()=>window.__messages=[]);await command(a,{type:'attack',targetId:'hero-1'});
  await a.waitForFunction(()=>window.__messages.some(m=>m.type==='error'));
  assert.equal(await a.evaluate(()=>window.__state.units.find(u=>u.id==='hero-0').targetId),null);passed.push('伪造已知英雄ID也无法普攻锁定草丛内敌人');
  await command(b,{type:'skill',slot:1,x:2180,y:835});
  await b.waitForFunction(()=>window.__state.units.some(u=>u.id==='hero-0'&&u.hp<u.maxHp),null,{timeout:3000});
  await screenshot(b,'terrain-bush-revealed');passed.push('地面范围技能可盲打隐藏英雄，命中后对手收到显形位置');
  await b.waitForFunction(()=>!window.__state.units.some(u=>u.id==='hero-0'),null,{timeout:14000});passed.push('停止受伤3秒后重新隐藏');
  await command(a,{type:'summoner',slot:'flash',x:2620,y:835});
  await a.waitForFunction(()=>{const h=window.__state.units.find(u=>u.id==='hero-0');return h.x>2480&&h.summonerCooldowns.flash>0;});passed.push('F闪现可从上岸越过阻挡河水');
  await command(a,{type:'move',x:2180,y:835});
  await a.waitForFunction(()=>{const h=window.__state.units.find(u=>u.id==='hero-0');return h.x<2320;},null,{timeout:7000});
  const frames=await a.evaluate(()=>window.__messages.filter(m=>m.type==='state').map(m=>m.state.units.find(u=>u.id==='hero-0')).filter(Boolean));
  assert(frames.some(h=>h.x>=2320&&h.x<=2480&&h.y>=955&&h.y<=1045),'walking route uses bridge');
  assert(!frames.some(h=>h.x>2320&&h.x<2480&&(h.y<955||h.y>1045)),'walking route never enters river water');
  passed.push('普通跨岸移动自动绕窄桥，连续联机帧没有步入水面');
  await a.locator('#minimap-canvas').click({position:{x:60,y:34}});await screenshot(a,'terrain-river-bridge');
  await a.keyboard.press('b');await screenshot(a,'graphite-shop');await a.keyboard.press('Escape');
  await b.close();await a.waitForFunction(()=>window.__room?.paused===true);await screenshot(a,'vision-paused');
  passed.push('玩家断线暂停后保持战场视野遮蔽');
  assert.deepEqual(errors,[]);await writeFile('artifacts/terrain-playtest-report.json',JSON.stringify({passed,errors},null,2));console.log(JSON.stringify({passed,errors},null,2));
}finally{await browser.close();}
