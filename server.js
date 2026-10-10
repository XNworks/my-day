const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const USER = process.env.APP_USER || 'admin';
const PASSWORD = process.env.APP_PASSWORD || '';
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
if (!PASSWORD) console.warn('WARNING: APP_PASSWORD is not set. Anyone who can reach this server can read your data.');

const sha = s => crypto.createHash('sha256').update(s).digest();

function authorized(req) {
  if (!PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const userOk = crypto.timingSafeEqual(sha(decoded.slice(0, i)), sha(USER));
  const passOk = crypto.timingSafeEqual(sha(decoded.slice(i + 1)), sha(PASSWORD));
  return userOk && passOk;
}

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

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="My Day"', 'Content-Type': 'text/plain' });
    return res.end('Login required');
  }

  const url = new URL(req.url, 'http://localhost');
  try {
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

server.listen(PORT, () => console.log(`My Day listening on port ${PORT}, data in ${DATA_DIR}`));
