// 動新聞 pipeline: tip -> script -> 5 frames + anchor voice (parallel) -> MP4 via compose.mjs.
// Every step is an event {t, type, data}; a run's events are also saved to runs/<id>/events.json.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

export const RUNS = join(import.meta.dirname, 'runs');
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error('OPENAI_API_KEY missing');
// Tier 1 allows 5 images per minute, so 5 shots is the max for one clip.
const SHOTS = 5;

const DEV = `You write Taiwanese tabloid TV breaking-news parody segments in Traditional Chinese (Taiwan usage).
Turn the viewer's mundane incident into an absurdly sensational national scandal.
Rules: fictional slapstick comedy; never name real people, brands, or news outlets; office-safe.
headline: at most 16 characters. ticker: 3 short sensational lines joined by "｜".
anchor_script: 110-150 characters, breathless short sentences, about 25 seconds when read aloud.
cast: one English sentence that fixes the look of every recurring character (age, gender, hair, clothes),
so every shot draws them the same.
shots: exactly ${SHOTS}, in story order. caption_zh: Traditional Chinese, at most 12 characters, what happens.
scene_en: one English sentence describing the reenactment (characters, action, setting, camera angle).
No text, letters, or logos in any scene.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'ticker', 'anchor_script', 'cast', 'shots'],
  properties: {
    headline: { type: 'string' },
    ticker: { type: 'string' },
    anchor_script: { type: 'string' },
    cast: { type: 'string' },
    shots: {
      type: 'array',
      minItems: SHOTS,
      maxItems: SHOTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption_zh', 'scene_en'],
        properties: { caption_zh: { type: 'string' }, scene_en: { type: 'string' } },
      },
    },
  },
};

const STYLE = `Crude early-2010s 3D CGI news reenactment still, like a Taiwanese tabloid TV news animation:
stiff low-poly characters with exaggerated cartoon faces, plastic textures, flat game-engine lighting,
cheap set, dramatic tilted camera. No text, letters, logos, or watermarks.`;

const ANCHOR = `Breathless, over-the-top Taiwanese TV news anchor reading BREAKING NEWS in Taiwan Mandarin.
Fast, urgent, shocked, rising intonation, tiny gasps between sentences.`;

export function openai(path, body) {
  console.log(`[openai] ${path}`);
  const form = body instanceof FormData;
  return fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form ? body : JSON.stringify(body),
  });
}

// OpenAI error text names the organization; it ends up on screen and in events.json, so drop the id.
const scrub = (text = '') => text.replace(/org-[A-Za-z0-9]+/g, 'org-…');
const fail = async (step, res) => new Error(`${step} ${res.status}: ${scrub((await res.text()).slice(0, 300))}`);

export function startRun(tip) {
  const id = `${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(RUNS, id);
  mkdirSync(dir, { recursive: true });
  const run = { id, events: [], bus: new EventEmitter(), done: false };
  const t0 = performance.now();
  const sec = () => +((performance.now() - t0) / 1000).toFixed(2);
  const emit = (type, data = {}) => {
    if (run.done) return;
    const e = { t: sec(), type, data };
    run.events.push(e);
    run.done = type === 'ready' || type === 'error';
    writeFileSync(join(dir, 'events.json'), JSON.stringify(run.events, null, 1));
    run.bus.emit('event', e);
  };
  emit('tip', { text: tip, created: new Date().toISOString() });
  produce(id, dir, tip, emit, sec).catch((err) => emit('error', { message: err.message }));
  return run;
}

async function produce(id, dir, tip, emit, sec) {
  const url = (file) => `/runs/${id}/${file}`;
  const tr = await openai('responses', {
    model: 'gpt-6-astra',
    reasoning: { effort: 'low' },
    store: false,
    instructions: DEV,
    input: tip,
    text: { format: { type: 'json_schema', name: 'breaking_news', strict: true, schema: SCHEMA } },
  });
  if (!tr.ok) throw await fail('script', tr);
  const tj = await tr.json();
  const story = JSON.parse(tj.output.find((o) => o.type === 'message').content.find((c) => c.type === 'output_text').text);
  writeFileSync(join(dir, 'story.json'), JSON.stringify(story, null, 2));
  emit('script', story);

  // A failed frame is not fatal: the clip uses the frames that landed.
  const frame = async (shot, i) => {
    emit('frame_start', { i });
    const res = await openai('images/generations', {
      model: 'gpt-image-2.5-flare',
      prompt: `${STYLE}\nCast (draw them identically in every shot): ${story.cast}\nScene: ${shot.scene_en}`,
      size: '1536x864',
      quality: 'low',
      output_format: 'jpeg',
      n: 1,
    });
    const body = await res.json();
    if (!res.ok) return emit('frame_error', { i, status: res.status, message: scrub(body.error?.message) });
    writeFileSync(join(dir, `frame-${i}.jpg`), Buffer.from(body.data[0].b64_json, 'base64'));
    emit('frame', { i, url: url(`frame-${i}.jpg`) });
  };
  const voice = async () => {
    const res = await openai('audio/speech', {
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      input: story.anchor_script,
      instructions: ANCHOR,
      response_format: 'mp3',
    });
    if (!res.ok) throw await fail('voice', res);
    writeFileSync(join(dir, 'anchor.mp3'), Buffer.from(await res.arrayBuffer()));
    emit('voice', { url: url('anchor.mp3') });
  };
  await Promise.all([...story.shots.map(frame), voice()]);
  if (!readdirSync(dir).some((f) => /^frame-\d+\.jpg$/.test(f))) throw new Error('no frames landed');

  emit('clip_start');
  const seconds = await render(dir);
  emit('clip', { url: url('clip.mp4'), seconds });
  emit('ready', { total_s: sec() });
}

// compose.mjs blocks while ffmpeg runs, so it gets its own process to keep the server responsive.
function render(dir) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(import.meta.dirname, 'compose.mjs'), dir, join(dir, 'clip.mp4')]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => {
      const m = out.match(/ ([\d.]+)s /);
      if (code === 0 && m) resolve(+m[1]);
      else reject(new Error(`render failed: ${out.slice(-300)}`));
    });
  });
}

export function listRuns() {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS).sort().reverse().flatMap((id) => {
    try {
      const events = JSON.parse(readFileSync(join(RUNS, id, 'events.json'), 'utf8'));
      const ready = events.find((e) => e.type === 'ready');
      if (!ready) return [];
      const script = events.find((e) => e.type === 'script');
      return [{ id, headline: script.data.headline, created: events[0].data.created, total_s: ready.data.total_s }];
    } catch {
      return [];
    }
  });
}

const EXT = { 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };

export async function transcribe(audio, type) {
  const mime = (type ?? 'audio/webm').split(';')[0];
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'zh');
  form.append('prompt', '以下是台灣繁體中文的爆料。');
  form.append('file', new Blob([audio], { type: mime }), `tip.${EXT[mime] ?? 'webm'}`);
  const res = await openai('audio/transcriptions', form);
  if (!res.ok) throw await fail('transcribe', res);
  return (await res.json()).text.replace(/,/g, '，');
}
