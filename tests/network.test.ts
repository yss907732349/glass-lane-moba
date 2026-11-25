import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createGameServer, snapshotForTeam } from '../server/index.ts';
import { WORLD, TERRAIN, RULES } from '../src/shared/data.ts';
import { createMatch, getHero } from '../src/shared/simulation.ts';

interface Message {type:string;[key:string]:any}

test('team snapshots conceal bush heroes, references and private effects without mutating the match',()=>{
  const state=createMatch(),hidden=getHero(state,1),mine=getHero(state,0),bush=TERRAIN.bushes[2];
  hidden.x=bush.x;hidden.y=bush.y;mine.x=bush.x-300;mine.y=bush.y;state.time=10;
  mine.kills=2;hidden.kills=3;
  mine.targetId=hidden.id;mine.orderedTargetId=hidden.id;
  state.effects.push(
    {id:'private-heal',kind:'heal',team:1,x:hidden.x,y:hidden.y,start:10,end:11,sourceId:hidden.id},
    {id:'ground-warning',kind:'nova',team:1,x:hidden.x,y:hidden.y,start:10,end:11,radius:135,sourceId:hidden.id},
  );
  state.projectiles.push({id:'shot',kind:'bolt',team:0,ownerId:mine.id,x:mine.x,y:mine.y,startX:mine.x,startY:mine.y,dirX:1,dirY:0,speed:600,range:650,radius:10,damage:100,hitIds:[hidden.id]});
  const projected=snapshotForTeam(state,0);
  assert.deepEqual(projected.teamKills,[2,3],'the public scoreboard remains complete when an enemy is concealed');
  assert.equal(projected.units.some(unit=>unit.id===hidden.id),false);
  assert.equal(projected.units.find(unit=>unit.id===mine.id)!.targetId,null);
  assert.equal(projected.units.find(unit=>unit.id===mine.id)!.orderedTargetId,null);
  assert.equal(projected.effects.some(effect=>effect.id==='private-heal'),false);
  assert.equal(projected.effects.some(effect=>effect.id==='ground-warning'),true);
  assert.deepEqual(projected.projectiles[0].hitIds,[]);
  assert.equal(mine.targetId,hidden.id,'serialization must not clear authoritative attack orders');
  assert.deepEqual(state.projectiles[0].hitIds,[hidden.id]);
  assert.equal(snapshotForTeam(state,1).units.some(unit=>unit.id===hidden.id),true,'allies retain their own hero');
  hidden.revealedUntil=13;
  assert.equal(snapshotForTeam(state,0).units.some(unit=>unit.id===hidden.id),true,'damage reveal restores the hero in snapshots');
  state.time=13.01;
  assert.equal(snapshotForTeam(state,0).units.some(unit=>unit.id===hidden.id),false,'concealment resumes when reveal expires');
});

