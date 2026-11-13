# Align lyrics to Fiona's singing

LRCLIB times its lines to the studio recording. A karaoke track that skips the intro shows them late, and a short version shows lines Fiona never sang. This batch times each song's LRCLIB lines to her own singing and writes `server/lyrics-aligned.json`, which the server serves in place of the LRCLIB timing.

For each song whose `/api/get-lyrics` answer is `Synced`, the batch:

1. Downloads the song's part of the video with yt-dlp, from its timestamp to the next song's timestamp or the end of the video.
2. Isolates the vocals with demucs.
3. Aligns the raw LRCLIB lines to the vocals with stable-ts and the Whisper `small` model.
4. Keeps the lines she sang, by the rules in `keep.py`, or records the song as `Rejected`.

The text always comes from LRCLIB. Only the times change.

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

## Test the keep rules

```sh
cd scripts/align-lyrics && ~/.cache/fiona-lyrics-align/venv/bin/python -m unittest
```
