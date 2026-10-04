# 芭樂動新聞 Breaking News

Type or say a boring thing that happened to you. In about 35 seconds the app turns it into a
Taiwanese tabloid TV news clip: OpenAI writes the script, draws 5 reenactment frames, reads it in an
anchor voice, and ffmpeg cuts a 1280x720 MP4. Built solo in one day at DevDay Exchange Community
Hack Day Taipei, 2026-10-04.

## Quick start

1. Clone the repo and `cd` into it.
2. In the terminal where you will start your agent, set your key:
   `export OPENAI_API_KEY=sk-...`
   (Do not paste the key into the agent chat.)
3. Start your agent (Claude Code, Codex, …) in the repo folder and paste:

   ```text
   Set up and run this repo. Follow the "Agent setup" section of README.md step by step.
   Do not change any code. If a step fails, stop and tell me the exact error.
   ```

4. When the agent is done, open http://localhost:8787 in a browser, full screen, 16:9.

## Agent setup

Rules:

- Never print, log, or write `OPENAI_API_KEY`. To check it, use only `test -n "$OPENAI_API_KEY"`.
- There is no `package.json` and nothing to `npm install`. The app uses only Node built-ins.
- Do not edit code to make a step pass. Report the failure to the human.
- A live run costs real money (1 script, 5 images, 1 voice). The server allows 1 run per 60 s.

Steps:

1. **Tools.** Check `node --version` (22 or later), `ffmpeg -version`, and `rsvg-convert --version`.
   Install what is missing:
   - macOS: `brew install node ffmpeg librsvg`
   - Debian/Ubuntu: `sudo apt install ffmpeg librsvg2-bin fonts-noto-cjk`, plus Node 22+ from
     nodejs.org. Without a CJK font, the Chinese text in the clip shows as boxes.
2. **Key.** Run `test -n "$OPENAI_API_KEY" && echo set`. If it prints nothing, stop. Ask the human
   to export the key in the terminal and restart you. The key's OpenAI org must have access to
   `gpt-6-astra`, `gpt-image-2.5-flare`, `gpt-4o-mini-tts`, and `whisper-1`.
3. **Server.** Start `node server.mjs` in the background. It prints
   `芭樂動新聞 on http://127.0.0.1:8787`. `PORT=` changes the port. It listens on localhost only.
   `HOST=0.0.0.0` opens it to the network, but then anyone on that network can spend the API credits.
4. **One live run.** This proves the whole pipeline works:

   ```bash
   curl -s -X POST localhost:8787/api/runs -H 'content-type: application/json' \
     -d '{"tip":"我同事偷吃了我放在公司冰箱的便當"}'
   # → {"id":"<run id>"}
   curl -sN localhost:8787/api/runs/<run id>/events
   ```

   Pass: after about 30–50 s (longer when the CPU is busy), the stream ends with a `ready` event, and `runs/<run id>/clip.mp4`
   exists. If it ends with an `error` event, report its `message`. A `frame_error` is not fatal: the
   clip uses the frames that landed.
5. **End-to-end check (optional).** It needs the finished run from step 4. Install the browser
   driver with `npm i -g @playwright/cli`, then run `bash e2e/run.sh`. It starts its own server on
   port 8799 and replays the newest run at 3x in a real browser. It also tests voice input with
   `e2e/fixtures/tip.wav`, which makes 2 `whisper-1` calls. Pass: the last line is `ALL PASS`. The
   video and screenshot go to `e2e/artifacts/`. If the browser is missing, run
   `playwright-cli install-browser`.
6. **Hand off.** Leave the step 3 server running. Tell the human to open http://localhost:8787.

## Use it

- Type a tip (up to 200 characters), or hold **按住爆料** and speak. Then click **給我上頭條！**.
- The control room shows each step live. The clip plays on the ON AIR screen.
- **Replay:** click **▶ 黃金重播 3X** in the top bar, or open `/?replay=<run id>&speed=3`. A replay
  reads the saved run and makes no API calls.
- **"Server busy" card:** a run is in progress, or the last one started less than 60 s ago. OpenAI
  Tier 1 allows 5 images per minute, and one clip uses 5.

## Files

| Path | What |
|---|---|
| `server.mjs` | HTTP server: page, run API with SSE, transcribe proxy, run files |
| `pipeline.mjs` | OpenAI calls: script → 5 frames + voice in parallel → clip |
| `compose.mjs` | Makes the MP4 with ffmpeg and rsvg-convert |
| `public/` | The page: idle, control room, and ON AIR screens |
| `runs/` | Output of each run (git-ignored) |
| `e2e/` | End-to-end check |
| `spike/breaking-news/` | Reference clips from the first experiments |
| `design/screens/` | Prototype screens |
| `BUILD.md` | Spec, measured timings, and limits |
