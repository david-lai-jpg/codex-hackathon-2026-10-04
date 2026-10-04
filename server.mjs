// HTTP server: the page, the run API with SSE, the transcribe proxy, and run files.
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { RUNS, listRuns, startRun, transcribe } from './pipeline.mjs';

const PORT = Number(process.env.PORT ?? 8787);
// Localhost only: on venue Wi-Fi, anyone who can reach the port can spend the OpenAI credits.
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC = join(import.meta.dirname, 'public');
const BUSY = '抱歉！伺服器被全台關心打爆了！';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};
const live = new Map();
let lastStart = 0;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const readBody = (req, max) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) return reject(new Error('body too large'));
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

// Static files with byte ranges, so <video> can seek.
function serveFile(req, res, base, rel) {
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  const size = statSync(file).size;
  const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!m) {
    res.writeHead(200, { ...headers, 'content-length': size });
    return createReadStream(file).pipe(res);
  }
  const start = m[1] ? +m[1] : size - +m[2];
  const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start > end || start < 0) return res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
  res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}

// Sends the past events, then live ones. Closes after ready or error.
function events(req, res, id) {
  const run = live.get(id);
  const saved = join(RUNS, id, 'events.json');
  if (!run && (!/^[\w-]+$/.test(id) || !existsSync(saved))) return json(res, 404, { error: 'no such run' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (!run) {
    JSON.parse(readFileSync(saved, 'utf8')).forEach(send);
    return res.end();
  }
  run.events.forEach(send);
  if (run.done) return res.end();
  const onEvent = (e) => {
    send(e);
    if (run.done) {
      run.bus.off('event', onEvent);
      res.end();
    }
  };
  run.bus.on('event', onEvent);
  req.on('close', () => run.bus.off('event', onEvent));
}

async function createRun(req, res) {
  let tip;
  try {
    tip = JSON.parse(await readBody(req, 10_000)).tip?.trim();
  } catch {
    return json(res, 400, { error: 'bad json' });
  }
  if (!tip || tip.length > 200) return json(res, 400, { error: 'tip must be 1-200 characters' });
  // Tier 1: 5 images per minute. One run at a time, at least 60 s apart.
  const busy = [...live.values()].some((r) => !r.done);
  if (busy || Date.now() - lastStart < 60_000) return json(res, 429, { error: BUSY });
  lastStart = Date.now();
  const run = startRun(tip);
  live.set(run.id, run);
  console.log(`[run] ${run.id} ${tip}`);
  json(res, 202, { id: run.id });
}

async function transcribeAudio(req, res) {
  try {
    const audio = await readBody(req, 10_000_000);
    if (!audio.length) return json(res, 400, { error: 'empty audio' });
    json(res, 200, { text: await transcribe(audio, req.headers['content-type']) });
  } catch (err) {
    console.error('[transcribe]', err.message);
    json(res, 502, { error: BUSY });
  }
}

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return json(res, 400, { error: 'bad url' });
  }
  const m = pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (req.method === 'GET' && pathname === '/api/runs') return json(res, 200, listRuns());
  if (req.method === 'POST' && pathname === '/api/runs') return createRun(req, res);
  if (req.method === 'GET' && m) return events(req, res, m[1]);
  if (req.method === 'POST' && pathname === '/api/transcribe') return transcribeAudio(req, res);
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  if (pathname.startsWith('/runs/')) return serveFile(req, res, RUNS, pathname.slice(6));
  serveFile(req, res, PUBLIC, pathname === '/' ? 'index.html' : pathname.slice(1));
}).listen(PORT, HOST, () => console.log(`芭樂動新聞 on http://${HOST}:${PORT}`));
