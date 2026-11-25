const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const { Server } = require('socket.io');
const cfg = require('./config.json');

const S = cfg.satellite;
const NB = cfg.buttons, NF = cfg.faders, TOTAL = NB + NF;

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static(path.join(__dirname, 'public')));

// ---- Zustand (kommt komplett von Companion, abhängig von der Seite des Surfaces) ----
const keys = Array.from({ length: NB }, () => ({ text: '', color: null, textColor: null, bitmap: null }));
const off = () => ({ label: '', min: 0, max: 100, step: 1, active: false });
let meta = Array.from({ length: NF }, off);
const values = Array(NF).fill(null);
let page = null;   // aktuelle Companion-Seite dieses Surfaces (aus LOCATION)
let online = null; // null = verbinde, true = Surface registriert, false = nicht erreichbar

const num = (x) => { const n = parseFloat(String(x).trim().replace(',', '.')); return Number.isNaN(n) ? null : n; };

// Text des Encoder-Buttons: Label|min|max|step|wert   z. B.  Vox|-90|10|0.5|$(x32:ch01_level)
function parseFader(text, i) {
  const p = text.split('|').map((s) => s.trim());
  if (p.length < 5) return null;
  const min = num(p[1]), max = num(p[2]);
  if (min === null || max === null || max <= min) return null;
  let value = num(p[4]);
  if (value === null && /∞|oo|inf/i.test(p[4])) value = min; // "-oo" = ganz unten
  return { meta: { label: p[0] || `Fader ${i + 1}`, min, max, step: num(p[3]) || (max - min) / 100, active: true }, value };
}

function applyKey(k, text, color, textColor, bitmap = null) {
  if (k < NB) {
    keys[k] = { text, color, textColor, bitmap };
    io.emit('key', { i: k, ...keys[k] });
    return;
  }
  const i = k - NB;
  const parsed = parseFader(text, i);
  const nextMeta = parsed ? parsed.meta : off();
  const nextVal = parsed ? parsed.value : null;
  if (JSON.stringify(nextMeta) !== JSON.stringify(meta[i])) { meta[i] = nextMeta; io.emit('meta', meta); }
  if (nextVal !== values[i]) { values[i] = nextVal; io.emit('value', { i, value: nextVal }); }
}

// ---- Satellite-Verbindung zu Companion ----
let sock = null, pingTimer = null, buf = '', caps = {};
const send = (line) => { if (sock && !sock.destroyed) sock.write(line + '\n'); };
const setOnline = (v) => { if (v !== online) { online = v; io.emit('status', v); } };
const txt = (b64) => (b64 ? Buffer.from(b64, 'base64').toString('utf8').replace(/\\n/g, '\n') : '');