test('vision snapshots omit distant units and effects while retaining incoming visible projectiles',()=>{
  const state=createMatch(),mine=getHero(state,0),enemy=getHero(state,1);
  mine.x=1800;mine.y=WORLD.laneY;enemy.x=mine.x+RULES.visionRadius+1;enemy.y=mine.y;
  enemy.revealedUntil=999;
  mine.targetId=enemy.id;
  const distantAlly=state.units.find(unit=>unit.id==='base-0')!;
  state.effects.push(
    {id:'outside-warning',kind:'nova',team:1,x:mine.x+RULES.visionRadius+136,y:enemy.y,start:0,end:1,radius:135},
    {id:'outside-attack-end',kind:'attack',team:0,x:mine.x,y:mine.y,toX:enemy.x,toY:enemy.y,start:0,end:1},
    {id:'visible-warning',kind:'nova',team:1,x:mine.x+200,y:mine.y,start:0,end:1,radius:135,sourceId:enemy.id},
    {id:'overlapping-warning',kind:'nova',team:1,x:mine.x+RULES.visionRadius+100,y:mine.y,start:0,end:1,radius:135,sourceId:enemy.id},
  );
  const shot={id:'incoming',kind:'bolt' as const,team:1 as const,ownerId:enemy.id,x:mine.x+500,y:mine.y,startX:enemy.x,startY:enemy.y,dirX:-1,dirY:0,speed:600,range:650,radius:10,damage:100,hitIds:[enemy.id]};
  state.projectiles.push(shot,{...shot,id:'outside-shot',x:enemy.x+20},{...shot,id:'overlapping-shot',x:mine.x+RULES.visionRadius+5});
  state.log.push('红方在视野外阵亡');
  const projected=snapshotForTeam(state,0);
  assert.equal(projected.units.some(unit=>unit.id===enemy.id),false,'damage reveal does not grant global sight');
  assert.equal(projected.units.some(unit=>unit.id===distantAlly.id),false,'distant allied structures also leave local sight');
  assert.equal(projected.units.find(unit=>unit.id===mine.id)!.targetId,null);
  assert.deepEqual(projected.effects.map(effect=>effect.id),['visible-warning','overlapping-warning']);
  assert.equal(projected.effects[0].sourceId,undefined);
  assert.equal(projected.projectiles.length,2);
  assert.equal(projected.projectiles[0].startX,shot.x,'unseen launch coordinates are replaced by the visible projectile position');
  assert.equal(projected.projectiles[1].startX,mine.x+RULES.visionRadius,'partially visible projectiles keep launch metadata inside sight');
  assert.equal(shot.startX,enemy.x,'projection leaves authoritative trajectory intact');
  assert.deepEqual(projected.log,[]);
  enemy.x=mine.x+RULES.visionRadius;
  assert.equal(snapshotForTeam(state,0).units.some(unit=>unit.id===enemy.id),true,'the exact sight boundary is inclusive');
});

async function client(port:number){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const inbox:Message[]=[];const listeners=new Set<()=>void>();
  socket.on('message',raw=>{inbox.push(JSON.parse(raw.toString()));for(const f of listeners)f();});
  await once(socket,'open');
  function wait(predicate:(message:Message)=>boolean,timeout=3000):Promise<Message>{return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{listeners.delete(check);reject(Error(`等待消息超时：${inbox.map(x=>x.type).join(',')}`));},timeout);
    function check(){const index=inbox.findIndex(predicate);if(index>=0){const [value]=inbox.splice(index,1);clearTimeout(timer);listeners.delete(check);resolve(value);}}
    listeners.add(check);check();
  });}
  return {socket,send:(message:unknown)=>socket.send(JSON.stringify(message)),wait,clear:()=>{inbox.length=0;}};
}

