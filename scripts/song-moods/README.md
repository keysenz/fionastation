# Song mood prototype

A throwaway check of whether Fio Radio can tell a song's mood well enough to build a mood picker, mood-aware autoplay and mood badges on. It reads about 35 songs and nothing in the site uses its output. The findings are in [PROTOTYPE-RESULTS.md](PROTOTYPE-RESULTS.md).

Each song gets two independent readings:

- **Text.** Claude Haiku 5.5, called through a headless `claude -p` session, reads the title, artist and lyrics from `/api/get-lyrics` and returns one or two mood tags (ceria, galau, hype, chill, romantis, sendu), an energy score and a positivity score from 0 to 1, and a one-line reason. Each video also gets one or two stream themes from its title, kind, publish time and setlist.
- **Audio.** librosa measures tempo, loudness, spectral brightness, onset rate and percussive share on the song's audio that `scripts/align-lyrics/` already cached. The window runs from the song's timestamp to 8 seconds after its last lyric line, so the talk after a song is left out. Audio energy is the mean percentile rank of those five within the set.

A song is flagged when its text energy and audio energy differ by 0.4 or more.

## Set up

This reuses the align-lyrics venv and its audio cache in `~/.cache/fiona-lyrics-align/work`. It downloads no audio, so it only reads songs whose audio and demucs stems are already cached.

```sh
uv pip install --python ~/.cache/fiona-lyrics-align/venv -r scripts/song-moods/requirements.txt
```

The text step runs Haiku through `claude -p` on your Claude Code login, in the 4G JS lane. It needs no API key.

## Run

Run these from `scripts/song-moods/`:

```sh
~/.cache/fiona-limits/capped 5G 4-9 ~/.cache/fiona-lyrics-align/venv/bin/python run.py --audio-only
~/.cache/fiona-lyrics-align/venv/bin/python run.py
~/.cache/fiona-lyrics-align/venv/bin/python report.py
```

The first command measures audio in the 5G audio lane and skips the Claude calls. The second reuses that audio and runs each `claude -p` call in the 4G JS lane by itself, so it needs no outer cap. Every result is cached: audio features beside the audio in `song-moods-audio.json`, Claude answers in `results/text/` and `results/themes/`. A rerun only measures or asks what is missing. Delete a file to redo it.

`report.py` rewrites the generated part of `PROTOTYPE-RESULTS.md` and leaves the hand-written verdict above it alone. `panel.py` has Opus, Fable and Sonnet tag the `labels.csv` songs blind, so the report can show whether Haiku agrees with stronger models. It runs one call at a time in the JS lane and cost $0.91 for 60 labels. That is agreement between models, not ground truth.

On its first run `report.py` writes `labels.csv`, a 20-song sheet for a person to label. Once the sheet is filled in, rerun `report.py` to get agreement figures.
