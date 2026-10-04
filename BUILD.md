# 動新聞 Breaking News: build brief

Decided 2026-10-04 09:40. HADK was used only to pick the idea (`hadk idea select idea-breaking-news`).
Event: 12:00 to 17:00, solo, 1-minute live demo, peer vote. Product code starts at 12:00.

## Pitch

Say or type any boring incident. In about 30 seconds it becomes a kuso Taiwanese tabloid
"breaking news" MP4 clip: crude 3D reenactment frames, a breathless anchor voice, subtitles, a red
ticker, and a 獨家 tag.

Output contract: every clip has the same format and look as the reference clips in
`spike/breaking-news/run1/`, `run2/` and `run3/` (`clip-sub.mp4`). The content is new for each tip.

## On stage (1 minute)

Before going up, generate one run in the app from a voter's incident. Finish it at least 60 s
before going up (image rate limit).

| Time | What the room sees |
|---|---|
| 0-8 s | Hook: Taiwanese TV turns trivia into a national scandal. We automated it. |
| 8-20 s | Control-room replay of the real run at 3x (a 30-34 s run takes 10-11 s): tip, script lands, 5 storyboard cards, 5 frames land in parallel, anchor voice, render, total time. |
| 20-52 s | Roll the tape: the clip plays full screen. |
| 52-60 s | Close: powered by OpenAI: gpt-6-astra, gpt-image-2.5-flare, gpt-4o-mini-tts, whisper-1. |

The spike clips run 31-32 s, so this plan has no slack. To get slack, cut the anchor script to
about 100 characters (about 21 s).

## UI: the process view is the star

- Style: very kuso and 北爛, in the 蘋果動新聞 look. Red, yellow and black. Slanted banners, a
  flashing 獨家 starburst, a shaking giant headline, sticker sound-effect words, a news sting.
- Do not use the Apple Daily name or logo. Working parody brand: 芭樂動新聞 (芭樂 = cheesy).
  UI copy: see the table at the end of this section.
- Prototype (desktop, 1920x1080): `design/breaking-news.pen`, three screens: 01 idle, 02 control
  room at t = 22.5 s (run 2 data), 03 ON AIR (a real frame of the run 2 reference clip).
- One page with three areas:
  1. Tip line: a text box and a big hold-to-talk mic button. The transcript appears in the box.
  2. Control room: four stations light up in order. Script desk (the script streams in),
     animation team (5 storyboard cards; each card flips to its frame when it lands, with its own
     stopwatch), anchor desk (voice waveform), ON AIR. A big stopwatch shows the total time.
  3. Player: a `<video>` that plays the MP4 the server rendered. The pans, 獨家 tag, BREAKING NEWS,
     AI 惡搞 watermark, yellow headline bar, red ticker and subtitles are in the MP4.
- Events drive the whole view. Each run saves `events.json` as a list of `{t, type, data}`.
  Live mode gets the events from the server (SSE). Replay mode reads the saved file at 1x or 3x.
  One renderer serves both.

UI copy (drafted with Mistral-Large-3 because TAIDE was down, then edited):

| Element | Copy |
|---|---|
| Tip line title | 爆料專線 |
| Tip box placeholder | 講出你的鳥事，馬上讓全台看傻眼！ |
| Mic button | 按住爆料 |
| Go button | 給我上頭條！ |
| Stations | 神筆亂噴組 · 3D 亂演組 · 主播激動台 · ON AIR 全台放送 |
| Station busy lines | 狂寫中，別吵！ · 3D 誇張中，快吐血 · 哀嚎配音中，請稍候 · 準備轟動，3、2、1… |
| Ticker while busy | 獨家爆料！全台震驚！ ｜ 直擊現場！畫面太誇張！ ｜ 國安危機疑雲重重！ ｜ 觀眾朋友注意！別眨眼！ |
| Done | 全台轟動！ + 製作時間 N 秒 |
| Replay label | 黃金重播 |
| Rate-limit or error card | 抱歉！伺服器被全台關心打爆了！ |

## Voice

- MVP: hold to talk, record with MediaRecorder (webm), POST to the server, transcribe with
  `whisper-1` (language zh), put the text in the tip box. Use `whisper-1` because it returned
  Traditional Chinese in the spike; `gpt-transcribe` returned Simplified.
- Stretch: before generating, the anchor asks the tipster one kuso follow-up question by voice
  (Realtime API).

## Pipeline (measured in the spike, 3 runs)

1. Script and storyboard: `gpt-6-astra`, `reasoning.effort: low`, Structured Outputs. Fields:
   `headline` (16 characters max), `ticker`, `anchor_script`, `cast` (new), and `shots[5]` with
   `caption_zh` (new, 12 characters max, for the storyboard cards) and `scene_en`.
   13.7-16.3 s. It used only 30-65 reasoning tokens, so the time is output length, not reasoning.
2. Frames: `gpt-image-2.5-flare`, quality `low`, `1536x864`, `jpeg`, 5 in parallel. Prompt =
   style prefix + `cast` + scene. 7.6-10.7 s each. Add `cast`: in the spike, the victim's face and
   gender changed between shots.
