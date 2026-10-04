// 芭樂動新聞 page. One apply(event) drives the control room for live runs (SSE) and replays (saved events.json).
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const REPLAY_SPEED = Number(params.get('speed') ?? 3);
const BUSY_TICKER = '獨家爆料！全台震驚！ ｜ 直擊現場！畫面太誇張！ ｜ 國安危機疑雲重重！ ｜ 觀眾朋友注意！別眨眼！';
const FAKE = '震驚爆料獨家快訊國安危機全台傻眼離奇蒸發驚天內幕現場直擊不可思議';

// Fit the 1920x1080 stage to the window.
const fit = () => document.documentElement.style.setProperty('--s', Math.min(innerWidth / 1920, innerHeight / 1080));
addEventListener('resize', fit);
fit();

const starPoints = (n, ro, ri) =>
  Array.from({ length: n * 2 }, (_, k) => {
    const r = k % 2 ? ri : ro;
    const a = (Math.PI * k) / n - Math.PI / 2;
    return `${(110 + r * Math.cos(a)).toFixed(1)},${(110 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
$('.starburst polygon').setAttribute('points', starPoints(16, 107, 76));

const clock = () => ($('#clock').textContent = `CH.886 · ${new Date().toTimeString().slice(0, 5)}`);
clock();
setInterval(clock, 10_000);

const setTicker = (text) => ($('#tickerText').textContent = `${text} ｜ ${text} ｜ `);
setTicker(BUSY_TICKER);
$('#replaySpeed').textContent = `${REPLAY_SPEED}X`;

const wave = $('#wave');
for (let k = 0; k < 52; k++) {
  const bar = document.createElement('i');
  bar.style.height = `${8 + Math.round(100 * Math.abs(Math.sin(k * 0.9) * Math.cos(k * 0.37)))}px`;
  bar.style.animationDelay = `${(k % 7) * -0.07}s`;
  wave.append(bar);
}

const shake = (el) => {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
};
const sting = () => {
  const el = $('#sting');
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  setTimeout(() => el.classList.remove('go'), 1100);
};
const fmt = (s) => s.toFixed(1);

// ---- run state ----
let run = null;
let preloaded = []; // keeps preloaded frames in the image cache during a replay

const runT = () => ((performance.now() - run.start) * run.speed) / 1000;
const at = (type) => run.events.find((e) => e.type === type)?.t ?? 0;

function station(n, state, chip) {
  const el = $(`#s${n}`);
  el.dataset.state = state;
  el.querySelector('.chip').textContent = chip ?? (state === 'busy' ? '進行中' : '待命中');
}

function stop() {
  if (!run) return;
  run.stopped = true;
  run.es?.close();
  run.timers.forEach(clearTimeout);
  clearInterval(run.fake);
  if (run.clipUrl) URL.revokeObjectURL(run.clipUrl);
  $('#player').pause();
  run = null;
}

function home() {
  stop();
  preloaded = [];
  document.body.dataset.replay = '';
  setTicker(BUSY_TICKER);
  $('#errorCard').hidden = true;
  $('#loading').hidden = true;
  document.body.dataset.mode = 'idle';
}

function begin({ id, speed, clipUrl = null }) {
  stop();
  run = { id, speed, clipUrl, events: [], timers: [], start: performance.now(), shots: [], total: null, stopped: false };
  document.body.dataset.replay = clipUrl ? '1' : '';
  for (const n of [1, 2, 3, 4]) station(n, 'wait');
  $('#tipQuote').textContent = '';
  $('#headline').textContent = '';
  $('#tickerLine').textContent = '';
  $('#script').textContent = '';
  $('#shots').replaceChildren();
  $('.wait-line').textContent = '畫面到齊就開剪 · RENDER';
  $('#watch').textContent = '00.0';
  document.body.dataset.mode = 'run';
  sting();
  requestAnimationFrame(frameLoop);
}

// Stopwatches: the big one and one per storyboard card that is still generating.
function frameLoop() {
  if (!run || run.stopped) return;
  const now = runT();
  if (run.total === null) $('#watch').textContent = fmt(now);
  for (const shot of run.shots) {
    if (shot.el.dataset.state !== 'busy') continue;
    shot.clock.textContent = fmt(now - shot.start);
    shot.time.textContent = `⏱ ${fmt(now - shot.start)} 秒`;
  }
  requestAnimationFrame(frameLoop);
}

function fakeTyping() {
  const el = $('#script');
  el.classList.add('fake');
  run.fake = setInterval(() => {
    el.textContent = el.textContent.length > 90 ? '' : el.textContent + FAKE[Math.floor(Math.random() * FAKE.length)];
  }, 60);
}

function typeOut(el, text) {
  const r = run;
  let i = 0;
  const step = () => {
    if (r.stopped) return;
    i += 2 * r.speed;
    el.textContent = text.slice(0, i);
    if (i < text.length) requestAnimationFrame(step);
  };
  step();
}

function buildShots(shots) {
  run.shots = shots.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'shot';
    el.dataset.state = 'queued';
    el.innerHTML = `<div class="pic"><div><b></b><small>排隊中</small></div></div><p class="caption"></p><p class="time">排隊中</p>`;
    el.querySelector('.caption').textContent = `${i + 1}. ${s.caption_zh}`;
    $('#shots').append(el);
    return { el, clock: el.querySelector('.pic b'), label: el.querySelector('.pic small'), time: el.querySelector('.time'), start: 0 };
  });
}

