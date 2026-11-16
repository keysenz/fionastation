import argparse
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "align-lyrics"))

from align import DEFAULT_BASE, USER_AGENT, fetch_json, seconds  # noqa: E402
from captions import cues_from_json3, lines_from_cues, pick_language  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "server" / "lyrics-translations.json"
KINDS = {"cover", "original"}


def own_videos(videos: list[dict]) -> list[dict]:
    return [
        video for video in videos
        if video.get("kind") in KINDS and not video.get("is_gone") and not video.get("membership")
    ]


def caption_track(video_id: str) -> tuple[str, dict] | None:
    from yt_dlp import YoutubeDL

    options = {"quiet": True, "no_warnings": True, "skip_download": True}
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
    tracks = info.get("subtitles") or {}
    language = pick_language(list(tracks))
    if language is None:
        return None
    json3 = next((fmt for fmt in tracks[language] if fmt.get("ext") == "json3"), None)
    if json3 is None:
        print(f"  {video_id}: {language} has no json3 format", flush=True)
        return None
    request = urllib.request.Request(json3["url"], headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return language, json.load(response)


def save_output(entries: dict, path: Path = OUTPUT) -> None:
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE, help="site that serves /api/get-karaoke")
    parser.add_argument("--out", type=Path, default=OUTPUT, help="where to write the translations")
    args = parser.parse_args()

    entries = {}
    for video in own_videos(fetch_json(f"{args.base}/api/get-karaoke")):
        video_id = video["video_url"]
        print(video_id, flush=True)
        found = caption_track(video_id)
        if found is None:
            continue
        language, track = found
        song = video["karaoke_song"][0]
        lines = lines_from_cues(cues_from_json3(track), seconds(song["timestamp"]) * 1000)
        if not lines:
            continue
        print(f"  {language}, {len(lines)} lines", flush=True)
        entries[song["id"]] = {"videoId": video_id, "language": language, "lines": lines}
    save_output(entries, args.out)
    print(f"wrote {len(entries)} translations to {args.out}")


if __name__ == "__main__":
    main()
