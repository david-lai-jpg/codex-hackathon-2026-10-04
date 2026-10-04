// 60-second demo video: cold open -> twist -> 靠北 -> live run (fast-forward) -> payoff -> close.
// The first run makes 2 live runs and 2 voice clips and records the control room into video/raw/.
// Later runs reuse video/raw/ and only re-cut. Delete video/raw/ to capture again.
// Usage: node video/make.mjs [facecam.mp4]   (the face cam replaces the 靠北 card)   -> video/demo.mp4
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openai } from '../pipeline.mjs';

const ROOT = join(import.meta.dirname, '..');
const RAW = join(import.meta.dirname, 'raw');
const OUT = join(import.meta.dirname, 'demo.mp4');
const PORT = 8791;
const URL = `http://127.0.0.1:${PORT}`;

const COLD_TIP = '一個工程師週日不睡覺，在黑客松五小時做出一整間新聞台';
const TIP = '我剛剛在國道上，看到一個三寶阿嬤騎機車逆向衝上高速公路！';
const COPY = {
  pain: '你的靠北，沒人在乎。',
  tagline: '你的靠北，全國關心。',
  vote: '不投芭樂動新聞？下一則頭條就是你！',
};
// Segment lengths in seconds; they add up to 60.
const LEN = { cold: 7, twist: 5, pain: 8, live: 18, payoff: 14, close: 8 };

const FONT = 'font-family="PingFang TC, Heiti TC, sans-serif" font-weight="bold"';
const ENCODE = ['-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '160k'];

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args.map(String), { encoding: 'utf8', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).slice(-800)}`);
  return r.stdout;
};
const ffmpeg = (args) => run('ffmpeg', ['-y', '-v', 'error', ...args]);
const duration = (file) => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const events = (id) => JSON.parse(readFileSync(join(ROOT, 'runs', id, 'events.json'), 'utf8'));

// ---- capture: voices, 2 live runs, control-room recording ----

async function tts(name, text, voice, instructions) {
  const file = join(RAW, `${name}.wav`);
  const textFile = join(RAW, `${name}.txt`);
  if (existsSync(file) && existsSync(textFile) && readFileSync(textFile, 'utf8') === text) return file;
  const res = await openai('audio/speech', { model: 'gpt-4o-mini-tts', voice, input: text, instructions, response_format: 'wav' });
  if (!res.ok) throw new Error(`tts ${res.status}: ${(await res.text()).slice(0, 300)}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  writeFileSync(textFile, text);
  return file;
}

const pw = (...args) => run('playwright-cli', ['-s=video', ...args]);
const evalPage = (fn) => (pw('eval', fn).split('\n')[1] ?? '').replace(/^"|"$/g, '');
async function waitPage(fn, seconds) {
  for (let i = 0; i < seconds * 4; i++) {
    if (evalPage(fn) === '1') return;
    await sleep(250);
  }
  throw new Error(`page never got to: ${fn}`);
}

async function waitRun(id) {
  for (let i = 0; i < 180; i++) {
    const last = existsSync(join(ROOT, 'runs', id, 'events.json')) && events(id).at(-1);
    if (last?.type === 'ready') return;
    if (last?.type === 'error') throw new Error(`run ${id}: ${last.data.message}`);
    await sleep(1000);
  }
  throw new Error(`run ${id} timed out`);
}

async function capture(tipWav) {
  const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !(await fetch(`${URL}/api/runs`).catch(() => null))?.ok; i++) await sleep(100);

    // Cold open: the news about this hackathon, made through the API.
    const coldStart = Date.now();
    const { id: runA } = await (await fetch(`${URL}/api/runs`, { method: 'POST', body: JSON.stringify({ tip: COLD_TIP }) })).json();
    console.log(`[capture] cold-open run ${runA}`);
    await waitRun(runA);

    const heard = await (await fetch(`${URL}/api/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: readFileSync(tipWav) })).json();
    console.log(`[capture] whisper hears the tip as: ${heard.text}`);

    // The server allows one run start per 60 s (image rate limit).
    await sleep(Math.max(0, 62_000 - (Date.now() - coldStart)));

    const fakeMic = join(RAW, 'fake-mic.js');
    writeFileSync(fakeMic, readFileSync(join(ROOT, 'e2e/fake-mic.js'), 'utf8').replace('__ROOT__/e2e/fixtures/tip.wav', tipWav));
    const webm = join(RAW, 'control-room.webm');
    pw('open', '--config=e2e/mic.config.json', `${URL}/`);
    pw('video-start', webm, '--size=1920x1080', '--fps=30');
    const t0 = Date.now();
    const now = () => (Date.now() - t0) / 1000;
    pw('run-code', `--filename=${fakeMic}`);
    await sleep(1500);
    pw('mousemove', '150', '780');
    const tHold = now();
    pw('mousedown');
    await sleep(duration(tipWav) * 1000 + 700);
    pw('mouseup');
    await waitPage("() => document.querySelector('#tip').value ? '1' : '0'", 20);
    await sleep(800);
    const tClick = now();
    evalPage("() => { document.querySelector('#go').click(); return '1'; }");
    await waitPage("() => document.body.dataset.mode === 'air' ? '1' : '0'", 120);
    const tAir = now();
    await sleep(2500);
    pw('video-stop');
    pw('close');

    const runB = (await (await fetch(`${URL}/api/runs`)).json())[0].id;
    console.log(`[capture] live run ${runB}: ${events(runB)[0].data.text}`);
    return { coldTip: COLD_TIP, tip: TIP, runA, runB, tHold, tClick, tAir };
  } finally {
    try { pw('close'); } catch {}
    server.kill();
  }
}

// ---- cut ----

function png(name, body, w = 1920, h = 1080) {
  const svg = join(RAW, `${name}.svg`);
  writeFileSync(svg, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ${FONT}>${body}</svg>`);
  run('rsvg-convert', [svg, '-o', join(RAW, `${name}.png`)]);
  return join(RAW, `${name}.png`);
}
const tag = (x, y, text) =>
  `<rect x="${x}" y="${y}" width="${text.length * 56 + 48}" height="84" fill="#d00000"/>` +
  `<text x="${x + 24}" y="${y + 62}" font-size="56" fill="#fff">${esc(text)}</text>`;
