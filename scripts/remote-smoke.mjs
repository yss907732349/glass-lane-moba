import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { WebSocket } from 'ws';

const address = process.env.GAME_URL || process.argv[2];
if (!address) throw Error('请通过 GAME_URL 或首个参数指定待验收的线上 HTTPS 根地址。');
const base = new URL(address);
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('服务地址必须是无账号密码的 HTTP / HTTPS 根地址。');
base.pathname = '/'; base.search = ''; base.hash = '';
const passed = [], clients = [], started = Date.now();
async function fetchOk(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200, `${path} HTTP status`);
  return response;
}
async function client() {
  const endpoint = new URL('/ws', base); endpoint.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(endpoint, { headers: { Origin: base.origin }, handshakeTimeout: 20000 });
  const inbox = [], listeners = new Set();
  socket.on('message', raw => { inbox.push(JSON.parse(raw.toString())); if (inbox.length > 1000) inbox.shift(); for (const listener of listeners) listener(); });
  socket.on('error', () => {});
  const opened = once(socket, 'open');
  await Promise.race([opened, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('WebSocket 建连超时')), 22000); timer.unref(); opened.finally(() => clearTimeout(timer)).catch(() => {}); })]);
  const c = {
    socket,
    send(message) { socket.send(JSON.stringify(message)); },
    clear() { inbox.length = 0; },
    wait(predicate, timeout = 12000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(Error('等待线上状态超时')); }, timeout);
        function check() { const index = inbox.findIndex(predicate); if (index >= 0) { const [message] = inbox.splice(index, 1); clearTimeout(timer); listeners.delete(check); resolve(message); } }
        listeners.add(check); check();
      });
    },
  };
  clients.push(c); return c;
}
try {
  const health = await (await fetchOk('/health')).json();
  assert.equal(health.ok, true); assert.equal(health.game, 'glass-lane'); assert.equal(health.protocol, 'glass-lane-v1');
  passed.push('线上健康检查与 MOBA 协议匹配');
  const entry = await (await fetchOk('/')).text();
  const bundles = [...entry.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(m => m[1]);
  assert(bundles.some(path => path.endsWith('.js')), 'entry includes built JS');
  for (const bundle of bundles) { const response = await fetchOk(bundle); assert((await response.arrayBuffer()).byteLength > 100); }
  for (const hero of ['knight', 'mage']) { const response = await fetchOk(`/assets/heroes/${hero}.png`); assert.match(response.headers.get('content-type') || '', /image\/png/); assert((await response.arrayBuffer()).byteLength > 50); }
  passed.push('公开入口、构建文件和两位英雄素材均可加载');
  let a = await client(); const b = await client();
  const password = randomBytes(12).toString('hex');
  a.send({ type: 'create', name: '部署验证甲', password, hero: 'knight' });
  const welcome = await a.wait(m => m.type === 'welcome');
  b.send({ type: 'join', name: '部署验证乙', password, code: welcome.room.code, hero: 'mage' });
  await b.wait(m => m.type === 'welcome');
  a.send({ type: 'ready', ready: true }); b.send({ type: 'ready', ready: true });
  await a.wait(m => m.type === 'room' && m.room.players.length === 2 && m.room.players.every(p => p.ready));
  a.send({ type: 'start' });
  await Promise.all([a.wait(m => m.type === 'state' && m.state.status === 'playing'), b.wait(m => m.type === 'state' && m.state.status === 'playing')]);
  passed.push('两个独立公网连接完成建房、加入、准备和开局');
  a.clear(); a.send({ type: 'command', command: { type: 'move', x: 620, y: 1000 } });
  await a.wait(m => m.type === 'state' && m.state.units.some(u => u.id === 'hero-0' && u.x > 360));
  a.send({ type: 'command', command: { type: 'upgrade', slot: 0 } });
  await a.wait(m => m.type === 'state' && m.state.units.some(u => u.id === 'hero-0' && u.skillRanks[0] === 1 && u.skillPoints === 0));
  passed.push('真实指令由线上服务判定并同步移动和技能升级');
  b.clear(); a.socket.close();
  await b.wait(m => m.type === 'room' && m.room.paused);
  a = await client(); a.send({ type: 'resume', token: welcome.token });
  const resumed = await a.wait(m => m.type === 'welcome'); assert.equal(resumed.playerId, welcome.playerId);
  await a.wait(m => m.type === 'state' && m.state.units.some(u => u.id === 'hero-0' && u.skillRanks[0] === 1));
  await b.wait(m => m.type === 'room' && !m.room.paused);
  passed.push('断线暂停、重连恢复座位与技能状态');
  a.send({ type: 'leave' }); await a.wait(m => m.type === 'left');
  b.send({ type: 'leave' }); await b.wait(m => m.type === 'left');
  passed.push('验证房间已主动退出清理');
  const report = { address: base.origin, passed, elapsedMs: Date.now() - started, verifiedAt: new Date().toISOString() };
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/remote-smoke-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const c of clients) if (c.socket.readyState === WebSocket.OPEN) { try { c.send({ type: 'leave' }); } catch {} c.socket.close(); }
  for (const c of clients) c.socket.terminate();
}