test('real two-client rooms authenticate, enforce host rules, simulate commands and resume seats',async()=>{
  const service=await createGameServer({port:0,host:'127.0.0.1'});
  const a=await client(service.port),b=await client(service.port);
  let resumed:Awaited<ReturnType<typeof client>>|null=null;
  try{
    const health=await fetch(`http://127.0.0.1:${service.port}/health`).then(r=>r.json()) as any;
    assert.equal(health.protocol,'glass-lane-v1');
    a.send({type:'create',name:'房主',password:'abcd',hero:'knight'});
    const welcome=await a.wait(m=>m.type==='welcome');assert.match(welcome.room.code,/^\d{6}$/);assert.equal(welcome.room.players.length,1);
    b.send({type:'join',name:'朋友',password:'wrong',code:welcome.room.code,hero:'mage'});
    assert.match((await b.wait(m=>m.type==='error')).message,/密码/);
    b.send({type:'join',name:'朋友',password:'abcd',code:welcome.room.code,hero:'mage'});
    const friend=await b.wait(m=>m.type==='welcome');assert.equal(friend.room.players.length,2);assert.equal(friend.room.players[1].team,1);
    assert.equal(JSON.stringify(friend).includes('passwordHash'),false);
    b.send({type:'start'});assert.match((await b.wait(m=>m.type==='error')).message,/房主/);
    a.send({type:'start'});assert.match((await a.wait(m=>m.type==='error')).message,/准备/);
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});
    await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every((p:any)=>p.ready));
    a.send({type:'start'});
    const state=await a.wait(m=>m.type==='state');assert.equal(state.state.status,'playing');
    assert.deepEqual(state.state.units.filter((u:any)=>u.kind==='hero').map((u:any)=>u.id),['hero-0'],'the opponent starts outside local sight');
    b.clear();b.send({type:'command',command:{type:'move',x:WORLD.spawnX[1]-500,y:WORLD.laneY}});
    const advanced=await b.wait(m=>m.type==='state'&&m.state.time>0.1);assert.ok(advanced.state.units.find((u:any)=>u.id==='hero-1').x<WORLD.spawnX[1]);
    b.send({type:'command',command:{type:'upgrade',slot:0}});
    await b.wait(m=>m.type==='state'&&m.state.units.find((u:any)=>u.id==='hero-1').skillRanks[0]===1);
    b.send({type:'command',command:{type:'summoner',slot:'flash',x:WORLD.spawnX[1]-700,y:WORLD.laneY}});
    const flashed=await b.wait(m=>m.type==='state'&&m.state.units.find((u:any)=>u.id==='hero-1').summonerCooldowns.flash>0);
    assert.ok(flashed.state.units.find((u:any)=>u.id==='hero-1').x<WORLD.spawnX[1]-200);
    b.send({type:'command',command:{type:'summoner',slot:'heal',x:WORLD.spawnX[1],y:WORLD.laneY}});
    await b.wait(m=>m.type==='state'&&m.state.units.find((u:any)=>u.id==='hero-1').summonerCooldowns.heal>0);
    b.send({type:'command',command:{type:'move',x:'invalid',y:400}});
    assert.equal((await b.wait(m=>m.type==='error')).type,'error');
    a.clear();b.socket.close();
    const paused=await a.wait(m=>m.type==='room'&&m.room.paused);assert.equal(paused.room.players[1].connected,false);
    resumed=await client(service.port);resumed.send({type:'resume',token:friend.token});
    const restored=await resumed.wait(m=>m.type==='welcome');assert.equal(restored.playerId,friend.playerId);assert.equal(restored.room.paused,false);
    assert.equal((await resumed.wait(m=>m.type==='state')).state.status,'playing');
    resumed.send({type:'leave'});await resumed.wait(m=>m.type==='left');
    const lobby=await a.wait(m=>m.type==='room'&&m.room.phase==='lobby'&&m.room.players.length===1);assert.match(lobby.room.notice,/离开/);
  }finally{a.socket.terminate();b.socket.terminate();resumed?.socket.terminate();await service.close();}
});

