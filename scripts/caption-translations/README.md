# Caption translations

Fiona uploads her own caption tracks on some cover and original videos. For her Japanese songs they translate what she sings. This script reads those tracks and writes `server/lyrics-translations.json`, which the server attaches to `/api/get-lyrics` so the lyrics panel can show the translation under the sung line.

It reads every cover and original video in `/api/get-karaoke` (skipping gone and members-only ones) and takes the uploader-made `subtitles` track, never YouTube's automatic captions. With several languages it prefers `id`, then `en`, then the first. Times are milliseconds from the song's start, and an empty line marks a gap between captions. A track with a karaoke row above the translation, such as romaji, keeps only its lowest row.

It uses the venv of `scripts/align-lyrics` and only touches the network, so it is light. Run it from the repository root:

```sh
~/.cache/fiona-lyrics-align/venv/bin/python scripts/caption-translations/fetch.py
```

`--base` points at another site and `--out` at another file. Commit the file it writes.

Test the parsing with:

```sh
cd scripts/caption-translations && ~/.cache/fiona-lyrics-align/venv/bin/python -m unittest test_captions
```
