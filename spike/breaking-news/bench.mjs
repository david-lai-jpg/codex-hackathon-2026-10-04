// Throwaway timing benchmark for the 動新聞 pipeline. Key comes from OPENAI_API_KEY; never printed.
// Usage: node bench.mjs <quality low|medium|...> <label>
import { writeFileSync, mkdirSync } from 'node:fs';
import { compose } from './compose.mjs';
import { join } from 'node:path';

const [quality = 'low', label = `run-${quality}`] = process.argv.slice(2);
// Tier 1 allows 5 images per minute, so 5 shots is the max for one clip.
const SHOTS = Number(process.env.SHOTS ?? 5);
const INCIDENT = process.env.INCIDENT ?? '我同事偷吃了我放在公司冰箱的便當';
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error('OPENAI_API_KEY missing');
const OUT = join(import.meta.dirname, label);
mkdirSync(OUT, { recursive: true });

const t0 = performance.now();
const sec = () => +((performance.now() - t0) / 1000).toFixed(2);
const api = (path, body) =>
  fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const DEV = `You write Taiwanese tabloid TV breaking-news parody segments in Traditional Chinese (Taiwan usage).
Turn the viewer's mundane incident into an absurdly sensational national scandal.
Rules: fictional slapstick comedy; never name real people, brands, or news outlets; office-safe.
headline: at most 16 characters. ticker: 3 short sensational lines joined by "｜".
anchor_script: 110-150 characters, breathless short sentences, about 25 seconds when read aloud.
shots: exactly ${SHOTS}, in story order. scene_en: one English sentence describing the reenactment
(characters, action, setting, camera angle). No text, letters, or logos in any scene.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'ticker', 'anchor_script', 'shots'],
  properties: {
    headline: { type: 'string' },
    ticker: { type: 'string' },
    anchor_script: { type: 'string' },
    shots: {
      type: 'array',
      minItems: SHOTS,
      maxItems: SHOTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scene_en'],
        properties: { scene_en: { type: 'string' } },
      },
    },
  },
};

const STYLE = `Crude early-2010s 3D CGI news reenactment still, like a Taiwanese tabloid TV news animation:
stiff low-poly characters with exaggerated cartoon faces, plastic textures, flat game-engine lighting,
cheap set, dramatic tilted camera. No text, letters, logos, or watermarks. Scene: `;

const ANCHOR = `Breathless, over-the-top Taiwanese TV news anchor reading BREAKING NEWS in Taiwan Mandarin.
Fast, urgent, shocked, rising intonation, tiny gasps between sentences.`;

// 1. Script + storyboard
const textStart = sec();
const tr = await api('responses', {
  model: 'gpt-6-astra',
  reasoning: { effort: 'low' },
  store: false,
  instructions: DEV,
  input: INCIDENT,
  text: { format: { type: 'json_schema', name: 'breaking_news', strict: true, schema: SCHEMA } },
});
const tj = await tr.json();
if (!tr.ok) throw new Error(`text step ${tr.status}: ${JSON.stringify(tj.error)}`);
const story = JSON.parse(
  tj.output.find((o) => o.type === 'message').content.find((c) => c.type === 'output_text').text,
);
const textEnd = sec();
writeFileSync(join(OUT, 'story.json'), JSON.stringify(story, null, 2));
console.log(`text done ${textEnd}s`, story.headline);

// 2. Six frames and the anchor voice, all in parallel. No retries: a 429 is a finding.
const frame = async (shot, i) => {
  const start = sec();
  const res = await api('images/generations', {
    model: 'gpt-image-2.5-flare',
    prompt: STYLE + shot.scene_en,
    size: '1536x864',
    quality,
    output_format: 'jpeg',
    n: 1,
  });
  const ratelimit = Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('x-ratelimit')));
  const body = await res.json();
  const end = sec();
  if (!res.ok) return { i, start, end, status: res.status, error: body.error, ratelimit };
  const file = join(OUT, `frame-${i}.jpg`);
  writeFileSync(file, Buffer.from(body.data[0].b64_json, 'base64'));
  return { i, start, end, status: res.status, file, usage: body.usage, ratelimit };
};
const voice = async () => {
  const start = sec();
  const res = await api('audio/speech', {
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    input: story.anchor_script,
    instructions: ANCHOR,
    response_format: 'mp3',
  });
  if (!res.ok) return { start, end: sec(), status: res.status, error: await res.text() };
  const file = join(OUT, 'anchor.mp3');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { start, end: sec(), status: res.status, file };
};
const [images, tts] = await Promise.all([Promise.all(story.shots.map(frame)), voice()]);
const ready = sec();
const ok = images.filter((f) => f.file);
if (!ok.length || !tts.file) throw new Error(`no clip: frames ${ok.length}, tts ${tts.status} ${tts.error ?? ''}`);

// 3. Compose the clip with ffmpeg (benchmark artifact only; the app composites in the browser).
const composeStart = sec();
const { clip, seconds: audioS } = compose(OUT, story, ok.map((f) => f.file), tts.file);
const composeEnd = sec();

const ends = ok.map((f) => f.end);
const report = {
  label, quality, incident: INCIDENT,
  text: { model: 'gpt-6-astra', effort: 'low', seconds: +(textEnd - textStart).toFixed(2), usage: tj.usage },
  frames_ok: `${ok.length}/${images.length}`,
  first_frame_s: Math.min(...ends),
  last_frame_s: Math.max(...ends),
  tts_s: +(tts.end - tts.start).toFixed(2),
  app_critical_path_s: ready,
  compose_s: +(composeEnd - composeStart).toFixed(2),
  total_with_compose_s: composeEnd,
  audio_s: audioS,
  ratelimit_first_image: images[0].ratelimit,
  images: images.map(({ i, start, end, status, error, usage }) => ({ i, start, end, s: +(end - start).toFixed(2), status, error, usage })),
  clip,
};
writeFileSync(join(OUT, 'timings.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, images: report.images.map(({ i, s, status }) => `${i}:${s}s/${status}`) }, null, 2));
