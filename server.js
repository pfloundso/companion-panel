const express = require('express');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cfg = require('./config.json');

const S = cfg.satellite;
const NB = cfg.buttons, NF = cfg.faders, TOTAL = NB + NF;

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static(path.join(__dirname, 'public')));

// ---- Zustand: Tasten kommen von Companion (abhängig von der Seite des Surfaces), das Layout aus layout.json ----
const keys = Array.from({ length: TOTAL }, () => ({ text: '', color: null, textColor: null, bitmap: null }));
let page = null;   // aktuelle Companion-Seite dieses Surfaces (aus LOCATION)
let online = null; // null = verbinde, true = Surface registriert, false = nicht erreichbar

// Overlay-Layout: Widgets (Button/Fader) auf einem Raster, jedes an eine Satellite-Taste gebunden
const LAYOUT_FILE = path.join(__dirname, 'layout.json');
const int = (v, min, max, d) => (Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : d);
function cleanLayout(l) {
  const cols = int(l.cols, 1, 12, 4), rows = int(l.rows, 1, 12, 4);
  const widgets = (Array.isArray(l.widgets) ? l.widgets : []).slice(0, 64).map((w) => {
    const x = int(w.x, 0, cols - 1, 0), y = int(w.y, 0, rows - 1, 0);
    return { type: w.type === 'fader' ? 'fader' : 'button', key: int(w.key, 0, TOTAL - 1, 0), x, y, w: int(w.w, 1, cols - x, 1), h: int(w.h, 1, rows - y, 1) };
  });
  return { cols, rows, widgets };
}
function defaultLayout() {
  const widgets = [];
  for (let i = 0; i < NB; i++) widgets.push({ type: 'button', key: i, x: i % cfg.columns, y: Math.floor(i / cfg.columns), w: 1, h: 1 });
  const fy = Math.ceil(NB / cfg.columns);
  for (let i = 0; i < NF; i++) widgets.push({ type: 'fader', key: NB + i, x: i % cfg.columns, y: fy, w: 1, h: 3 });
  return { cols: cfg.columns, rows: fy + 3, widgets };
}
let layout;
try { layout = cleanLayout(JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8'))); } catch (e) { layout = defaultLayout(); }

// Bitmaps nur für Tasten senden, die als Button angezeigt werden (Fader lesen nur den Text)
const needsBitmap = (k) => layout.widgets.some((w) => w.type === 'button' && w.key === k);
const pub = (k) => (needsBitmap(k) ? keys[k] : { ...keys[k], bitmap: null });
const pubKeys = () => keys.map((_, k) => pub(k));

function applyKey(k, text, color, textColor, bitmap = null) {
  keys[k] = { text, color, textColor, bitmap };
  io.emit('key', { k, ...pub(k) });
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
  socket.emit('init', { columns: cfg.columns, layout, keys: pubKeys(), online, page });
  const held = new Set(); // gedrückte Tasten dieses Browsers
  socket.on('pagestep', (d) => { if (d === 'UP' || d === 'DOWN') pageStep(d); });

  const validKey = (k) => Number.isInteger(k) && k >= 0 && k < TOTAL;
  socket.on('press', ({ k, action }) => {
    if (!validKey(k) || !['down', 'up'].includes(action)) return;
    if (action === 'down') held.add(k); else held.delete(k);
    send(`KEY-PRESS DEVICEID=${S.deviceId} KEY=${k} PRESSED=${action === 'down'}`);
  });
  socket.on('rotate', ({ k, clicks }) => {
    if (!validKey(k) || !Number.isInteger(clicks) || !clicks) return;
    const dir = clicks > 0 ? 1 : -1;
    const multi = ['1', 'true'].includes(String(caps.ROTARY_AMOUNT)); // Companion >= 5.1: mehrere Rasten pro Nachricht
    let left = Math.min(Math.abs(clicks), 1000); // in Blöcken senden, damit bei großen Sprüngen keine Rasten verloren gehen
    while (left > 0) {
      const n = multi ? Math.min(left, 50) : 1;
      send(`KEY-ROTATE DEVICEID=${S.deviceId} KEY=${k} DIRECTION=${dir * n}`);
      left -= n;
    }
  });
  socket.on('layout:save', (l) => {
    layout = cleanLayout(l || {});
    fs.writeFile(LAYOUT_FILE, JSON.stringify(layout, null, 2), (e) => e && console.error('layout.json:', e.message));
    io.emit('layout', { layout, keys: pubKeys() });
  });
  socket.on('disconnect', () => { for (const k of held) send(`KEY-PRESS DEVICEID=${S.deviceId} KEY=${k} PRESSED=false`); held.clear(); });
});

connect();
srv.listen(cfg.port, '0.0.0.0', () => console.log(`Panel läuft auf http://localhost:${cfg.port}`));