test('live room ticks and reconnects keep enemy bush coordinates private',async()=>{
  const service=await createGameServer({port:0,host:'127.0.0.1'});
  const a=await client(service.port),b=await client(service.port);
  let resumed:Awaited<ReturnType<typeof client>>|null=null;
  try{
    a.send({type:'create',name:'观察方',password:'abcd',hero:'knight'});const wa=await a.wait(m=>m.type==='welcome');
    b.send({type:'join',name:'潜伏方',password:'abcd',code:wa.room.code,hero:'mage'});await b.wait(m=>m.type==='welcome');
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});
    await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every((p:any)=>p.ready));
    a.send({type:'start'});await b.wait(m=>m.type==='state');
    const bush=TERRAIN.bushes.find(p=>p.x>WORLD.width/2)!;
    const watch={x:TERRAIN.river.minX-140,y:WORLD.laneY};
    a.send({type:'command',command:{type:'summoner',slot:'flash',...watch}});
    a.send({type:'command',command:{type:'move',...watch}});
    b.send({type:'command',command:{type:'summoner',slot:'flash',x:bush.x,y:bush.y}});
    b.send({type:'command',command:{type:'move',x:bush.x,y:bush.y}});
    const covered=await b.wait(m=>m.type==='state'&&m.state.units.some((u:any)=>u.id==='hero-1'&&Math.hypot(u.x-bush.x,u.y-bush.y)<2),15000);
    a.clear();
    const unseen=await a.wait(m=>m.type==='state'&&m.state.time>covered.state.time);
    const observer=unseen.state.units.find((u:any)=>u.id==='hero-0');
    assert.ok(Math.hypot(observer.x-bush.x,observer.y-bush.y)<RULES.visionRadius,'the bush is inside the observing hero vision');
    assert.equal(unseen.state.units.some((u:any)=>u.id==='hero-1'),false,'the opposing client receives no concealed hero record');
    assert.equal(covered.state.units.some((u:any)=>u.id==='hero-1'),true,'the concealed player still receives their own hero');
    a.send({type:'command',command:{type:'attack',targetId:'hero-1'}});
    assert.equal((await a.wait(m=>m.type==='error')).type,'error','a guessed target ID cannot bypass concealment');
    resumed=await client(service.port);resumed.send({type:'resume',token:wa.token});
    await resumed.wait(m=>m.type==='welcome');
    const restored=await resumed.wait(m=>m.type==='state');
    assert.equal(restored.state.units.some((u:any)=>u.id==='hero-1'),false,'reconnect uses the same private projection');
  }finally{a.socket.terminate();b.socket.terminate();resumed?.socket.terminate();await service.close();}
});

test('bot start and expired reconnect release seat visibly instead of leaving stale matches',async()=>{
  const service=await createGameServer({port:0,host:'127.0.0.1',reconnectMs:100});
  const a=await client(service.port),b=await client(service.port);
  try{
    a.send({type:'create',name:'甲',password:'abcd',hero:'knight'});const wa=await a.wait(m=>m.type==='welcome');
    b.send({type:'join',name:'乙',password:'abcd',code:wa.room.code,hero:'mage'});const wb=await b.wait(m=>m.type==='welcome');
    a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await a.wait(m=>m.type==='room'&&m.room.players.length===2&&m.room.players.every((p:any)=>p.ready));
    a.send({type:'start'});await a.wait(m=>m.type==='state');a.clear();b.socket.terminate();
    const expired=await a.wait(m=>m.type==='room'&&m.room.phase==='lobby'&&m.room.players.length===1);
    assert.match(expired.room.notice,/超时/);
    const c=await client(service.port);try{c.send({type:'resume',token:wb.token});assert.match((await c.wait(m=>m.type==='error')).message,/关闭|时间/);}finally{c.socket.terminate();}
    a.clear();a.send({type:'bot'});await a.wait(m=>m.type==='room'&&m.room.players.some((p:any)=>p.bot));
    a.send({type:'ready',ready:true});await a.wait(m=>m.type==='room'&&m.room.players.every((p:any)=>p.ready));
    a.send({type:'start'});const state=await a.wait(m=>m.type==='state');assert.equal(state.state.units.find((u:any)=>u.id==='hero-0').bot,false);assert.equal(state.state.units.some((u:any)=>u.id==='hero-1'),false,'distant bot remains outside local sight');
  }finally{a.socket.terminate();b.socket.terminate();await service.close();}
});

test('static serving exposes only dist content and rejects encoded traversal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'glass-lane-'));await mkdir(join(root,'dist'));await writeFile(join(root,'secret.txt'),'private');await writeFile(join(root,'dist','index.html'),'<title>Glass Lane</title>');
  const service=await createGameServer({port:0,host:'127.0.0.1',staticDir:join(root,'dist')});
  try{
    assert.equal(await fetch(`http://127.0.0.1:${service.port}/`).then(r=>r.text()),'<title>Glass Lane</title>');
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/%2e%2e%2fsecret.txt`)).status,404);
    assert.equal((await fetch(`http://127.0.0.1:${service.port}/%5c..%5csecret.txt`)).status,404);
  }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
