'use strict';
/*
  TOWN AFTERmath - servidor de salas (fase 1)
  Uso:   npm install ws   y luego   node server.js        (puerto 8080, o PORT=XXXX)
  Solo reenvia mensajes entre los jugadores de una sala (hasta 4). No guarda nada.
*/
const MAXP = 4, NAME_MAX = 14, ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeHub() {
  const rooms = new Map();
  const gen = () => { for (;;) { let c = ''; for (let i = 0; i < 4; i++) c += ABC[Math.random() * ABC.length | 0]; if (!rooms.has(c)) return c; } };
  const clean = (n, id) => { n = String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, NAME_MAX); return n || ('Jugador' + (id + 1)); };
  const info = r => ({ t: 'room', code: r.code, max: r.max, host: r.host, started: r.started,
    players: [...r.players.entries()].map(([id, p]) => ({ id, name: p.name })) });
  const bcast = (r, o, except) => { for (const [id, p] of r.players) if (id !== except) p.c.send(o); };
  const pushRoom = r => { for (const [id, p] of r.players) p.c.send(Object.assign(info(r), { you: id })); };

  function leave(c) {
    const r = c.room; if (!r) return;
    r.players.delete(c.id); c.room = null;
    if (!r.players.size) { rooms.delete(r.code); return; }
    if (r.host === c.id) r.host = Math.min(...r.players.keys());
    bcast(r, { t: 'left', id: c.id }); pushRoom(r);
  }
  function enter(c, r, id, name) { c.room = r; c.id = id; r.players.set(id, { c, name: clean(name, id) }); }

  function onMsg(c, m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'create': {
        leave(c);
        const r = { code: gen(), max: Math.min(MAXP, Math.max(2, +m.max || MAXP)), started: false, host: 0, players: new Map() };
        rooms.set(r.code, r); enter(c, r, 0, m.name); pushRoom(r); break;
      }
      case 'join': {
        leave(c);
        const r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return c.send({ t: 'err', c: 'nf' });
        if (r.started) return c.send({ t: 'err', c: 'started' });
        let id = 0; while (r.players.has(id)) id++;
        if (id >= r.max) return c.send({ t: 'err', c: 'full' });
        enter(c, r, id, m.name); pushRoom(r); break;
      }
      case 'start': {
        const r = c.room; if (!r || r.host !== c.id || r.started) return;
        r.started = true; bcast(r, { t: 'start' }); pushRoom(r); break;
      }
      case 'again': {
        const r = c.room; if (!r || r.host !== c.id || !r.started) return;
        r.started = false; pushRoom(r); break;
      }
      case 'm': {
        const r = c.room; if (!r || !m.d || typeof m.d !== 'object') return;
        const o = { t: 'm', from: c.id, d: m.d };
        if (m.to != null) { const p = r.players.get(+m.to); if (p) p.c.send(o); } else bcast(r, o, c.id);
        break;
      }
      case 'ping': c.send({ t: 'pong', ts: m.ts }); break;
      case 'leave': leave(c); break;
    }
  }
  return { onMsg, leave, rooms };
}

module.exports = { makeHub };

if (require.main === module) {
  const http = require('http');
  const { WebSocketServer } = require('ws');
  const PORT = process.env.PORT || 8080;
  const hub = makeHub();
  const fs = require('fs'), path = require('path'), os = require('os');
  const gameFile = () => { try { const f = fs.readdirSync(__dirname).filter(n => /^TOWN.*\.html$/i.test(n)).sort().pop(); return f ? path.join(__dirname, f) : null; } catch (_) { return null; } };
  const srv = http.createServer((q, s) => {
    const p = (q.url || '/').split('?')[0], g = gameFile();
    if ((p === '/' || p === '/index.html') && g) { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(g).pipe(s); return; }
    s.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    s.end('TOWN AFTERmath server OK' + (g ? '' : ' (pon el archivo TOWN_AFTERmath_*.html en esta carpeta para jugar desde aqui)'));
  });
  const wss = new WebSocketServer({ server: srv, maxPayload: 8192 });
  wss.on('connection', ws => {
    const c = { room: null, id: -1, send: o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); } };
    let n = 0, t0 = Date.now(); ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      const now = Date.now(); if (now - t0 > 1000) { t0 = now; n = 0; }
      if (++n > 120) return;
      let m; try { m = JSON.parse(raw); } catch (_) { return; }
      try { hub.onMsg(c, m); } catch (e) { console.error(e); }
    });
    ws.on('close', () => hub.leave(c));
    ws.on('error', () => {});
  });
  setInterval(() => { wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }); }, 30000);
  srv.listen(PORT, () => {
    console.log('TOWN AFTERmath server en puerto ' + PORT);
    console.log(gameFile() ? '\nJUEGA AQUI (en esta PC):  http://localhost:' + PORT : '\n(Falta el archivo TOWN_AFTERmath_*.html en esta carpeta)');
    for (const L of Object.values(os.networkInterfaces())) for (const a of L || []) if (a.family === 'IPv4' && !a.internal) console.log('Desde el celular (mismo Wi-Fi):  http://' + a.address + ':' + PORT);
    console.log('\nDeja esta ventana abierta mientras juegas.');
  });
}
