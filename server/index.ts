import { createServer, type Server } from 'node:http';
import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createMatch, stepMatch, applyCommand, isUnitVisibleToTeam, isPointInTeamVision, bushAt } from '../src/shared/simulation.ts';
import { RULES, HEROES } from '../src/shared/data.ts';
import type { HeroKind, Team, MatchState, Command, Point } from '../src/shared/types.ts';

const scrypt = promisify(scryptCallback);
const PROTOCOL = 'glass-lane-v2';
const VERSION = '0.2.0';
const MIME: Record<string,string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.glb':'model/gltf-binary', '.ico':'image/x-icon' };
type Phase = 'lobby'|'playing'|'finished';
interface Player { id:string; token:string; name:string; hero:HeroKind; team:Team; ready:boolean; bot:boolean; socket:WebSocket|null; disconnectedAt:number|null }
interface Room { code:string; hostId:string; phase:Phase; players:Player[]; salt:Buffer; passwordHash:Buffer; match:MatchState|null; touchedAt:number; notice:string }
interface Connection { room:Room|null; player:Player|null; ip:string; messages:number; windowAt:number; alive:boolean; chain:Promise<void> }

/** Never send a concealed opponent's coordinates, including on reconnect. */
export function snapshotForTeam(state:MatchState,team:Team):MatchState {
  const visible=state.units.filter(unit=>isUnitVisibleToTeam(state,unit,team));
  const visibleIds=new Set(visible.map(unit=>unit.id));
  const hiddenIds=new Set(state.units.filter(unit=>!visibleIds.has(unit.id)).map(unit=>unit.id));
  const observer=state.units.find(unit=>unit.kind==='hero'&&unit.team===team);
  const touchesVision=(point:Point,radius=0)=>!!observer&&Math.hypot(point.x-observer.x,point.y-observer.y)<=RULES.visionRadius+radius;
  const nearestVisiblePoint=(point:Point):Point=>{
    if(!observer||isPointInTeamVision(state,point,team))return point;
    const distance=Math.hypot(point.x-observer.x,point.y-observer.y),ratio=RULES.visionRadius/distance;
    return{x:observer.x+(point.x-observer.x)*ratio,y:observer.y+(point.y-observer.y)*ratio};
  };
  return {
    ...state,
    teamKills:[state.units.find(unit=>unit.kind==='hero'&&unit.team===0)?.kills??0,state.units.find(unit=>unit.kind==='hero'&&unit.team===1)?.kills??0],
    units:visible.map(unit=>{
      // Cast queues, recast origins and status payloads can contain hidden targets or coordinates.
      const {activeDash,pendingSpell,pendingAttack,recastArmed,recentDamagers,statuses,...publicUnit}=unit;
      return {
        ...publicUnit,
        recastSlot:recastArmed&&recastArmed.until>state.time?recastArmed.slot:undefined,
        recastUntil:recastArmed&&recastArmed.until>state.time?recastArmed.until:undefined,
        statuses:statuses?.map(status=>({kind:status.kind,until:status.until,...(status.pct===undefined?{}:{pct:status.pct})})),
        targetId:unit.targetId&&hiddenIds.has(unit.targetId)?null:unit.targetId,
        orderedTargetId:unit.orderedTargetId&&hiddenIds.has(unit.orderedTargetId)?null:unit.orderedTargetId,
        moveTarget:unit.moveTarget&&!isPointInTeamVision(state,unit.moveTarget,team)?null:unit.moveTarget,
        attackMoveTarget:unit.attackMoveTarget&&!isPointInTeamVision(state,unit.attackMoveTarget,team)?null:unit.attackMoveTarget,
      };
    }),
    effects:state.effects.filter(effect=>{
      if(!touchesVision(effect,effect.kind==='nova'?effect.radius??0:0))return false;
      if(effect.toX!==undefined&&effect.toY!==undefined&&!isPointInTeamVision(state,{x:effect.toX,y:effect.toY},team))return false;
      // Ground warnings and projectiles remain readable even when cast from cover.
      if(effect.team===team||effect.kind==='nova'||effect.kind==='bolt')return true;
      if(effect.sourceId)return !hiddenIds.has(effect.sourceId);
      if((effect.kind==='heal'||effect.kind==='shield')&&bushAt(effect)){
        return visible.some(unit=>unit.team===effect.team&&unit.kind==='hero'&&Math.hypot(unit.x-effect.x,unit.y-effect.y)<80);
      }
      return true;
    }).map(effect=>({...effect,sourceId:effect.sourceId&&hiddenIds.has(effect.sourceId)?undefined:effect.sourceId})),
    projectiles:state.projectiles.filter(projectile=>touchesVision(projectile,projectile.radius)).map(projectile=>{
      // Intersecting hazards remain visible under the renderer's sight mask, while launch metadata stays private.
      const start=isPointInTeamVision(state,{x:projectile.startX,y:projectile.startY},team)?{x:projectile.startX,y:projectile.startY}:nearestVisiblePoint(projectile);
      const {effects,power,chain,zone,splash,...publicProjectile}=projectile;
      return{...publicProjectile,startX:start.x,startY:start.y,hitIds:projectile.hitIds.filter(id=>!hiddenIds.has(id)),homingTargetId:projectile.homingTargetId&&hiddenIds.has(projectile.homingTargetId)?undefined:projectile.homingTargetId};
    }),
    // The current HUD does not display the event log. Unseen combat must not leak through it.
    log:state.status==='finished'?state.log.slice(-1):[],
  };
}

