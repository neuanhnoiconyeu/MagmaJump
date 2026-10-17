const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function code() {
  let result;
  do { result = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); }
  while (rooms.has(result));
  return result;
}
function snapshot(room) {
  return {
    code: room.code, status: room.status, hostId: room.hostId, seed: room.seed,
    startedAt: room.startedAt, lava: room.lava, winnerId: room.winnerId,
    players: [...room.players.values()].map(p => ({ ...p }))
      .sort((a, b) => b.height - a.height || a.joinedAt - b.joinedAt)
  };
}
function publish(room) {
  room.revision++;
  const data = `event: state\ndata: ${JSON.stringify({ ...snapshot(room), revision: room.revision })}\n\n`;
  for (const res of room.listeners) res.write(data);
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 16_384) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  });
}
function cleanName(value) { return String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 14); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    try {
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const input = await body(req), name = cleanName(input.name);
        if (!name) return send(res, 400, { error: 'Choose a pilot name first.' });
        const roomCode = code(), playerId = crypto.randomUUID();
        const room = { code: roomCode, status: 'lobby', hostId: playerId, seed: crypto.randomInt(1, 2 ** 31), startedAt: null, lava: 0, winnerId: null, players: new Map(), listeners: new Set(), revision: 0 };
        room.players.set(playerId, { id: playerId, name, color: crypto.randomInt(0, 8), height: 0, altitude: 18, x: .5, alive: true, ready: true, joinedAt: Date.now() });
        rooms.set(roomCode, room); publish(room);
        return send(res, 201, { code: roomCode, playerId });
      }
      if (req.method === 'POST' && url.pathname === '/api/join') {
        const input = await body(req), roomCode = String(input.code || '').trim().toUpperCase(), name = cleanName(input.name), room = rooms.get(roomCode);
        if (!name) return send(res, 400, { error: 'Choose a pilot name first.' });
        if (!room) return send(res, 404, { error: 'That room code doesn’t exist. Check it and try again.' });
        if (room.players.size >= 8) return send(res, 409, { error: 'This room is full (8 pilots max).' });
        if (room.status !== 'lobby') return send(res, 409, { error: 'This round has already started.' });
        const playerId = crypto.randomUUID();
        room.players.set(playerId, { id: playerId, name, color: crypto.randomInt(0, 8), height: 0, altitude: 18, x: .5, alive: true, ready: false, joinedAt: Date.now() });
        publish(room); return send(res, 201, { code: roomCode, playerId });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
        if (!room) return send(res, 404, { error: 'Room closed.' });
        return send(res, 200, snapshot(room));
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
        if (!room) return send(res, 404, { error: 'Room closed.' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'access-control-allow-origin': '*' });
        res.write(`data: ${JSON.stringify(snapshot(room))}\n\n`);
        room.listeners.add(res);
        req.on('close', () => room.listeners.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        const input = await body(req), room = rooms.get(String(input.code || '').toUpperCase()), player = room?.players.get(input.playerId);
        if (!player) return send(res, 404, { error: 'Pilot or room not found.' });
        if (input.action === 'ready' && room.status === 'lobby') player.ready = !player.ready;
        else if (input.action === 'start' && player.id === room.hostId && room.status === 'lobby') {
          room.status = 'playing'; room.startedAt = Date.now() + 8000; room.lava = 0;
          for (const pilot of room.players.values()) { pilot.alive = true; pilot.height = 0; pilot.altitude = 18; pilot.x = .5; pilot.ready = true; }
        } else if (input.action === 'again' && player.id === room.hostId && room.status === 'finished') {
          room.status = 'lobby'; room.startedAt = null; room.winnerId = null; room.lava = 0;
          for (const pilot of room.players.values()) { pilot.alive = true; pilot.height = 0; pilot.altitude = 18; pilot.x = .5; pilot.ready = pilot.id === room.hostId; }
        } else if (input.action === 'update' && room.status === 'playing' && player.alive) {
          player.height = Math.max(player.height, Math.min(100000, Number(input.height) || 0));
          player.altitude = Math.max(0, Math.min(100000, Number(input.altitude) || 0));
          player.x = Math.max(0, Math.min(1, Number(input.x) || 0));
          player.alive = input.alive !== false;
        } else if (input.action === 'lava' && room.status === 'playing') {
          room.lava = Math.max(room.lava, Math.min(100000, Number(input.height) || 0));
        }
        if (room.status === 'playing' && [...room.players.values()].every(p => !p.alive)) {
          room.status = 'finished';
          room.winnerId = [...room.players.values()].sort((a, b) => b.height - a.height)[0]?.id || null;
        }
        publish(room); return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/leave') {
        const input = await body(req), room = rooms.get(String(input.code || '').toUpperCase());
        if (!room) return send(res, 200, { ok: true });
        room.players.delete(input.playerId);
        if (!room.players.size) { for (const listener of room.listeners) listener.end(); rooms.delete(room.code); }
        else { if (room.hostId === input.playerId) room.hostId = room.players.keys().next().value; publish(room); }
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (error) { return send(res, 400, { error: error.message || 'Request failed.' }); }
  }
  const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`MagmaJump is live at http://localhost:${PORT}`));
