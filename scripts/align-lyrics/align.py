"""Align each song's LRCLIB lines to Fiona's singing and write server/lyrics-aligned.json.

See README.md for setup and usage.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from importlib.metadata import version
from pathlib import Path

from keep import Kept, Segment, aligned_lines, keep, parse_lrc, sung_lines

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "server" / "lyrics-aligned.json"
DEFAULT_BASE = "https://fionastation.vercel.app"
DEFAULT_CACHE = Path.home() / ".cache" / "fiona-lyrics-align" / "work"
LRCLIB = "https://lrclib.net/api/get"
USER_AGENT = "fionastation-lyrics-align (https://fionastation.vercel.app)"
REQUEST_PAUSE_S = 1.0
MODEL = "small"
ALIGNER = f"stable-ts {version('stable-ts')} whisper-{MODEL}, demucs {version('demucs')} htdemucs"
JAPANESE = re.compile(r"[぀-ヿ㐀-鿿]")
UNSPACED_LANGUAGES = {"ja", "zh", "yue", "th", "lo", "my"}


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.load(response)
    time.sleep(REQUEST_PAUSE_S)
    return body


def seconds(timestamp: str) -> int:
    total = 0
    for part in timestamp.split(":"):
        total = total * 60 + int(part)
    return total


def songs_from(videos: list[dict]) -> list[dict]:
    songs = []
    for video in videos:
        ordered = sorted(video["karaoke_song"], key=lambda s: seconds(s["timestamp"]))
        for song, after in zip(ordered, ordered[1:] + [None]):
            songs.append({
                "id": song["id"],
                "title": song["song_title"],
                "video": video["video_url"],
                "start": seconds(song["timestamp"]),
                "end": seconds(after["timestamp"]) if after else None,
            })
    return songs


def load_output() -> dict:
    return json.loads(OUTPUT.read_text()) if OUTPUT.exists() else {}


def save_output(entries: dict) -> None:
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, OUTPUT)


def isolate_vocals(song: dict, work: Path) -> Path:
    vocals = work / "htdemucs" / "seg" / "vocals.wav"
    if vocals.exists():
        return vocals
    work.mkdir(parents=True, exist_ok=True)
    wav = work / "seg.wav"
    if not wav.exists():
        end = song["end"] if song["end"] is not None else "inf"
        subprocess.run([
            sys.executable, "-m", "yt_dlp", "-q", "-f", "bestaudio", "-x", "--audio-format", "wav",
            "--download-sections", f"*{song['start']}-{end}", "--force-keyframes-at-cuts",
            "-o", str(work / "seg.%(ext)s"),
            f"https://www.youtube.com/watch?v={song['video']}",
        ], check=True)
    subprocess.run([sys.executable, "-m", "demucs", "--two-stems", "vocals", "-o", str(work), str(wav)], check=True)
    return vocals


def language_of(model, texts: list[str], vocals: Path) -> str:
    """The language to align `texts` in.

    Whisper hears Fiona's singing as Japanese even when the lines are English or
    romaji, and aligning Latin text as Japanese stops it splitting words on spaces.
    """
    if any(JAPANESE.search(text) for text in texts):
        return "ja"
    import whisper
    audio = whisper.pad_or_trim(whisper.load_audio(str(vocals)))
    mel = whisper.log_mel_spectrogram(audio, n_mels=model.dims.n_mels).to(model.device)
    _, probs = model.detect_language(mel)
    heard = max(probs, key=probs.get)
    return "en" if heard in UNSPACED_LANGUAGES else heard


def align(model, vocals: Path, texts: list[str]) -> tuple[list[Segment], str]:
    language = language_of(model, texts, vocals)
    result = model.align(str(vocals), "\n".join(texts), language=language, original_split=True)
    segments = []
    for segment in result.segments:
        probs = [word.probability for word in segment.words] or [0.0]
        segments.append(Segment(
            round(segment.start * 1000),
            round((segment.end - segment.start) * 1000),
            sum(probs) / len(probs),
        ))
    return segments, language


def entry_for(model, song: dict, lrclib_id: int, cache: Path) -> dict:
    track = fetch_json(f"{LRCLIB}/{lrclib_id}")
    lines = parse_lrc(track.get("syncedLyrics") or "")
    texts = [line.text for line in sung_lines(lines)]
    base = {"songTitle": song["title"], "lrclibId": lrclib_id, "aligner": ALIGNER}
    if not texts:
        return {**base, "status": "Rejected", "reason": "LRCLIB has no synced lines"}
    vocals = isolate_vocals(song, cache / song["id"])
    segments, language = align(model, vocals, texts)
    if len(segments) != len(texts):
        return {**base, "status": "Rejected", "reason": f"the aligner returned {len(segments)} segments for {len(texts)} lines"}
    verdict = keep(segments)
    print(f"  {language}, {len(texts)} lines: {verdict if not isinstance(verdict, Kept) else f'kept {verdict.indices[0] + 1} to {verdict.indices[-1] + 1}'}")
    if not isinstance(verdict, Kept):
        return {**base, "status": "Rejected", "reason": verdict.reason}
    return {**base, "status": "Aligned", "lines": aligned_lines(lines, segments, verdict)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE, help="site that serves /api/get-karaoke and /api/get-lyrics")
    parser.add_argument("--only", nargs="+", metavar="SONG_ID", help="align only these songs")
    parser.add_argument("--limit", type=int, help="align at most this many songs")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="work dir for audio, outside the repo")
    args = parser.parse_args()

    import static_ffmpeg
    static_ffmpeg.add_paths()

    songs = songs_from(fetch_json(f"{args.base}/api/get-karaoke"))
    if args.only:
        songs = [song for song in songs if song["id"] in set(args.only)]
    entries = load_output()
    model = None
    aligned = 0
    for song in songs:
        if args.limit is not None and aligned >= args.limit:
            break
        lyrics = fetch_json(f"{args.base}/api/get-lyrics?song={song['id']}")
        if lyrics.get("_tag") != "Synced":
            continue
        lrclib_id = lyrics["credit"]["lrclibId"]
        done = entries.get(song["id"])
        if done and done["lrclibId"] == lrclib_id and done["songTitle"] == song["title"]:
            continue
        print(f"{song['title']} ({song['id']})", flush=True)
        if model is None:
            import stable_whisper
            model = stable_whisper.load_model(MODEL, device="cpu")
        try:
            entries[song["id"]] = entry_for(model, song, lrclib_id, args.cache)
        except (subprocess.CalledProcessError, OSError) as error:
            print(f"  skipped: {error}", flush=True)
            continue
        save_output(entries)
        aligned += 1


if __name__ == "__main__":
    main()
