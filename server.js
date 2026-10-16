const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const USER = process.env.APP_USER || 'admin';
const PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 365;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const COOKIE = 'myday_session';
const SESSION_MS = SESSION_DAYS * 86400000;
const MAX_BODY = 10 * 1024 * 1024;
const STATIC = new Set(['index.html', 'styles.css', 'app.js', 'manifest.json', 'sw.js', 'icon.svg']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/manifest+json',
  '.svg': 'image/svg+xml'
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// Signing key for login sessions. Persisted so a restart does not sign everyone out.
const SECRET = process.env.SESSION_SECRET || loadSecret();
function loadSecret() {
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved) return saved;
    }
  } catch {}
  const created = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(file, created, { mode: 0o600 }); } catch {}
  return created;
}

if (!PASSWORD) {
  console.warn('WARNING: APP_PASSWORD is not set — the dashboard is open to anyone who can reach this server.');
}

/* ---------- auth ---------- */

const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

// Session signing key. Mixing in the credentials means changing the username or
// password instantly invalidates every signed-in device.
const KEY = crypto.createHash('sha256').update(`${SECRET}|${USER}|${PASSWORD}`).digest();

function sign(exp) {
  return crypto.createHmac('sha256', KEY).update(String(exp)).digest('hex');
}
function makeToken() {
  const exp = Date.now() + SESSION_MS;
  return `${exp}.${sign(exp)}`;
}
function tokenValid(token) {
  if (!token) return false;
  const i = token.indexOf('.');
  if (i < 0) return false;
  const exp = Number(token.slice(0, i));
  const sig = token.slice(i + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function basicOk(req) {
  if (!PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return same(decoded.slice(0, i), USER) && same(decoded.slice(i + 1), PASSWORD);
}
function authorized(req) {
  if (!PASSWORD) return true;
  return tokenValid(cookies(req)[COOKIE]) || basicOk(req);
}
function isSecure(req) {
  return COOKIE_SECURE || req.headers['x-forwarded-proto'] === 'https';
}
function sessionCookie(req) {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
  return `${COOKIE}=${makeToken()}; ${flags}${isSecure(req) ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
const redirect = (res, to, extra = {}) => {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...extra });
  res.end();
};

/* ---------- helpers ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra });
  res.end(body);
}

/* ---------- request handling ---------- */

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }

  try {
    /* --- public endpoints (no login required) --- */
    if (url.pathname === '/healthz') {
      return send(res, 200, 'text/plain', 'ok', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/login') {
      if (req.method === 'GET') {
        const file = path.join(__dirname, 'login.html');
        if (!fs.existsSync(file)) return send(res, 500, 'text/plain', 'login.html is missing');
        return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(file), { 'Cache-Control': 'no-store' });
      }
      if (req.method === 'POST') {
        let fields;
        try {
          fields = new URLSearchParams(await readBody(req));
        } catch {
          return redirect(res, '/login?error=1');
        }
        const okUser = same(fields.get('user') || '', USER);
        const okPass = same(fields.get('password') || '', PASSWORD);
        if (!okUser || !okPass) return redirect(res, '/login?error=1');
        return redirect(res, '/', { 'Set-Cookie': sessionCookie(req) });
      }
      return send(res, 405, 'text/plain', 'Method not allowed');
    }

    if (url.pathname === '/logout') {
      return redirect(res, '/login', { 'Set-Cookie': clearCookie() });
    }

    /* --- everything below requires a session --- */
    if (!authorized(req)) {
      const wantsHtml = (req.headers.accept || '').includes('text/html');
      return wantsHtml
        ? redirect(res, '/login')
        : send(res, 401, 'application/json', '{"error":"unauthorized"}', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const body = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '{}';
      return send(res, 200, 'application/json', body, { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const data = JSON.parse(await readBody(req));
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return send(res, 400, 'text/plain', 'Invalid data');
      }
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, DATA_FILE);
      return send(res, 200, 'application/json', '{"ok":true}');
    }

    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (req.method === 'GET' && STATIC.has(name)) {
      const extra = name === 'sw.js' ? { 'Cache-Control': 'no-cache' } : {};
      return send(res, 200, TYPES[path.extname(name)], fs.readFileSync(path.join(__dirname, name)), extra);
    }

    send(res, 404, 'text/plain', 'Not found');
  } catch (err) {
    const badInput = err instanceof SyntaxError || err.message === 'too large';
    send(res, badInput ? 400 : 500, 'text/plain', badInput ? 'Bad request' : 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`My Day listening on port ${PORT}, data in ${DATA_DIR}`);
  console.log(PASSWORD ? `Login required (user "${USER}", sessions last ${SESSION_DAYS} days)` : 'No password set — login disabled');
});