function parseLine(line) {
  const sp = line.indexOf(' ');
  const cmd = sp < 0 ? line : line.slice(0, sp);
  const rest = sp < 0 ? '' : line.slice(sp + 1);
  const args = {};
  for (const m of rest.matchAll(/(\w+)=("([^"]*)"|\S*)/g)) args[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return { cmd, rest, args };
}

function handle(line) {
  const { cmd, rest, args } = parseLine(line);
  switch (cmd) {
    case 'BEGIN':
      console.log(`Companion ${args.CompanionVersion}, Satellite-API ${args.ApiVersion}`);
      send(`ADD-DEVICE DEVICEID=${S.deviceId} PRODUCT_NAME="${S.productName}" KEYS_TOTAL=${TOTAL} KEYS_PER_ROW=${cfg.columns} BITMAPS=${cfg.bitmapSize || 72} COLORS=hex TEXT=true BRIGHTNESS=false`);
      break;
    case 'CAPS': caps = args; break;
    case 'PING': send(`PONG ${rest}`); break;
    case 'ADD-DEVICE':
      if (rest.startsWith('OK')) setOnline(true); else { console.error('ADD-DEVICE:', rest); setOnline(false); }
      break;
    case 'KEY-STATE': {
      let k = Number(args.KEY);
      if (String(args.KEY).includes('/')) { const [r, c] = args.KEY.split('/').map(Number); k = r * cfg.columns + c; }
      if (Number.isInteger(k) && k >= 0 && k < TOTAL) applyKey(k, txt(args.TEXT), args.COLOR || null, args.TEXTCOLOR || null, args.BITMAP || null);
      if (args.LOCATION) { // page/row/col, ab Satellite-API 1.10
        const pg = parseInt(args.LOCATION.split('/')[0], 10);
        if (Number.isInteger(pg) && pg !== page) { page = pg; io.emit('page', page); }
      }
      break;
    }
    case 'KEYS-CLEAR':
      for (let k = 0; k < TOTAL; k++) applyKey(k, '', null, null);
      break;
    case 'ERROR': console.error('Satellite:', rest); break;
  }
}

function connect() {
  buf = ''; caps = {};
  sock = net.connect(S.port, S.host);
  sock.setEncoding('utf8');
  sock.on('connect', () => { pingTimer = setInterval(() => send('PING x'), 2000); });
  sock.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).replace(/\r$/, '');
      buf = buf.slice(n + 1);
      if (line) handle(line);
    }
  });
  sock.on('error', (e) => console.error('Satellite:', e.message));
  sock.on('close', () => { clearInterval(pingTimer); setOnline(false); setTimeout(connect, 2000); });
}

// ---- Seitenwechsel über die Companion-TCP-API (Satellite kennt keinen Seitenbefehl) ----
function pageStep(dir) {
  const id = (cfg.api && cfg.api.surfaceId) || S.deviceId;
  const c = net.connect((cfg.api && cfg.api.port) || 16759, S.host);
  c.on('error', (e) => console.error('Seitenwechsel:', e.message));
  c.on('connect', () => c.end(`SURFACE ${id} PAGE-${dir}\n`));
}

// ---- Browser ----
io.on('connection', (socket) => {
  socket.emit('init', { columns: cfg.columns, keys, faders: meta, values, online, page });
  const held = new Set(); // gedrückte Tasten dieses Browsers
  socket.on('pagestep', (d) => { if (d === 'UP' || d === 'DOWN') pageStep(d); });

  const press = (key, action) => {
    if (action === 'down') held.add(key); else held.delete(key);
    send(`KEY-PRESS DEVICEID=${S.deviceId} KEY=${key} PRESSED=${action === 'down'}`);
  };
  socket.on('btn', ({ i, action }) => {
    if (!Number.isInteger(i) || i < 0 || i >= NB || !['down', 'up'].includes(action)) return;
    press(i, action);
  });
  socket.on('enc', ({ i, action }) => {
    if (!Number.isInteger(i) || i < 0 || i >= NF || !['down', 'up'].includes(action)) return;
    press(NB + i, action);
  });
  socket.on('rotate', ({ i, clicks }) => {
    if (!Number.isInteger(i) || i < 0 || i >= NF || !Number.isInteger(clicks) || !clicks) return;
    const key = NB + i;
    const dir = clicks > 0 ? 1 : -1;
    const multi = ['1', 'true'].includes(String(caps.ROTARY_AMOUNT)); // Companion >= 5.1: mehrere Rasten pro Nachricht
    let left = Math.min(Math.abs(clicks), 1000); // in Blöcken senden, damit bei großen Sprüngen keine Rasten verloren gehen
    while (left > 0) {
      const n = multi ? Math.min(left, 50) : 1;
      send(`KEY-ROTATE DEVICEID=${S.deviceId} KEY=${key} DIRECTION=${dir * n}`);
      left -= n;
    }
  });
  socket.on('disconnect', () => { for (const k of held) send(`KEY-PRESS DEVICEID=${S.deviceId} KEY=${k} PRESSED=false`); held.clear(); });
});

connect();
srv.listen(cfg.port, '0.0.0.0', () => console.log(`Panel läuft auf http://localhost:${cfg.port}`));