/** A single authoritative process owns room state. Port 0 is useful for tests and desktop fallback. */
export async function createGameServer(options:{port?:number;host?:string;staticDir?:string;reconnectMs?:number}={}):Promise<{server:Server;port:number;close:()=>Promise<void>}> {
  const rooms = new Map<string,Room>();
  const tokens = new Map<string,{room:Room;player:Player}>();
  const connections = new WeakMap<WebSocket,Connection>();
  const attempts = new Map<string,{at:number;count:number}>();
  const reconnectMs=options.reconnectMs??60_000;
  const staticRoot=resolve(options.staticDir??resolve(process.cwd(),'dist'));
  const origins=(process.env.ALLOWED_ORIGINS??'').split(',').map(v=>v.trim()).filter(Boolean);
  function send(socket:WebSocket|null,message:unknown) { if(!socket||socket.readyState!==WebSocket.OPEN)return; if(socket.bufferedAmount>1_000_000){socket.terminate();return;} socket.send(JSON.stringify(message)); }
  function publicRoom(room:Room) {return {code:room.code,hostId:room.hostId,phase:room.phase,paused:room.phase==='playing'&&room.players.some(p=>!p.bot&&!p.socket),notice:room.notice,players:room.players.map(({id,name,hero,team,ready,bot,socket})=>({id,name,hero,team,ready,bot,connected:bot||!!socket}))};}
  function broadcast(room:Room,message:unknown){for(const p of room.players)send(p.socket,message);}
  function broadcastState(room:Room){if(room.match)for(const p of room.players)send(p.socket,{type:'state',state:snapshotForTeam(room.match,p.team)});}
  function roomChanged(room:Room){broadcast(room,{type:'room',room:publicRoom(room)});}
  function cleanName(raw:unknown){if(typeof raw!=='string')throw Error('请输入昵称。');const name=raw.trim().replace(/[\u0000-\u001f\u007f]/g,'');if(!name||name.length>20)throw Error('昵称需要为1～20个字符。');return name;}
  function password(raw:unknown){if(typeof raw!=='string'||raw.length<4||raw.length>32)throw Error('房间密码需要为4～32个字符。');return raw;}
  function hero(raw:unknown):HeroKind{if(typeof raw!=='string'||!Object.hasOwn(HEROES,raw))throw Error('请选择英雄。');return raw as HeroKind;}
  function requireProtocol(raw:unknown){if(raw!==PROTOCOL)throw Error('客户端版本过旧，请更新到0.2.0后联机。');}
  function authenticateAttempt(c:Connection){const now=Date.now();let a=attempts.get(c.ip);if(!a||now-a.at>60_000){a={at:now,count:0};attempts.set(c.ip,a);}if(++a.count>25)throw Error('操作太频繁，请稍后再试。');}
  function requireSeat(c:Connection){if(!c.room||!c.player)throw Error('请先创建或加入房间。');return {room:c.room,player:c.player};}
  function requireHost(c:Connection){const seat=requireSeat(c);if(seat.room.hostId!==seat.player.id)throw Error('只有房主可以操作。');return seat;}
  function resetLobby(room:Room,notice:string){room.phase='lobby';room.match=null;room.notice=notice;for(const p of room.players)p.ready=p.bot;roomChanged(room);}
  function dropRoom(room:Room){rooms.delete(room.code);for(const p of room.players)tokens.delete(p.token);}
  function leave(c:Connection){if(!c.room||!c.player)return;const {room,player}=c;tokens.delete(player.token);room.players=room.players.filter(p=>p!==player);c.room=null;c.player=null;if(room.players.every(p=>p.bot)){dropRoom(room);return;}if(room.hostId===player.id)room.hostId=room.players.find(p=>!p.bot)!.id;resetLobby(room,`${player.name}已离开，返回房间。`);}
  function welcome(c:Connection,socket:WebSocket,room:Room,player:Player){c.room=room;c.player=player;player.socket=socket;player.disconnectedAt=null;room.touchedAt=Date.now();send(socket,{type:'welcome',protocol:PROTOCOL,version:VERSION,playerId:player.id,token:player.token,room:publicRoom(room)});roomChanged(room);if(room.match)send(socket,{type:'state',state:snapshotForTeam(room.match,player.team)});}

  const server=createServer(async(req,res)=>{
    if(req.url?.split('?')[0]==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,game:'glass-lane',protocol:PROTOCOL,version:VERSION,heroIds:Object.keys(HEROES),rooms:rooms.size}));return;}
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    try{
      let pathname=decodeURIComponent((req.url??'/').split('?')[0]);
      if(pathname.includes('\0')||pathname.includes('\\'))throw Error('path');
      let file=resolve(staticRoot,'.'+pathname);
      if(file!==staticRoot&&!file.startsWith(staticRoot+sep))throw Error('path');
      if((await stat(file)).isDirectory())file=resolve(file,'index.html');
      const canonical=await realpath(file);const canonicalRoot=await realpath(staticRoot);
      if(!canonical.startsWith(canonicalRoot+sep))throw Error('path');
      const body=await readFile(canonical);res.writeHead(200,{'content-type':MIME[extname(canonical)]??'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache'});res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('未找到文件。');}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:8192});
  server.on('upgrade',(req,socket,head)=>{if(req.url!=='/ws'||wss.clients.size>=512||(origins.length&&req.headers.origin&&!origins.includes(req.headers.origin))){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
  wss.on('connection',(socket,req)=>{
    const c:Connection={room:null,player:null,ip:req.socket.remoteAddress??'unknown',messages:0,windowAt:Date.now(),alive:true,chain:Promise.resolve()};connections.set(socket,c);
    socket.on('pong',()=>{c.alive=true;});
    socket.on('message',raw=>{const now=Date.now();if(now-c.windowAt>=1000){c.windowAt=now;c.messages=0;}if(++c.messages>100){socket.close(1008,'rate limit');return;}c.chain=c.chain.then(async()=>{
      if(socket.readyState!==WebSocket.OPEN)return;
      const m=JSON.parse(raw.toString());if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.type!=='string')throw Error('无效请求。');
      if(m.type==='create'||m.type==='join'||m.type==='resume')requireProtocol(m.protocol);
      if(m.type==='create'){
        if(c.room)throw Error('请先离开当前房间。');authenticateAttempt(c);if(rooms.size>=256)throw Error('房间已满，请稍后再试。');
        const name=cleanName(m.name),choice=hero(m.hero),secret=password(m.password);let code='';do{code=String(randomInt(100000,1000000));}while(rooms.has(code));
        const salt=randomBytes(16),passwordHash=await scrypt(secret,salt,32) as Buffer;
        if(socket.readyState!==WebSocket.OPEN)return;
        const player:Player={id:randomBytes(8).toString('hex'),token:randomBytes(32).toString('hex'),name,hero:choice,team:0,ready:false,bot:false,socket:null,disconnectedAt:null};
        const room:Room={code,hostId:player.id,phase:'lobby',players:[player],salt,passwordHash,match:null,touchedAt:Date.now(),notice:''};rooms.set(code,room);tokens.set(player.token,{room,player});welcome(c,socket,room,player);
      }else if(m.type==='join'){
        if(c.room)throw Error('请先离开当前房间。');authenticateAttempt(c);const name=cleanName(m.name),choice=hero(m.hero),secret=password(m.password);if(typeof m.code!=='string'||!/^\d{6}$/.test(m.code))throw Error('请输入六位房间号。');
        const room=rooms.get(m.code);if(!room)throw Error('房间不存在或密码错误。');const hash=await scrypt(secret,room.salt,32) as Buffer;if(!timingSafeEqual(hash,room.passwordHash))throw Error('房间不存在或密码错误。');
        if(socket.readyState!==WebSocket.OPEN)return;if(room.phase!=='lobby'||room.players.length>=2)throw Error('房间正在对局或已满。');
        const team:Team=room.players.some(p=>p.team===0)?1:0;const player:Player={id:randomBytes(8).toString('hex'),token:randomBytes(32).toString('hex'),name,hero:choice,team,ready:false,bot:false,socket:null,disconnectedAt:null};room.players.push(player);tokens.set(player.token,{room,player});room.notice='';welcome(c,socket,room,player);
      }else if(m.type==='resume'){
        if(c.room)throw Error('当前连接已经在房间中。');authenticateAttempt(c);if(typeof m.token!=='string'||m.token.length!==64)throw Error('重连凭据已失效。');const found=tokens.get(m.token);if(!found)throw Error('房间已关闭或重连时间已过。');
        const old=found.player.socket;if(old&&old!==socket){const oldConnection=connections.get(old);if(oldConnection){oldConnection.room=null;oldConnection.player=null;}old.close(1000,'已在新窗口恢复');}welcome(c,socket,found.room,found.player);
      }else if(m.type==='leave'){leave(c);send(socket,{type:'left'});
      }else if(m.type==='select'){const {room,player}=requireSeat(c);if(room.phase!=='lobby')throw Error('对局中不能更换英雄。');player.hero=hero(m.hero);player.ready=false;roomChanged(room);
      }else if(m.type==='ready'){const {room,player}=requireSeat(c);if(room.phase!=='lobby'||typeof m.ready!=='boolean')throw Error('当前不能准备。');player.ready=m.ready;roomChanged(room);
      }else if(m.type==='bot'){const {room}=requireHost(c);if(room.phase!=='lobby'||room.players.length>=2)throw Error('没有空余位置。');const team:Team=room.players.some(p=>p.team===0)?1:0;const choices=Object.keys(HEROES) as HeroKind[];const botHero=choices[(choices.indexOf(room.players[0].hero)+1)%choices.length];room.players.push({id:'bot-'+randomBytes(4).toString('hex'),token:'',name:'训练陪练',hero:botHero,team,ready:true,bot:true,socket:null,disconnectedAt:null});roomChanged(room);
      }else if(m.type==='start'){const {room}=requireHost(c);if(room.phase!=='lobby'||room.players.length!==2||room.players.some(p=>!p.ready||(!p.bot&&!p.socket)))throw Error('需要两位玩家都准备后开始。');const choices=([0,1] as Team[]).map(t=>room.players.find(p=>p.team===t)!.hero) as [HeroKind,HeroKind];room.match=createMatch(choices,room.players.filter(p=>p.bot).map(p=>p.team));room.phase='playing';room.notice='';roomChanged(room);broadcastState(room);
      }else if(m.type==='rematch'){const {room}=requireHost(c);if(room.phase!=='finished')throw Error('请等待对局结束。');resetLobby(room,'选择英雄并准备，开始下一局。');
      }else if(m.type==='command'){const {room,player}=requireSeat(c);if(room.phase!=='playing'||!room.match)throw Error('对局尚未开始。');if(room.players.some(p=>!p.bot&&!p.socket))throw Error('等待对手重连，战场已暂停。');if(!m.command||typeof m.command!=='object')throw Error('无效操作。');const result=applyCommand(room.match,player.team,m.command as Command);if(!result.ok)throw Error(result.error??'无法执行此操作。');
      }else if(m.type==='ping'){send(socket,{type:'pong',time:Date.now()});
      }else throw Error('未知请求。');
    }).catch(error=>send(socket,{type:'error',message:error instanceof SyntaxError?'无效请求。':error instanceof Error?error.message:'操作失败。'}));});
    socket.on('close',()=>{const {room,player}=c;if(room&&player&&player.socket===socket){player.socket=null;player.disconnectedAt=Date.now();room.notice='玩家离线，战场暂停，等待60秒内重连。';roomChanged(room);}c.room=null;c.player=null;});
    socket.on('error',()=>{});
  });
  const timer=setInterval(()=>{const now=Date.now();for(const room of rooms.values()){
    const expired=room.players.filter(p=>!p.bot&&!p.socket&&p.disconnectedAt!==null&&now-p.disconnectedAt>reconnectMs);
    if(expired.length){for(const p of expired)tokens.delete(p.token);room.players=room.players.filter(p=>!expired.includes(p));if(room.players.every(p=>p.bot)){dropRoom(room);continue;}if(!room.players.some(p=>p.id===room.hostId))room.hostId=room.players.find(p=>!p.bot)!.id;resetLobby(room,'对手离线超时，返回房间，可重新邀请好友或添加陪练。');}
    if(room.phase==='playing'&&room.match&&room.players.every(p=>p.bot||!!p.socket)){stepMatch(room.match,0.05);if(room.match.status==='finished'){room.phase='finished';roomChanged(room);}broadcastState(room);}
  }for(const [ip,a] of attempts)if(now-a.at>60_000)attempts.delete(ip);},50);
  const heartbeat=setInterval(()=>{for(const socket of wss.clients){const c=connections.get(socket)!;if(!c.alive){socket.terminate();continue;}c.alive=false;socket.ping();}},15_000);
  try{await new Promise<void>((resolveListen,reject)=>{server.once('error',reject);server.listen(options.port??Number(process.env.PORT??4327),options.host??'0.0.0.0',()=>{server.off('error',reject);resolveListen();});});}catch(error){clearInterval(timer);clearInterval(heartbeat);wss.close();throw error;}
  const port=(server.address() as {port:number}).port;
  return {server,port,close:async()=>{clearInterval(timer);clearInterval(heartbeat);for(const socket of wss.clients)socket.terminate();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}};
}

if(/[\\/]server[\\/]index\.ts$|[\\/]server\.cjs$/.test(process.argv[1]??'')){
  createGameServer().then(({port})=>console.log(`透明单线MOBA房间服务：http://localhost:${port}`)).catch(error=>{console.error(error);process.exitCode=1;});
}