function framesSettled() {
  const landed = run.shots.filter((s) => s.el.dataset.state === 'done').length;
  const settled = run.shots.filter((s) => ['done', 'error'].includes(s.el.dataset.state)).length;
  if (settled < run.shots.length) return station(2, 'busy', `${landed} / ${run.shots.length} 到貨`);
  const last = Math.max(...run.events.filter((e) => e.type === 'frame' || e.type === 'frame_error').map((e) => e.t));
  station(2, 'done', `${landed} / ${run.shots.length} · ${fmt(last - at('script'))} 秒`);
}

const on = {
  tip(e) {
    $('#tipQuote').textContent = e.data.text;
    station(1, 'busy', '寫稿中');
    fakeTyping();
  },
  script(e) {
    clearInterval(run.fake);
    $('#script').classList.remove('fake');
    station(1, 'done', `完成 ${fmt(e.t - at('tip'))} 秒`);
    $('#headline').textContent = e.data.headline;
    shake($('#headline'));
    $('#tickerLine').textContent = e.data.ticker;
    typeOut($('#script'), e.data.anchor_script);
    setTicker(`獨家！${e.data.headline} ｜ ${e.data.ticker} ｜ ${BUSY_TICKER}`);
    buildShots(e.data.shots);
    station(2, 'busy', `0 / ${e.data.shots.length} 到貨`);
    station(3, 'busy', '配音中');
  },
  frame_start(e) {
    const shot = run.shots[e.data.i];
    shot.start = e.t;
    shot.el.dataset.state = 'busy';
    shot.label.textContent = '生成中…';
  },
  frame(e) {
    const shot = run.shots[e.data.i];
    const img = new Image();
    img.alt = '';
    img.src = e.data.url;
    shot.el.querySelector('.pic').append(img);
    // A replay preloads every frame, so the image must already be decoded when it lands.
    shot.el.dataset.loadedAtLanding = String(img.complete && img.naturalWidth > 0);
    shot.el.dataset.state = 'done';
    shot.time.textContent = `✓ ${fmt(e.t - shot.start)} 秒`;
    framesSettled();
  },
  frame_error(e) {
    const shot = run.shots[e.data.i];
    shot.el.dataset.state = 'error';
    shot.clock.textContent = '';
    shot.label.textContent = '被打爆了！';
    shot.time.textContent = `✗ ${e.data.status ?? ''}`;
    framesSettled();
  },
  voice(e) {
    station(3, 'done', `完成 ${fmt(e.t - at('script'))} 秒`);
  },
  clip_start() {
    station(4, 'busy', '剪輯中');
    $('.wait-line').textContent = '準備轟動，3、2、1…';
  },
  clip(e) {
    station(4, 'done', `完成 ${fmt(e.t - at('clip_start'))} 秒`);
    $('.wait-line').textContent = '剪好了！全台放送';
    run.clip = e.data.url;
  },
  ready(e) {
    run.total = e.data.total_s;
    $('#watch').textContent = fmt(run.total);
    shake($('.bigwatch'));
    run.timers.push(setTimeout(onAir, 1200));
  },
  error(e) {
    showError(e.data.message);
  },
};

function apply(e) {
  if (!run || run.stopped) return;
  run.events.push(e);
  on[e.type]?.(e);
}

function onAir() {
  document.body.dataset.mode = 'air';
  sting();
  $('#doneTime').textContent = fmt(run.total);
  const v = $('#player');
  v.muted = false;
  v.src = run.clipUrl ?? run.clip;
  v.play().catch(() => {
    // Autoplay with sound needs a user gesture; play muted rather than not at all.
    v.muted = true;
    v.play();
  });
}
$('#player').addEventListener('timeupdate', (ev) => {
  const v = ev.target;
  $('#progress').style.width = `${(100 * v.currentTime) / (v.duration || 1)}%`;
});
$('#player').addEventListener('click', (ev) => {
  ev.target.muted = false;
});

