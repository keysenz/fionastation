"""Stronger models label the labeling-sheet songs blind, to see whether Haiku agrees with them. Not human ground truth."""
import csv
import json
from itertools import combinations

from scipy.stats import spearmanr

from moods import SONG_SYSTEM, Claude, SongMood, clamp, song_prompt
from report import LABELS
from run import cached
from songs import RESULTS, all_songs, catalogue, lyrics

PANEL = ("opus", "fable", "sonnet")
PANEL_DIR = RESULTS / "panel"


def label(model: str, song: dict) -> dict:
    def ask():
        claude = Claude(model)
        mood = claude.ask(SONG_SYSTEM, song_prompt(song, lyrics(song)), SongMood)
        return {**(clamp(mood).model_dump() if mood else {"failed": True}), "usage": claude.last}
    return cached(PANEL_DIR / model / f"{song['id']}.json", ask)


def readings(ids: list[str]) -> dict[str, dict[str, dict]]:
    out = {"haiku": {i: json.loads((RESULTS / "text" / f"{i}.json").read_text()) for i in ids}}
    for model in PANEL:
        out[model] = {i: json.loads((PANEL_DIR / model / f"{i}.json").read_text()) for i in ids}
    return out


def compare(a: dict[str, dict], b: dict[str, dict], ids: list[str]) -> dict:
    ok = [i for i in ids if "moods" in a[i] and "moods" in b[i]]
    return {
        "firstTagShared": sum(a[i]["moods"][0] in b[i]["moods"] for i in ok) / len(ok),
        "sameFirstTag": sum(a[i]["moods"][0] == b[i]["moods"][0] for i in ok) / len(ok),
        "energyRho": spearmanr([a[i]["energy"] for i in ok], [b[i]["energy"] for i in ok]).statistic,
        "positivityRho": spearmanr([a[i]["positivity"] for i in ok], [b[i]["positivity"] for i in ok]).statistic,
    }


def table(ids: list[str]) -> list[str]:
    got = readings(ids)
    rows = ["| Pair | First tag among the other's tags | Same first tag | Energy ρ | Positivity ρ |", "| --- | --- | --- | --- | --- |"]
    pairs = [("haiku", m) for m in PANEL] + list(combinations(PANEL, 2))
    for a, b in pairs:
        c = compare(got[a], got[b], ids)
        rows.append(f"| {a} vs {b} | {c['firstTagShared']:.0%} | {c['sameFirstTag']:.0%} | {c['energyRho']:.2f} | {c['positivityRho']:.2f} |")
    spend = {m: sum(r["usage"]["usd"] for r in got[m].values()) for m in PANEL}
    rows += ["", "Cost of the panel: " + ", ".join(f"{m} ${usd:.3f}" for m, usd in spend.items()) + "."]
    return rows


def sheet_ids() -> list[str]:
    with LABELS.open() as f:
        return [r["id"] for r in csv.DictReader(f)]


def main() -> None:
    ids = sheet_ids()
    songs = {s["id"]: s for s in all_songs(catalogue())}
    for model in PANEL:
        for i in ids:
            print(model, songs[i]["title"], label(model, songs[i]).get("moods"), flush=True)
    print("\n".join(table(ids)))


if __name__ == "__main__":
    main()