3. Voice: `gpt-4o-mini-tts`, voice `coral`, breathless-anchor instructions. Runs in parallel with
   the frames. 5.3-5.5 s.
4. Render: `compose.mjs` from the spike, unchanged. ffmpeg and rsvg-convert make a 1280x720 MP4
   with pans, tags, headline bar, ticker and subtitles. About 3.5 s without subtitles, about 7 s
   with them. Subtitles: split the script at 。！？ (long sentences also at commas). Each line gets
   screen time in proportion to its length. In run 2, every line started within 0.6 s of the voice.

Frames and voice are ready 23.5-26.7 s after the tip. The clip is ready about 7 s later
(about 30-34 s). Untested speedups: stream the script with
`shots` first in the schema so the frames start earlier, and use a shorter script.

## Hard limits

- Tier 1: 5 images per minute, shared by all gpt-image models (the 429 says
  "for limit gpt-image"). So use 5 frames max, make one clip per minute, and do not generate in
  the last 60 s before going on stage.
- Never name real people, brands or news outlets in scripts or frames.
- `OPENAI_API_KEY` stays on the server.

## Architecture

One Node 22+ server (`node:http`, no framework) and one static page (vanilla JS and CSS).

```
page                                    server                               OpenAI
tip line --- POST /api/transcribe ----> transcribe proxy ------------------> whisper-1
         \-- POST /api/runs {tip} ----> pipeline -- script ----------------> gpt-6-astra (low)
control room <-- SSE /api/runs/:id/events   |      +-- 5 frames (parallel) -> gpt-image-2.5-flare
player <-------- /runs/:id/<file>           |      +-- voice (parallel) ---> gpt-4o-mini-tts
replay <-------- /runs/:id/events.json      +-- compose.mjs (ffmpeg) -> runs/<id>/clip.mp4
                                            +-- writes runs/<id>/ and events.json
```

| Endpoint | Does |
|---|---|
| `POST /api/runs` `{tip}` | Returns `202 {id}` and runs the pipeline in the background. |
| `GET /api/runs/:id/events` | SSE. Sends the past events, then live ones. Closes after `ready` or `error`. |
| `GET /api/runs` | `[{id, headline, created}]` for the replay picker. |
| `POST /api/transcribe` (body: audio/webm) | `{text}` in Traditional Chinese. |
| `GET /runs/:id/<file>` | Frames, voice, `clip.mp4`, and `events.json`. |

Events: `{t, type, data}`, where `t` is seconds since the run started.

| type | data |
|---|---|
| `tip` | `{text}` |
| `script` | `{headline, ticker, anchor_script, cast, shots}` |
| `frame_start` | `{i}` |
| `frame` | `{i, url}` |
| `frame_error` | `{i, status, message}` |
| `voice` | `{url}` |
| `clip_start` | `{}` |
| `clip` | `{url, seconds}` |
| `ready` | `{total_s}` |
| `error` | `{message}` |

- The script step sends no partial text. While it waits, the script desk plays a fake typing
  animation. When `script` arrives, the real script types out fast. Streaming can come later.
- Each storyboard card shows a stopwatch from its `frame_start` to its `frame`.
- Player: a `<video>` of `clip.mp4`, scaled to the screen. ON AIR is busy from `clip_start` to
  `clip`.
- A `frame_error` card shows the rate-limit card. `compose` gets only the frames that landed, so
  the clip still fills the voice. A script, voice or render `error` shows the error card and no
  clip.
- Files: `server.mjs` (HTTP, SSE, static files), `pipeline.mjs` (OpenAI calls, events),
  `compose.mjs` (copied from the spike),
  `public/index.html`, `public/app.js` (one `render(events)` for live and replay),
  `public/style.css`, `runs/<id>/`.

## Build order

Finish each step end to end before you start the next.

1. Server: `POST /api/runs` runs the pipeline, writes `runs/<id>/` (frames, voice, story,
   `clip.mp4`, `events.json`), and streams the events by SSE. Reuse the prompts, parameters and
   `compose.mjs` from the spike. Check the first clip against the reference clips.
2. Page: tip text box, then the control room fed by SSE, then the `<video>` player.
3. Replay: load a saved run's `events.json`, preload all its frames and the clip, then play the
   events at 3x. Without the preload, a frame lands as a loading spinner.
4. Voice: hold-to-talk transcription into the tip box.
5. Kuso polish: news sting, shake, starburst, sticker words.
6. 15:30 freeze: generate the stage run, then rehearse the 1-minute demo twice.

## Spike (reference only, written before the event)

- `spike/breaking-news/bench.mjs`: API calls, prompts, schema, parameters, and timings.
- `spike/breaking-news/compose.mjs`: ffmpeg compositor with subtitles. The app uses it unchanged.
- `spike/breaking-news/run1/`, `run2/`, `run3/`: the reference clips (`clip-sub.mp4`) with their
  frames, voice, story, subtitles and timings. Run 1 lost frame 4 to the image rate limit.
- `spike/breaking-news/run2/clip-sub.mp4`: backup clip if the app fails on stage.

## Known issue

`hadk next` recommends `hadk submit` all day. Its deadline policy uses fixed hours, so from 6 to
12 hours before the deadline it blocks the idea, scope and scaffold steps. Ignore it.
