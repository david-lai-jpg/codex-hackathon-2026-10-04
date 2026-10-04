// Composes a 動新聞 clip: frames with pans, anchor voice, tags, ticker, and subtitles.
// CLI (no API calls): node compose.mjs <runDir> [out.mp4]
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.slice(-800)}`);
  return r.stdout;
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Width in em: CJK and full-width characters are 1 em, others about 0.55 em.
const em = (s) => [...s].reduce((w, c) => w + (c.codePointAt(0) >= 0x2e80 ? 1 : 0.55), 0);
const fit = (text, size, max) => (em(text) * size > max ? `textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '');
const FONT = 'font-family="PingFang TC, Hiragino Sans GB, STHeiti, sans-serif" font-weight="bold"';

// Split the script at sentence ends, and long sentences at commas. Each line gets
// screen time in proportion to its length (punctuation counts as a short pause).
// ponytail: proportional timing; use transcription timestamps if lines drift from the voice.
export function subtitles(script, seconds, maxChars = 18) {
  const lines = script
    .match(/[^！？。]+[！？。]?/g)
    .flatMap((s) => (s.length > maxChars ? s.match(/[^，、]+[，、]?/g) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);
  const total = lines.reduce((n, l) => n + l.length, 0);
  let t = 0;
  return lines.map((line) => {
    const start = t;
    t += (line.length / total) * seconds;
    return { text: line.replace(/[，、。]$/, ''), start: +start.toFixed(2), end: +t.toFixed(2) };
  });
}

export function compose(dir, story, frames, audio, clip = join(dir, 'clip.mp4')) {
  const svg = (name, w, h, body) => {
    const file = join(dir, `${name}.svg`);
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ${FONT}>${body}</svg>`);
    run('rsvg-convert', [file, '-o', join(dir, `${name}.png`)]);
    return join(dir, `${name}.png`);
  };
  const overlay = svg('overlay', 1280, 720, `
    <rect x="32" y="28" width="132" height="62" fill="#d00000"/>
    <text x="98" y="74" font-size="44" fill="#fff" text-anchor="middle">獨家</text>
    <text x="182" y="72" font-size="34" fill="#ffe100" stroke="#000" stroke-width="3" paint-order="stroke">BREAKING NEWS</text>
    <rect x="1060" y="30" width="190" height="52" rx="8" fill="#000" fill-opacity="0.45"/>
    <text x="1155" y="68" font-size="32" fill="#fff" fill-opacity="0.85" text-anchor="middle">AI 惡搞</text>
    <rect x="0" y="566" width="1280" height="82" fill="#ffe100"/>
    <text x="40" y="626" font-size="52" fill="#000" ${fit(story.headline, 52, 1200)}>${esc(story.headline)}</text>
    <rect x="0" y="648" width="1280" height="72" fill="#d00000"/>`);
  const tickerText = `${story.ticker}　　　`;
  const ticker = svg('ticker', Math.ceil(em(tickerText) * 40) + 40, 72,
    `<text x="20" y="50" font-size="40" fill="#fff">${esc(tickerText)}</text>`);

  const seconds = +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]).trim();
  const subs = subtitles(story.anchor_script, seconds);
  writeFileSync(join(dir, 'subtitles.json'), JSON.stringify(subs, null, 2));
  const subPngs = subs.map((s, k) => svg(`sub-${k}`, 1280, 64,
    `<text x="640" y="48" font-size="42" fill="#fff" stroke="#000" stroke-width="8" stroke-linejoin="round"
      paint-order="stroke" text-anchor="middle" ${fit(s.text, 42, 1180)}>${esc(s.text)}</text>`));

  const n = frames.length;
  const d = Math.ceil((seconds / n) * 25);
  // Even shots push in, odd shots pan left to right.
  const shot = (k) =>
    `[${k}:v]scale=1600:900,zoompan=` +
    (k % 2 ? `z=1.2:x='(iw-iw/zoom)*on/${d}':y='(ih-ih/zoom)/2'` : `z='min(zoom+0.0015,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`) +
    `:d=${d}:s=1280x720:fps=25,setsar=1[v${k}]`;
  const graph = [
    ...frames.map((_, k) => shot(k)),
    `${frames.map((_, k) => `[v${k}]`).join('')}concat=n=${n}:v=1:a=0[base]`,
    `[base][${n}:v]overlay=0:0[o1]`,
    `[o1][${n + 1}:v]overlay=x='W-mod(t*220+W*0.6,W+w)':y=648[s0]`,
    ...subs.map((s, k) => `[s${k}][${n + 3 + k}:v]overlay=0:496:enable='gte(t,${s.start})*lt(t,${s.end})'[s${k + 1}]`),
  ].join(';');
  run('ffmpeg', [
    '-y', '-v', 'error',
    ...frames.flatMap((f) => ['-i', f]),
    '-loop', '1', '-i', overlay,
    '-loop', '1', '-framerate', '25', '-i', ticker,
    '-i', audio,
    ...subPngs.flatMap((p) => ['-loop', '1', '-i', p]),
    '-filter_complex', graph,
    '-map', `[s${subs.length}]`, '-map', `${n + 2}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-t', String(seconds), clip,
  ]);
  return { clip, seconds, subtitles: subs };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const frames = readdirSync(dir).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort().map((f) => join(dir, f));
  const story = JSON.parse(readFileSync(join(dir, 'story.json'), 'utf8'));
  const out = compose(dir, story, frames, join(dir, 'anchor.mp3'), process.argv[3] ?? join(dir, 'clip-sub.mp4'));
  console.log(out.clip, `${out.seconds}s`, `${out.subtitles.length} subtitle lines`);
}
