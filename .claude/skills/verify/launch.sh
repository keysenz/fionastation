#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
source "$HOME/.nvm/nvm.sh" >/dev/null
nvm use >/dev/null
SKILL=.claude/skills/verify
RUN="$SKILL/.run"
PORT="${VERIFY_PORT:-3456}"
mkdir -p "$RUN"

if ss -ltn | grep -q ":$PORT "; then
  echo "refusing to start: port $PORT is already in use" >&2
  exit 1
fi
[ -f "$RUN/karaoke.db" ] || node "$SKILL/snapshot-db.mjs"

npm run build >"$RUN/build.log" 2>&1 || { echo "build failed, see $RUN/build.log" >&2; exit 1; }

PLAYLISTS_DB_PATH="${PLAYLISTS_DB_PATH:-$(mktemp -d /tmp/fio-playlists-XXXXXX)/playlists.db}"
export PLAYLISTS_DB_PATH
echo "$PLAYLISTS_DB_PATH" >"$RUN/playlists.path"
echo "playlists db $PLAYLISTS_DB_PATH"

export STATS_DB_PATH="${STATS_DB_PATH:-$(mktemp -d /tmp/fio-stats-XXXXXX)/stats.db}"
echo "$STATS_DB_PATH" >"$RUN/stats.path"
echo "stats db $STATS_DB_PATH"
export ADMIN_PORT="${ADMIN_PORT:-3911}" ADMIN_SECRET="${ADMIN_SECRET:-verify-admin-secret}"

PLAYLISTS_IP_LIMIT_PER_HOUR="${PLAYLISTS_IP_LIMIT_PER_HOUR:-1000}" DATABASE_PATH="$PWD/$RUN/karaoke.db" PORT="$PORT" HOSTNAME=127.0.0.1 \
  setsid node --disable-warning=ExperimentalWarning server/main.ts >"$RUN/dev.log" 2>&1 &
echo $! >"$RUN/pid"

for _ in $(seq 1 90); do
  if curl -sf --max-time 30 -H "x-proxy-secret: ${PROXY_SECRET:-}" "http://localhost:$PORT/api/get-karaoke" | grep -q song_title; then
    echo "ready on http://localhost:$PORT (pid $(cat "$RUN/pid"))"
    exit 0
  fi
  sleep 1
done
echo "not ready after 90s, see $RUN/dev.log" >&2
exit 1
