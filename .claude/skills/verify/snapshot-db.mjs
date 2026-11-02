#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '.run', 'karaoke.db');
const dump = execFileSync('ssh', ['-o', 'BatchMode=yes', 'devbox',
  'docker exec discord-bot-discord-bot-1 sqlite3 -readonly /data/karaoke.db .dump'],
  { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' });

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec(dump);
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log(`snapshot ${out}: ${count('karaoke_video')} videos, ${count('karaoke_song')} songs`);
db.close();
