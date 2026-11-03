#!/usr/bin/env bash
cd "$(dirname "$0")/../../.."
PORT="${VERIFY_PORT:-3456}"
BASE="${BASE_URL:-http://localhost:$PORT}"
PIDFILE=.claude/skills/verify/.run/pid
if [ -z "${BASE_URL:-}" ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "server: ours, pid $(cat "$PIDFILE")"; else echo "server: NOT started by launch.sh"; fi
fi
echo "foldkit installed: $(grep -m1 '"version"' node_modules/foldkit/package.json | tr -d ' ,')"
printf 'songs api: '; curl -s --max-time 30 "$BASE/api/get-karaoke" | grep -o song_title | wc -l
