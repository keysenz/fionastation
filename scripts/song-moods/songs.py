import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "align-lyrics"))
from align import DEFAULT_BASE, DEFAULT_CACHE, fetch_json, seconds  # noqa: E402

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
LYRICS_CACHE = RESULTS / "lyrics"


def catalogue(base: str = DEFAULT_BASE) -> list[dict]:
    path = RESULTS / "karaoke.json"
    if not path.exists():
        RESULTS.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(fetch_json(f"{base}/api/get-karaoke"), ensure_ascii=False, indent=1))
    return json.loads(path.read_text())


def all_songs(videos: list[dict]) -> list[dict]:
    songs = []
    for video in videos:
        ordered = sorted(video["karaoke_song"], key=lambda s: seconds(s["timestamp"]))
        for song, after in zip(ordered, ordered[1:] + [None]):
            songs.append({
                "id": song["id"],
                "title": song["song_title"],
                "artist": song["artist"],
                "version": song["version"],
                "video": video["video_url"],
                "videoId": video["id"],
                "videoTitle": video["video_title"],
                "kind": video["kind"],
                "start": seconds(song["timestamp"]),
                "end": seconds(after["timestamp"]) if after else None,
            })
    return songs


def audio_dir(song: dict, cache: Path = DEFAULT_CACHE) -> Path | None:
    work = cache / song["id"]
    stems = work / "htdemucs" / "seg"
    ok = (work / "seg.wav").exists() and (stems / "vocals.wav").exists() and (stems / "no_vocals.wav").exists()
    return work if ok else None


def lyrics(song: dict, base: str = DEFAULT_BASE) -> dict:
    LYRICS_CACHE.mkdir(parents=True, exist_ok=True)
    path = LYRICS_CACHE / f"{song['id']}.json"
    if not path.exists():
        try:
            body = fetch_json(f"{base}/api/get-lyrics?song={song['id']}")
        except urllib.error.HTTPError as error:
            body = {"_tag": f"HTTP {error.code}"}
        path.write_text(json.dumps(body, ensure_ascii=False))
    body = json.loads(path.read_text())
    tag = body.get("_tag")
    if tag == "Synced":
        return {"source": "Synced", "lines": [l["text"] for l in body["lines"]], "lastLineMs": body["lines"][-1]["atMs"]}
    if tag == "Plain":
        text = body.get("text") or "\n".join(body.get("lines", []))
        return {"source": "Plain", "lines": [l for l in text.splitlines() if l.strip()], "lastLineMs": None}
    return {"source": "None", "lines": [], "lastLineMs": None}


if __name__ == "__main__":
    for song in all_songs(catalogue()):
        if audio_dir(song):
            got = lyrics(song)
            print(f"{song['id']}  {got['source']:6} {len(got['lines']):3}  {song['kind']:8} {song['title']} / {song['artist']}")
