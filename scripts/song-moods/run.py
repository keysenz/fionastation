import argparse
import json
import re

from audio import audio_energy, features
from moods import SONG_SYSTEM, THEME_SYSTEM, Haiku, SongMood, StreamTheme, clamp, song_prompt, theme_prompt
from songs import RESULTS, all_songs, audio_dir, catalogue, lyrics

REPEATS = {"tampar", "monokrom"}
DISAGREE_AT = 0.4


def normalized(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def pick(songs: list[dict]) -> list[dict]:
    """Every distinct title with cached audio, plus a second take of two titles to see how stable each signal is."""
    seen: dict[str, int] = {}
    picked = []
    for song in songs:
        if not audio_dir(song):
            continue
        key = normalized(song["title"])
        seen[key] = seen.get(key, 0) + 1
        if seen[key] == 1 or (seen[key] == 2 and key in REPEATS):
            picked.append(song)
    return picked


def cached(path, make):
    if path.exists():
        return json.loads(path.read_text())
    value = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1))
    return value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-only", action="store_true", help="skip the Claude calls")
    args = parser.parse_args()

    videos = catalogue()
    songs = pick(all_songs(videos))
    print(f"{len(songs)} songs")

    rows = []
    for song in songs:
        words = lyrics(song)
        rows.append({**song, "lyricsSource": words["source"], "audio": features(audio_dir(song), words["lastLineMs"])})
        print("audio", song["title"], rows[-1]["audio"])
    for row, energy in zip(rows, audio_energy([r["audio"] for r in rows])):
        row["audioEnergy"] = energy

    haiku = None if args.audio_only else Haiku()
    if haiku:
        for row in rows:
            def ask(row=row):
                mood = haiku.ask(SONG_SYSTEM, song_prompt(row, lyrics(row)), SongMood)
                return {**(clamp(mood).model_dump() if mood else {"failed": True}), "usage": haiku.last}
            row["text"] = cached(RESULTS / "text" / f"{row['id']}.json", ask)
            if "energy" in row["text"]:
                row["disagreement"] = round(row["text"]["energy"] - row["audioEnergy"], 3)
                row["flagged"] = abs(row["disagreement"]) >= DISAGREE_AT
            print("text", row["title"], row["text"])

        themes = {}
        for video in {row["videoId"] for row in rows}:
            source = next(v for v in videos if v["id"] == video)
            def ask(source=source):
                theme = haiku.ask(THEME_SYSTEM, theme_prompt(source), StreamTheme)
                return {**(theme.model_dump() if theme else {"failed": True}), "usage": haiku.last}
            themes[video] = {"title": source["video_title"], "video": source["video_url"], "publishedAt": source["published_at"],
                             "kind": source["kind"], **cached(RESULTS / "themes" / f"{video}.json", ask)}
            print("theme", source["video_title"], themes[video])
        (RESULTS / "themes.json").write_text(json.dumps(themes, ensure_ascii=False, indent=1))

    run = {"songs": len(rows), "audioSeconds": round(sum(r["audio"]["measureSeconds"] for r in rows), 1)}
    if haiku:
        for name, records in (("songText", [r["text"] for r in rows]), ("streamTheme", list(themes.values()))):
            used = [r["usage"] for r in records]
            tokens_in, tokens_out = sum(u["inputTokens"] for u in used), sum(u["outputTokens"] for u in used)
            run[name] = {"calls": len(used), "seconds": round(sum(u["seconds"] for u in used), 1),
                         "inputTokens": tokens_in, "outputTokens": tokens_out, "usd": round(sum(u["usd"] for u in used), 5)}
    (RESULTS / "moods.json").write_text(json.dumps({"run": run, "rows": rows}, ensure_ascii=False, indent=1))
    print(run)


if __name__ == "__main__":
    main()
