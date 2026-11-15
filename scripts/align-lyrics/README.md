# Align lyrics to Fiona's singing

LRCLIB times its lines to the studio recording. A karaoke track that skips the intro shows them late, and a short version shows lines Fiona never sang. This batch times each song's LRCLIB lines to her own singing and writes `server/lyrics-aligned.json`, which the server serves in place of the LRCLIB timing.

For each song whose `/api/get-lyrics` answer is `Synced`, and for each song kept in `server/lyrics-local.json`, the batch:

1. Downloads the song's part of the video with yt-dlp, from its timestamp to the next song's timestamp or the end of the video.
2. Isolates the vocals with demucs.
3. Aligns the raw lines to the vocals with stable-ts and the Whisper `small` model.
4. Keeps the lines she sang, by the rules in `keep.py`, or records the song as `Rejected`.
5. Romanizes the kept lines with `romaji.py`, so the song list shows only Latin script.

A song in `server/lyrics-local.json` has no LRCLIB record, so its text comes from that file instead and the aligner times it from scratch. Its entry is written with `"source": "Local"` and `lrclibId` 0, and the server serves it only while that entry exists. The file is keyed by song id and each entry says where its text came from, which is what the page credits under the lyrics.

The text comes from LRCLIB, or from `server/lyrics-local.json` when LRCLIB has nothing. Only the times change, and the script it is written in: kana and kanji go through cutlet (Hepburn), hangul through korean-romanizer, and any other script through Unidecode. Latin lines pass through untouched.

To romanize a file an older run wrote, without aligning anything again:

```sh
~/.cache/fiona-lyrics-align/venv/bin/python scripts/align-lyrics/romaji.py server/lyrics-aligned.json
```

## Set up

You need Python 3.11. The batch runs on the CPU and takes about 7 minutes per song.

```sh
uv venv --python 3.11 ~/.cache/fiona-lyrics-align/venv
uv pip install --python ~/.cache/fiona-lyrics-align/venv -r scripts/align-lyrics/requirements.txt
```

## Run

Run the batch from the repository root:

```sh
~/.cache/fiona-lyrics-align/venv/bin/python scripts/align-lyrics/align.py
```

| Option | Effect |
| --- | --- |
| `--only <songId>...` | Align only these songs. |
| `--limit N` | Align at most N songs. |
| `--base <url>` | Read songs and lyrics from this site. The default is `https://fionastation.vercel.app`. |
| `--cache <dir>` | Keep audio here. The default is `~/.cache/fiona-lyrics-align/work`. |

The batch writes the file after each song, so a crash loses at most one song. It skips a song that already has an entry with the same LRCLIB track and song title, `Rejected` entries included. To align a song again, delete its entry.

Requests to the site retry on a 5xx, a 429 or a dropped connection, waiting 5 to 80 seconds, about 5 minutes in all. The batch skips videos marked `membership` or `is_gone`. When a download fails, it leaves the rest of that video's songs alone for the run and writes no entry, so a later run tries them again.

## Test the keep rules

```sh
cd scripts/align-lyrics && ~/.cache/fiona-lyrics-align/venv/bin/python -m unittest
```