const bar = (y, text, size = 72) =>
  `<rect x="0" y="${y}" width="1920" height="${size + 52}" fill="#ffe100"/>` +
  `<text x="960" y="${y + size + 8}" font-size="${size}" fill="#000" text-anchor="middle">${esc(text)}</text>`;
const seg = (name) => join(RAW, `seg-${name}.mp4`);
const scale = 'scale=1920:1080:flags=lanczos,setsar=1,fps=30';

function cut(meta, voices, facecam) {
  const clipA = join(ROOT, 'runs', meta.runA, 'clip.mp4');
  const clipB = join(ROOT, 'runs', meta.runB, 'clip.mp4');
  const totalA = Math.round(events(meta.runA).at(-1).data.total_s);
  const evB = events(meta.runB);
  const at = (type) => evB.find((e) => e.type === type).t;

  // 1. Cold open: the first seconds of the hackathon news.
  ffmpeg(['-i', clipA, '-t', LEN.cold, '-vf', scale, ...ENCODE, seg('cold')]);

  // 2. Twist: freeze frame, record scratch, reveal.
  const still = join(RAW, 'freeze.png');
  ffmpeg(['-ss', String(LEN.cold), '-i', clipA, '-frames:v', '1', '-vf', 'scale=1920:1080', still]);
  const twist = png('twist', `<rect width="1920" height="1080" fill="#000" fill-opacity="0.62"/>${tag(96, 80, '獨家揭密')}
    <text x="960" y="470" font-size="120" fill="#fff" text-anchor="middle">這則新聞，</text>
    <text x="960" y="630" font-size="120" fill="#fff" text-anchor="middle">AI ${totalA} 秒做完。</text>
    <text x="960" y="790" font-size="54" fill="#ffe100" text-anchor="middle">寫稿、畫面、主播配音、剪輯，全部 AI</text>`);
  const scratch = `aevalsrc='(0.5*sin(2*PI*(900-1800*t)*t)+0.3*(random(0)*2-1)*exp(-8*t))*lt(t,0.35)':s=48000:d=${LEN.twist}`;
  ffmpeg(['-loop', '1', '-i', still, '-loop', '1', '-i', twist, '-f', 'lavfi', '-i', scratch,
    '-filter_complex', `[0:v][1:v]overlay,${scale}[v]`, '-map', '[v]', '-map', '2:a', '-t', LEN.twist, ...ENCODE, seg('twist')]);

  // 3. 靠北: the face cam, or a card with the tip voice.
  if (facecam) {
    ffmpeg(['-i', facecam, '-t', LEN.pain, '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30',
      '-af', `apad=whole_dur=${LEN.pain}`, ...ENCODE, seg('pain')]);
  } else {
    const lines = TIP.split(/(?<=，)/);
    const quote = png('pain-quote', `<rect width="1920" height="1080" fill="#141414"/>${tag(96, 80, '爆料專線')}
      ${lines.map((l, k) => `<text x="960" y="${380 + k * 130}" font-size="92" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('')}`);
    const pain = png('pain-bar', bar(860, COPY.pain, 84));
    const hit = Math.min(duration(voices.tip) + 0.5, LEN.pain - 2);
    ffmpeg(['-loop', '1', '-i', quote, '-loop', '1', '-i', pain, '-i', voices.tip,
      '-filter_complex', `[0:v][1:v]overlay=enable='gte(t,${hit})',${scale}[v];[2:a]adelay=300:all=1,apad=whole_dur=${LEN.pain}[a]`,
      '-map', '[v]', '-map', '[a]', '-t', LEN.pain, ...ENCODE, seg('pain')]);
  }

  // 4. Live run, fast-forwarded, with a label for each model as it works.
  const from = meta.tHold - 1;
  const to = meta.tAir + 2;
  const speed = (to - from) / LEN.live;
  const out = (t) => ((t - from) / speed).toFixed(2);
  const labels = [
    ['whisper-1 聽懂你的靠北', meta.tHold, meta.tClick],
    ['gpt-6-astra 寫新聞稿', meta.tClick, meta.tClick + at('script')],
    ['gpt-image-2.5-flare ×5 同時畫 ＋ gpt-4o-mini-tts 主播配音', meta.tClick + at('script'), meta.tClick + at('clip_start')],
    ['ffmpeg 剪輯成片', meta.tClick + at('clip_start'), meta.tAir],
  ];
  const labelPngs = labels.map(([text], k) => png(`label-${k}`,
    `<rect x="0" y="0" width="${Math.round(text.length * 40 + 80)}" height="96" fill="#d00000"/>
     <text x="40" y="66" font-size="48" fill="#fff">${esc(text)}</text>`, 1920, 96));
  const badge = png('badge', `<rect x="0" y="0" width="560" height="84" rx="10" fill="#000" fill-opacity="0.75"/>
    <text x="280" y="58" font-size="44" fill="#ffe100" text-anchor="middle">${speed.toFixed(1)}× 快轉 · 實測 ${Math.round(meta.tAir - meta.tHold)} 秒</text>`, 560, 84);
  const chain = labels.map(([, a, b], k) => `[l${k}][${k + 1}:v]overlay=0:930:enable='between(t,${out(a)},${out(b)})'[l${k + 1}]`);
  const tick = `aevalsrc='0.3*sin(2*PI*1400*t)*exp(-90*mod(t,0.5))':s=48000:d=${LEN.live}`;
  ffmpeg(['-i', join(RAW, 'control-room.webm'), ...labelPngs.flatMap((p) => ['-loop', '1', '-i', p]), '-loop', '1', '-i', badge, '-f', 'lavfi', '-i', tick,
    '-filter_complex', [
      `[0:v]trim=start=${from.toFixed(2)}:end=${to.toFixed(2)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},${scale}[l0]`,
      ...chain,
      `[l${labels.length}][${labels.length + 1}:v]overlay=W-w-40:150[v]`,
    ].join(';'),
    '-map', '[v]', '-map', `${labels.length + 2}:a`, '-t', LEN.live, ...ENCODE, seg('live')]);

  // 5. Payoff: the end of the live run's clip, where the story peaks.
  const start = Math.max(0, duration(clipB) - LEN.payoff);
  ffmpeg(['-ss', start.toFixed(2), '-i', clipB, '-t', LEN.payoff, '-vf', scale, ...ENCODE, seg('payoff')]);

  // 6. Close: name, tagline, proof, and the vote threat read by the anchor.
  const totalB = Math.round(evB.at(-1).data.total_s);
  const close = png('close', `<rect width="1920" height="1080" fill="#141414"/>
    <rect x="460" y="190" width="1000" height="190" fill="#ffe100"/>${tag(400, 150, '獨家')}
    <text x="960" y="330" font-size="128" fill="#000" text-anchor="middle">芭樂動新聞</text>
    <text x="960" y="520" font-size="92" fill="#fff" text-anchor="middle">${esc(COPY.tagline)}</text>
    <text x="960" y="630" font-size="46" fill="#ffe100" text-anchor="middle">1 人 · 1 天 · 4 個 OpenAI 模型 · ${totalB} 秒一則國安危機</text>`);
  const vote = png('vote', `<rect x="0" y="820" width="1920" height="140" fill="#d00000"/>
    <text x="960" y="915" font-size="72" fill="#fff" text-anchor="middle">${esc(COPY.vote)}</text>`);
  ffmpeg(['-loop', '1', '-i', close, '-loop', '1', '-i', vote, '-i', voices.vote,
    '-filter_complex', `[0:v][1:v]overlay=enable='gte(t,2.5)',${scale}[v];[2:a]adelay=2500:all=1,apad=whole_dur=${LEN.close}[a]`,
    '-map', '[v]', '-map', '[a]', '-t', LEN.close, ...ENCODE, seg('close')]);

  const names = Object.keys(LEN);
  ffmpeg([...names.flatMap((n) => ['-i', seg(n)]),
    '-filter_complex', `${names.map((_, k) => `[${k}:v][${k}:a]`).join('')}concat=n=${names.length}:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]', ...ENCODE, '-movflags', '+faststart', OUT]);
}

mkdirSync(RAW, { recursive: true });
const voices = {
  tip: await tts('tip', TIP, 'sage', 'A young Taiwanese person telling a friend what they just saw, in Taiwan Mandarin. Shocked, outraged, fast.'),
  vote: await tts('vote', COPY.vote, 'coral', 'Breathless, over-the-top Taiwanese TV news anchor, Taiwan Mandarin. Urgent and shocked, rising intonation.'),
};
const metaFile = join(RAW, 'meta.json');
let meta = existsSync(metaFile) && JSON.parse(readFileSync(metaFile, 'utf8'));
if (!meta || meta.tip !== TIP || meta.coldTip !== COLD_TIP) {
  meta = await capture(voices.tip);
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
}
cut(meta, voices, process.argv[2]);
console.log(`${OUT} ${duration(OUT).toFixed(2)}s`);
