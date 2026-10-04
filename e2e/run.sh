#!/usr/bin/env bash
# End-to-end check on a saved run (no image or script API calls):
#   1. 3x replay in a real browser: preloaded frames, no OpenAI calls, clip plays. Video: e2e/artifacts/replay.webm
#   2. /api/transcribe with the fixture returns Traditional Chinese (one whisper-1 call).
#   3. Hold-to-talk with the fixture as the mic fills the tip box (one whisper-1 call).
# Usage: bash e2e/run.sh [run-id]   (default: newest finished run in runs/)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${E2E_PORT:-8799}
URL="http://localhost:$PORT"
ART=e2e/artifacts
mkdir -p "$ART"
LOG="$ART/server.log"

pw() { playwright-cli -s=e2e "$@"; }
js() { pw eval "$1" 2>&1 | sed -n 2p | sed -e 's/^"//' -e 's/"$//'; }
wait_for() { # wait_for <js returning "1"> <seconds>
  for _ in $(seq 1 $(($2 * 5))); do
    [[ $(js "$1") == 1 ]] && return 0
    perl -e 'select(undef,undef,undef,0.2)'
  done
  return 1
}
fail() { echo "FAIL: $*"; exit 1; }
cleanup() { pw close >/dev/null 2>&1 || true; [[ -n ${SERVER:-} ]] && kill "$SERVER" 2>/dev/null || true; }
trap cleanup EXIT

PORT=$PORT node server.mjs >"$LOG" 2>&1 &
SERVER=$!
for _ in $(seq 1 50); do curl -sf "$URL/api/runs" >/dev/null && break; perl -e 'select(undef,undef,undef,0.1)'; done
ID=${1:-$(curl -sf "$URL/api/runs" | node -e 'process.stdin.on("data", (d) => console.log(JSON.parse(d)[0]?.id ?? ""))')}
[[ -n $ID ]] || fail "no finished run in runs/"
TOTAL=$(node -e "console.log(require('./runs/$ID/events.json').at(-1).data.total_s)")
echo "run $ID (total ${TOTAL} s)"

# 1. Replay at 3x
pw open --config=e2e/mic.config.json "$URL/" >/dev/null 2>&1
pw video-start "$ART/replay.webm" >/dev/null 2>&1
CALLS=$(grep -c '^\[openai\]' "$LOG" || true)
START=$(perl -MTime::HiRes=time -e 'printf "%.2f", time')
pw goto "$URL/?replay=$ID" >/dev/null 2>&1
wait_for "() => document.body.dataset.mode === 'air' ? '1' : '0'" 60 || fail "replay never reached ON AIR"
ONAIR=$(perl -MTime::HiRes=time -e "printf '%.1f', time - $START")
wait_for "() => document.querySelector('#player').currentTime > 1 ? '1' : '0'" 10 || fail "clip did not play"
perl -e 'select(undef,undef,undef,1.5)'
pw video-stop >/dev/null 2>&1
LANDED=$(js "() => [...document.querySelectorAll('.shot')].map((s) => s.dataset.loadedAtLanding).join(',')")
[[ $LANDED =~ ^(true,)*true$ ]] || fail "a frame card landed without its image: $LANDED"
NEW_CALLS=$(( $(grep -c '^\[openai\]' "$LOG" || true) - CALLS ))
[[ $NEW_CALLS == 0 ]] || fail "replay made $NEW_CALLS OpenAI calls"
js "() => { document.querySelector('#player').currentTime = 5; document.querySelector('#replayBtn').click(); return '1'; }" >/dev/null
wait_for "() => { const v = document.querySelector('#player'); return document.body.dataset.mode === 'air' && !v.paused && v.currentTime < 2 ? '1' : '0'; }" 5 \
  || fail "黃金重播 on ON AIR did not restart the clip"
ERRORS=$(pw console error 2>&1 | grep -o 'Errors: [0-9]*' | head -1)
[[ $ERRORS == "Errors: 0" ]] || fail "console: $ERRORS"
echo "PASS replay: ON AIR after ${ONAIR} s at 3x, frames loaded at landing [$LANDED], 0 OpenAI calls, clip playing, $ERRORS"

# 2. Transcribe endpoint
TEXT=$(curl -sf -X POST "$URL/api/transcribe" -H 'content-type: audio/wav' --data-binary @e2e/fixtures/tip.wav)
[[ $TEXT == *開會* && $TEXT != *开会* ]] || fail "transcribe: $TEXT"
echo "PASS transcribe: $TEXT"

# 3. Hold-to-talk
pw goto "$URL/" >/dev/null 2>&1
sed "s|__ROOT__|$PWD|" e2e/fake-mic.js >"$ART/fake-mic.js"
pw run-code --filename="$ART/fake-mic.js" >/dev/null 2>&1
pw mousemove 150 780 >/dev/null 2>&1
pw mousedown >/dev/null 2>&1
perl -e 'select(undef,undef,undef,7.2)'
pw mouseup >/dev/null 2>&1
wait_for "() => document.querySelector('#tip').value ? '1' : '0'" 20 || fail "hold-to-talk left the tip box empty"
TIP=$(js "() => document.querySelector('#tip').value")
[[ $TIP == *開會* ]] || fail "hold-to-talk: $TIP"
pw screenshot --filename="$ART/hold-to-talk.png" >/dev/null 2>&1
echo "PASS hold-to-talk: $TIP"
echo "ALL PASS · artifacts: $ART/replay.webm $ART/hold-to-talk.png"