function showError(detail = '') {
  stop();
  $('#loading').hidden = true;
  $('#errorDetail').textContent = detail;
  $('#errorCard').hidden = false;
}
$('#errorCard').addEventListener('click', home);

// ---- live ----
async function go() {
  const tip = $('#tip').value.trim();
  if (!tip) return shake($('.tipbox'));
  const res = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tip }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return showError(body.error);
  begin({ id: body.id, speed: 1 });
  const r = run;
  r.es = new EventSource(`/api/runs/${body.id}/events`);
  r.es.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === 'ready' || e.type === 'error') r.es.close();
    apply(e);
  };
  r.es.onerror = () => {
    r.es.close();
    if (!r.stopped && r.total === null) showError('連線中斷');
  };
}
$('#go').addEventListener('click', go);
$('#tip').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    go();
  }
});

// ---- replay ----
async function replay(id) {
  stop();
  $('#replayList').hidden = true;
  $('#loading').hidden = false;
  try {
    const events = await (await fetch(`/runs/${id}/events.json`)).json();
    preloaded = await Promise.all(
      events.filter((e) => e.type === 'frame').map(async (e) => {
        const img = new Image();
        img.src = e.data.url;
        await img.decode();
        return img;
      }),
    );
    const clip = events.find((e) => e.type === 'clip');
    const clipUrl = URL.createObjectURL(await (await fetch(clip.data.url)).blob());
    $('#loading').hidden = true;
    begin({ id, speed: REPLAY_SPEED, clipUrl });
    for (const e of events) run.timers.push(setTimeout(() => apply(e), (e.t * 1000) / REPLAY_SPEED));
  } catch (err) {
    showError(`重播失敗：${err.message}`);
  }
}

async function toggleReplayList() {
  const list = $('#replayList');
  if (document.body.dataset.mode !== 'idle') return;
  if (!list.hidden) return (list.hidden = true);
  const runs = await (await fetch('/api/runs')).json();
  list.replaceChildren();
  if (!runs.length) list.innerHTML = '<p>還沒有爆料可以重播</p>';
  for (const r of runs) {
    const b = document.createElement('button');
    b.innerHTML = '<span></span><small></small>';
    b.querySelector('span').textContent = r.headline;
    b.querySelector('small').textContent = `${new Date(r.created).toTimeString().slice(0, 5)} · ${fmt(r.total_s)}S`;
    b.addEventListener('click', () => replay(r.id));
    list.append(b);
  }
  list.hidden = false;
}
$('#replayBadge').addEventListener('click', toggleReplayList);
$('#replayBtn').addEventListener('click', () => run && replay(run.id));
$('#again').addEventListener('click', home);
$('#home').addEventListener('click', home);

// ---- voice: hold to talk ----
const mic = $('#mic');
const micLabel = $('#micLabel');
let rec = null;

async function startRecording() {
  if (rec) return;
  rec = { chunks: [], released: false };
  const r = rec;
  try {
    r.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    rec = null;
    micLabel.textContent = '麥克風被封鎖了！';
    return;
  }
  if (r.released) return finishRecording(r, true);
  r.recorder = new MediaRecorder(r.stream, MediaRecorder.isTypeSupported('audio/webm') ? { mimeType: 'audio/webm' } : {});
  r.recorder.ondataavailable = (ev) => r.chunks.push(ev.data);
  r.recorder.onstop = () => finishRecording(r);
  r.recorder.start();
  r.startedAt = performance.now();
  mic.classList.add('rec');
  micLabel.textContent = '放開送出';
}

function stopRecording() {
  if (!rec) return;
  rec.released = true;
  if (rec.recorder?.state === 'recording') rec.recorder.stop();
}

async function finishRecording(r, discard = false) {
  r.stream.getTracks().forEach((t) => t.stop());
  rec = null;
  mic.classList.remove('rec');
  // Whisper invents text for silence, so a tap is not a tip.
  if (discard || performance.now() - r.startedAt < 600) return (micLabel.textContent = discard ? '按住爆料' : '按久一點再講！');
  const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' });
  mic.classList.add('wait');
  micLabel.textContent = '聽寫中…';
  try {
    const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    $('#tip').value = body.text;
    shake($('.tipbox'));
    micLabel.textContent = '按住爆料';
  } catch {
    micLabel.textContent = '沒聽清楚，再講一次！';
  } finally {
    mic.classList.remove('wait');
  }
}
mic.addEventListener('pointerdown', (ev) => {
  mic.setPointerCapture(ev.pointerId);
  startRecording();
});
mic.addEventListener('pointerup', stopRecording);
mic.addEventListener('pointercancel', stopRecording);

if (params.get('replay')) replay(params.get('replay'));
