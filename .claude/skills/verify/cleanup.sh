#!/usr/bin/env bash
cd "$(dirname "$0")"
PIDFILE=.run/pid
if [ -f "$PIDFILE" ]; then
  # launch.sh starts the server in its own process group, so this stops the whole server.
  kill -- "-$(cat "$PIDFILE")" 2>/dev/null
  sleep 2
  kill -9 -- "-$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
fi
rm -f .run/dev.log .run/build.log .run/karaoke.db .run/karaoke.db-shm .run/karaoke.db-wal
ls -d evidence/* 2>/dev/null | tail -3
