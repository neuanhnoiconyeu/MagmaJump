(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const GATE_SPACING = 40;
  const LAVA_SPEED = .35;
  const STEER_SPEED = .38;
  const screens = { home: $('homeScreen'), room: $('roomScreen'), game: $('gameScreen') };
  const palettes = ['#f17a43','#56b8bb','#db6282','#e5ae4e','#9174d2','#7eae67','#ec8859','#5793d5'];
  const state = { code: '', playerId: '', room: null, source: null, mode: 'home', player: null, lastSend: 0, lastLavaSend: 0, lastFrame: 0, camera: 0, elapsed: 0, tutorialOpen: false, keys: new Set(), touchX: null, pointerX: null, lastScore: 0, toasted: false, deathCause: '' };
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d', { alpha: false });
  let width = 0, height = 0, dpr = 1, animation = 0, toastTimer;

  function showScreen(name) {
    state.mode = name;
    Object.entries(screens).forEach(([key, el]) => el.classList.toggle('active', key === name));
    if (name === 'game') resizeCanvas();
  }
  function message(text) { const el = $('toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2300); }
  async function api(path, data) {
    const response = await fetch(`/api/${path}`, { method: data ? 'POST' : 'GET', headers: data ? { 'content-type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }
  function nameValue() { return $('username').value.trim().replace(/[<>]/g, '').slice(0, 14); }
  function setError(error) { $('formError').textContent = error || ''; }
  function startEvents() {
    if (state.source) state.source.close();
    state.source = new EventSource(`/api/events?code=${encodeURIComponent(state.code)}`);
    const handleState = e => { try { receive(JSON.parse(e.data)); } catch {} };
    state.source.onmessage = handleState;
    // Server publishes updates as the named "state" event; the initial snapshot is a default message.
    state.source.addEventListener('state', handleState);
    state.source.onerror = () => { if (state.mode !== 'home') $('lobbyHint').textContent = 'Reconnecting to the tower…'; };
  }
  function receive(room) {
    const oldStatus = state.room?.status;
    state.room = room;
    if (state.mode !== 'game') renderLobby();
    renderLeaderboard();
    if (room.status === 'playing' && state.mode !== 'game') enterGame();
    if (room.status === 'lobby' && oldStatus === 'finished') { state.player = null; showScreen('room'); renderLobby(); }
    if (room.status === 'finished' && state.mode === 'game') {
      const me = room.players.find(p => p.id === state.playerId);
      showGameOver(me, true);
    }
  }
  async function createRoom() {
    setError('');
    const name = nameValue(); if (!name) { setError('Add a callsign so your crew knows who’s who.'); $('username').focus(); return; }
    $('createBtn').disabled = true;
    try { const result = await api('rooms', { name }); state.code = result.code; state.playerId = result.playerId; state.room = null; startEvents(); showScreen('room'); }
    catch (e) { setError(e.message); } finally { $('createBtn').disabled = false; }
  }
  async function joinRoom() {
    setError('');
    const name = nameValue(), code = $('roomCode').value.trim().toUpperCase();
    if (!name) { setError('Add a callsign so your crew knows who’s who.'); $('username').focus(); return; }
    if (code.length !== 4) { setError('Room codes are four letters long.'); $('roomCode').focus(); return; }
    $('joinBtn').disabled = true;
    try { const result = await api('join', { name, code }); state.code = result.code; state.playerId = result.playerId; state.room = null; startEvents(); showScreen('room'); }
    catch (e) { setError(e.message); } finally { $('joinBtn').disabled = false; }
  }
  async function action(action, extra = {}) {
    try { await api('action', { code: state.code, playerId: state.playerId, action, ...extra }); }
    catch (e) { message(e.message); }
  }
  function renderLobby() {
    const room = state.room; if (!room) return;
    $('roomCodeLabel').textContent = room.code; $('copyCodeText').textContent = room.code;
    $('playerCount').textContent = room.players.length;
    $('playerList').innerHTML = room.players.map((p, i) => `<div class="player-row"><div class="player-avatar" style="background:${palettes[p.color] || palettes[0]}">${escapeHtml(p.name.slice(0, 1).toUpperCase())}</div><span class="player-name">${escapeHtml(p.name)}${p.id === state.playerId ? ' <span style="color:#a8b0b1">(you)</span>' : ''}</span><span class="player-tag ${p.id === room.hostId ? '' : 'ready-tag'}">${p.id === room.hostId ? 'HOST' : p.ready ? 'READY ✓' : 'JOINED'}</span></div>`).join('');
    const isHost = room.hostId === state.playerId, me = room.players.find(p => p.id === state.playerId);
    $('readyBtn').classList.toggle('hidden', isHost);
    $('readyBtn').innerHTML = `${me?.ready ? 'I’M READY' : 'READY UP'} <span>✓</span>`;
    $('startBtn').classList.toggle('hidden', !isHost);
    $('lobbyHint').textContent = isHost ? (room.players.length < 2 ? 'Invite a friend, or start a solo practice run.' : 'Crew assembled. The host can kick things off.') : 'Waiting for the host to start the climb…';
    $('roomHeading').innerHTML = room.players.length > 1 ? 'Your crew<br>is assembled.' : 'The tower<br>is waiting.';
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function renderLeaderboard() {
    const room = state.room; if (!room) return;
    $('aliveCount').textContent = `${room.players.filter(p => p.alive).length}/${room.players.length}`;
    $('leaderboardRows').innerHTML = room.players.map((p, i) => `<div class="leader-row ${p.alive ? '' : 'dead'}"><span class="rank ${i === 0 ? 'rank1' : ''}">${String(i + 1).padStart(2, '0')}</span><span>${escapeHtml(p.name)}</span><span class="score">${Math.floor(p.height)}m</span></div>`).join('');
  }
  function enterGame() {
    const room = state.room; if (!room) return;
    const me = room.players.find(p => p.id === state.playerId);
    if (!state.player || state.player.round !== room.startedAt) {
      // Spawn centered in the first gate so a fresh round never ends before a pilot can steer.
      state.player = { x: gapAt(1).x, y: 18, vy: 0, alive: true, round: room.startedAt, best: 18 };
      state.camera = 0; state.elapsed = 0; state.lastFrame = 0; state.toasted = false; state.deathCause = '';
      $('gameOverCard').classList.add('hidden');
      $('gameRoomCode').textContent = room.code;
    } else if (me && !me.alive) state.player.alive = false;
    showScreen('game');
    if (!animation) animation = requestAnimationFrame(frame);
    if (!localStorage.getItem('mj-tutorial-seen')) { $('tutorial').classList.remove('hidden'); state.tutorialOpen = true; }
    renderLeaderboard();
  }
  function beginPlaying() { state.tutorialOpen = false; $('tutorial').classList.add('hidden'); localStorage.setItem('mj-tutorial-seen', '1'); flap(); }
  function flap() { if (state.player?.alive && !state.tutorialOpen && $('gameOverCard').classList.contains('hidden')) state.player.vy = 80; }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function random(seed) { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let x = t; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
  function gapAt(floor) { const seed = (state.room?.seed || 17) ^ Math.imul(floor, 7919); const r = random(seed); return { x: .28 + r() * .44, size: .31 + r() * .04 }; }
  function roundRect(x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function drawTower(camera) {
    const block = 26, top = height * .5 - (state.player?.y || 18) * 7 + camera;
    // Brick walls continue upward so the climb reads as one shared, endless tower.
    roundRect(0, 0, width, height, '#5c94fc');
    const wall = Math.min(53, width * .115), offset = Math.floor((camera * 7) % (block * 2));
    for (let side = 0; side < 2; side++) {
      const x0 = side ? width - wall : 0;
      roundRect(x0, 0, wall, height, '#bc4c20');
      for (let y = -block * 2; y < height + block; y += block) {
        const row = Math.floor((camera * 7 - y) / block), shift = row % 2 ? block / 2 : 0;
        roundRect(x0 + (side ? 0 : 0) + shift % 12, y + offset, wall, 2, '#ed8050');
        for (let x = x0 + ((row % 2) ? -8 : 7); x < x0 + wall; x += 23) roundRect(x, y + offset, 2, block, '#a74422');
      }
      roundRect(side ? x0 : x0 + wall - 5, 0, 5, height, '#963f24');
    }
    // Distant sparkle pixels.
    for (let i = 0; i < 10; i++) { const seed = i * 83 + 7; const x = 65 + (seed * 47 % Math.max(70, width - 130)); const y = (seed * 73 - camera * 3) % height; roundRect(x, (y + height) % height, 3, 3, i % 3 ? '#dce9ff' : '#ffd47a'); }
    // Tower floor gates: gap placement is derived from a shared room seed.
    const p = state.player, baseFloor = Math.max(1, Math.floor((p.y - height / 14) / GATE_SPACING) - 1), endFloor = Math.ceil((p.y + height / 14) / GATE_SPACING) + 2;
    for (let f = Math.max(1, baseFloor); f <= endFloor; f++) {
      const worldY = f * GATE_SPACING, sy = height / 2 - (worldY - p.y) * 7;
      if (sy < -18 || sy > height + 18) continue;
      const gap = gapAt(f), gateW = gap.size * (width - wall * 2), gx = wall + gap.x * (width - wall * 2) - gateW / 2;
      const barH = 10;
      roundRect(wall, sy, Math.max(0, gx - wall), barH, '#4a5962'); roundRect(Math.max(wall, gx + gateW), sy, Math.max(0, width - wall - (gx + gateW)), barH, '#4a5962');
      roundRect(wall, sy, Math.max(0, gx - wall), 3, '#a1b0ac'); roundRect(Math.max(wall, gx + gateW), sy, Math.max(0, width - wall - (gx + gateW)), 3, '#a1b0ac');
      for (let sx = wall + 7; sx < gx - 4; sx += 17) { ctx.fillStyle = '#d9e0d6'; ctx.beginPath(); ctx.moveTo(sx, sy + barH); ctx.lineTo(sx + 5, sy + barH); ctx.lineTo(sx + 2.5, sy + 2); ctx.fill(); }
      for (let sx = gx + gateW + 5; sx < width - wall - 4; sx += 17) { ctx.fillStyle = '#d9e0d6'; ctx.beginPath(); ctx.moveTo(sx, sy + barH); ctx.lineTo(sx + 5, sy + barH); ctx.lineTo(sx + 2.5, sy + 2); ctx.fill(); }
    }
    return { wall, top };
  }
  function drawLava(camera, wall) {
    const lava = Math.max(state.room?.lava || 0, 5 + state.elapsed * LAVA_SPEED), p = state.player;
    const y = height / 2 - (lava - p.y) * 7;
    const wave = Math.sin(state.elapsed * 4) * 4 + Math.sin(state.elapsed * 2.4) * 3;
    if (y < height + 20) {
      const topY = Math.max(-20, y + wave);
      roundRect(wall, topY, width - wall * 2, height - topY + 2, '#fc5c00');
      roundRect(wall, topY, width - wall * 2, 8, '#ffbb3f'); roundRect(wall, topY + 8, width - wall * 2, 4, '#ff8534');
      for (let i = 0; i < Math.ceil(width / 37); i++) {
        const x = (i * 37 + (state.elapsed * 28) % 37) % width;
        roundRect(x, topY + 17 + Math.sin(state.elapsed * 3 + i) * 5, 9, 3, '#ff9829');
      }
    }
    return lava;
  }
  function drawPlayers(wall) {
    const p = state.player, room = state.room; if (!p || !room) return;
    for (const other of room.players) {
      if (other.id === state.playerId || !other.alive) continue;
      // Teammate ghosts share their live altitude and occupy stable lanes.
      const x = wall + other.x * (width - wall * 2);
      const y = height / 2 - ((other.altitude ?? other.height) - p.y) * 7;
      if (y < -25 || y > height + 25) continue;
      drawSprite(x, y, palettes[other.color] || palettes[0], .55);
      ctx.fillStyle = '#fff'; ctx.font = '9px "DM Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText(other.name, x, y - 18);
    }
  }
  function drawSprite(x, y, color, scale) {
    const s = 7 * scale;
    roundRect(x - 10 * scale + 2, y + 8 * scale, 20 * scale, 4 * scale, '#283d5b88');
    roundRect(x - 8 * scale, y - 8 * scale, 16 * scale, 16 * scale, color);
    roundRect(x - 8 * scale, y - 12 * scale, 16 * scale, 5 * scale, '#2c415b');
    roundRect(x - 4 * scale, y - 5 * scale, 3 * scale, 3 * scale, '#fff4d7');
    roundRect(x + 3 * scale, y - 5 * scale, 3 * scale, 3 * scale, '#fff4d7');
    roundRect(x - 8 * scale, y + 8 * scale, 6 * scale, 4 * scale, '#273a55'); roundRect(x + 2 * scale, y + 8 * scale, 6 * scale, 4 * scale, '#273a55');
    // Tiny cape pixel.
    roundRect(x - 13 * scale, y - 2 * scale, 5 * scale, 8 * scale, '#f4be52');
  }
  function collideGate(playerY) {
    const p = state.player, wall = Math.min(53, width * .115);
    const innerWidth = width - wall * 2, playerX = wall + p.x * innerWidth;
    const playerLeft = playerX - 13, playerRight = playerX + 8;
    const playerTop = height / 2 - 12, playerBottom = height / 2 + 12;
    const first = Math.max(1, Math.floor((playerY - 5) / GATE_SPACING));
    const last = Math.ceil((playerY + 5) / GATE_SPACING);
    for (let floor = first; floor <= last; floor++) {
      const gap = gapAt(floor), gateWidth = gap.size * innerWidth;
      const gateLeft = wall + gap.x * innerWidth - gateWidth / 2;
      const gateRight = gateLeft + gateWidth;
      const gateY = height / 2 - (floor * GATE_SPACING - playerY) * 7;
      if (playerBottom <= gateY || playerTop >= gateY + 10) continue;
      const touchesLeft = playerRight > wall && playerLeft < gateLeft;
      const touchesRight = playerRight > gateRight && playerLeft < width - wall;
      if (touchesLeft || touchesRight) {
        return gateY > height / 2 ? floor * GATE_SPACING + 12 / 7 : floor * GATE_SPACING - 22 / 7;
      }
    }
    return null;
  }
  function frame(now) {
    animation = requestAnimationFrame(frame);
    if (state.mode !== 'game' || !width || !state.player) return;
    const dt = state.lastFrame ? Math.min(.035, (now - state.lastFrame) / 1000) : 0; state.lastFrame = now;
    const countdownMs = (state.room?.startedAt || 0) - Date.now();
    $('roundCountdown').classList.toggle('hidden', countdownMs <= 0);
    if (countdownMs > 0) $('countdownValue').textContent = String(Math.ceil(countdownMs / 1000));
    if (state.player.alive && countdownMs <= 0 && !state.tutorialOpen && $('gameOverCard').classList.contains('hidden')) {
      state.elapsed = Math.max(0, (Date.now() - (state.room?.startedAt || Date.now())) / 1000);
      const p = state.player;
      const steering = (state.keys.has('ArrowLeft') || state.keys.has('a') ? -1 : 0) + (state.keys.has('ArrowRight') || state.keys.has('d') ? 1 : 0);
      p.x = Math.max(.055, Math.min(.945, p.x + steering * dt * STEER_SPEED));
      const gravity = p.vy > 0 ? 360 : 90;
      p.vy = Math.max(-40, p.vy - gravity * dt);
      p.y += p.vy * dt;
      const worldLava = Math.max(state.room?.lava || 0, 5 + state.elapsed * LAVA_SPEED);
      const visibleFloor = state.camera / 7 + 18 - height / 14;
      const gateContact = collideGate(p.y);
      const lavaContact = p.y <= worldLava;
      const viewportContact = p.y < visibleFloor;
      if (gateContact !== null || lavaContact || viewportContact) {
        if (gateContact !== null) p.y = gateContact;
        else if (lavaContact) p.y = worldLava;
        else p.y = visibleFloor;
        state.deathCause = gateContact !== null ? 'gate' : lavaContact ? 'lava' : 'fall';
        p.vy = 0;
        p.alive = false; state.toasted = true;
        action('update', { height: p.best, altitude: p.y, x: p.x, alive: false });
        showGameOver({ ...p, height: p.best }, false);
      }
      p.best = Math.max(p.best, p.y);
      state.camera = Math.max(state.camera, (p.y - 18) * 7);
      $('heightValue').textContent = String(Math.floor(p.best)).padStart(3, '0');
      if (now - state.lastSend > 160) { state.lastSend = now; action('update', { height: p.best, altitude: p.y, x: p.x, alive: p.alive }); }
      if (now - state.lastLavaSend > 650 && state.room?.hostId === state.playerId) { state.lastLavaSend = now; action('lava', { height: worldLava }); }
    }
    const p = state.player, camera = state.camera;
    drawTower(camera); const wall = Math.min(53, width * .115); drawPlayers(wall); drawLava(camera, wall);
    drawSprite(wall + p.x * (width - wall * 2), height / 2, palettes[state.room?.players.find(x => x.id === state.playerId)?.color || 0], 1);
  }
  function showGameOver(me, finished) {
    const room = state.room, player = state.player;
    if (!player || !me) return;
    finished = finished || room?.status === 'finished';
    state.player.alive = false;
    $('finalHeight').textContent = `${String(Math.floor(player.best || me.height || 0)).padStart(3, '0')} m`;
    $('overKicker').textContent = finished ? 'ROUND COMPLETE' : 'FLIGHT LOG';
    const ranked = [...(room?.players || [])].sort((a,b) => b.height - a.height);
    const rank = ranked.findIndex(p => p.id === state.playerId) + 1;
    const winner = room?.players.find(p => p.id === room.winnerId);
    $('overTitle').textContent = finished ? (winner?.id === state.playerId ? 'YOU WIN!' : `${winner?.name || 'PILOT'} WINS`) : 'TOASTED.';
    const causeCopy = state.deathCause === 'gate' ? 'You hit a tower gate.' : state.deathCause === 'lava' ? 'The lava caught you.' : state.deathCause === 'fall' ? 'You fell out of the tower.' : '';
    $('overCopy').textContent = causeCopy || (finished ? 'That was a close one. Run it back?' : 'Keep your head up. Literally.');
    $('resultRank').textContent = `${rank}${rank === 1 ? 'ST' : rank === 2 ? 'ND' : rank === 3 ? 'RD' : 'TH'} PLACE${winner && finished ? ` · ${winner.name} made it highest` : ''}`;
    $('gameOverCard').classList.remove('hidden');
  }
  function handleDown(e) {
    if (e.target.closest('button') || e.target.closest('.tutorial-card') || e.target.closest('.game-over-card')) return;
    e.preventDefault(); state.pointerX = e.clientX; state.touchX = e.clientX;
    const rect = canvas.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width * .35) state.keys.add('ArrowLeft'); else if (e.clientX > rect.left + rect.width * .65) state.keys.add('ArrowRight');
    flap();
  }
  function handleMove(e) {
    if (state.touchX === null) return;
    const delta = e.clientX - state.touchX; if (Math.abs(delta) > 13) { if (delta < 0) { state.keys.add('ArrowLeft'); state.keys.delete('ArrowRight'); } else { state.keys.add('ArrowRight'); state.keys.delete('ArrowLeft'); } }
    state.touchX = e.clientX;
  }
  function handleUp() { state.touchX = null; state.keys.delete('ArrowLeft'); state.keys.delete('ArrowRight'); }
  async function leaveRoom() {
    if (state.code && state.playerId) { try { await api('leave', { code: state.code, playerId: state.playerId }); } catch {} }
    state.source?.close(); state.source = null; state.code = ''; state.playerId = ''; state.room = null; state.player = null; state.keys.clear(); showScreen('home');
  }

  $('createBtn').addEventListener('click', createRoom); $('joinBtn').addEventListener('click', joinRoom);
  $('roomCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  $('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); }); $('username').addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
  $('startBtn').addEventListener('click', () => action('start')); $('readyBtn').addEventListener('click', () => action('ready'));
  $('copyCode').addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.code); $('copyLabel').textContent = 'COPIED'; setTimeout(() => $('copyLabel').textContent = 'COPY', 1600); } catch { message(`Room code: ${state.code}`); } });
  $('leaveBtn').addEventListener('click', leaveRoom); $('gameLeave').addEventListener('click', leaveRoom);
  $('gotIt').addEventListener('click', beginPlaying);
  $('backLobby').addEventListener('click', async () => { if (state.room?.hostId === state.playerId) await action('again'); state.player = null; $('gameOverCard').classList.add('hidden'); showScreen('room'); });
  canvas.addEventListener('pointerdown', handleDown, { passive: false }); canvas.addEventListener('pointermove', handleMove, { passive: false }); window.addEventListener('pointerup', handleUp);
  window.addEventListener('keydown', e => { const key = e.key === ' ' ? 'Space' : e.key; if (['Space','ArrowUp','ArrowLeft','ArrowRight','a','d','A','D'].includes(key) && state.mode === 'game') { e.preventDefault(); const normal = key.toLowerCase() === 'a' ? 'a' : key.toLowerCase() === 'd' ? 'd' : key; state.keys.add(normal); if (!e.repeat && (key === 'Space' || key === 'ArrowUp')) flap(); } });
  window.addEventListener('keyup', e => { const key = e.key === ' ' ? 'Space' : e.key; state.keys.delete(key); state.keys.delete(key.toLowerCase()); });
  window.addEventListener('resize', resizeCanvas); window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 120));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.code) api('state?code=' + encodeURIComponent(state.code)).then(receive).catch(() => {}); });
  $('gameCanvas').addEventListener('contextmenu', e => e.preventDefault());
  // Use the same rematch action as the host-facing button, without restarting connected clients in place.
})();
