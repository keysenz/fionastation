import csv
import hashlib
import json
import re

from scipy.stats import spearmanr

from songs import HERE, RESULTS

DOC = HERE / "PROTOTYPE-RESULTS.md"
LABELS = HERE / "labels.csv"
LABEL_COUNT = 20
START, END = "<!-- generated:start -->", "<!-- generated:end -->"
LABEL_FIELDS = ["id", "title", "artist", "link", "moods", "energy_1to5", "positivity_1to5", "labeler", "note"]


def link(row: dict) -> str:
    return f"https://www.youtube.com/watch?v={row['video']}&t={row['start']}s"


def label_rows(rows: list[dict]) -> list[dict]:
    """A fixed, unbiased draw: one take per title, ordered by a hash of the song id."""
    seen, firsts = set(), []
    for row in rows:
        if row["title"] not in seen:
            seen.add(row["title"])
            firsts.append(row)
    return sorted(firsts, key=lambda r: hashlib.sha1(r["id"].encode()).hexdigest())[:LABEL_COUNT]


def write_sheet(rows: list[dict]) -> None:
    if LABELS.exists():
        return
    with LABELS.open("w", newline="") as f:
        writer = csv.DictWriter(f, LABEL_FIELDS)
        writer.writeheader()
        for row in label_rows(rows):
            writer.writerow({"id": row["id"], "title": row["title"], "artist": row["artist"], "link": link(row)})


def read_labels() -> list[dict]:
    with LABELS.open() as f:
        return [r for r in csv.DictReader(f) if r["moods"].strip()]


def cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def song_table(rows: list[dict]) -> list[str]:
    out = ["| Song | Link | Mood tags | Energy (text) | Positivity (text) | Tempo BPM | Loudness dB | Audio energy | Text − audio | Reason |",
           "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        t = r.get("text", {})
        flag = f"**{r['disagreement']:+.2f}**" if r.get("flagged") else (f"{r['disagreement']:+.2f}" if "disagreement" in r else "")
        out.append(f"| {cell(r['title'])} / {cell(r['artist'])} | [{r['start']}s]({link(r)}) | {', '.join(t.get('moods', []))} | "
                   f"{t.get('energy', '')} | {t.get('positivity', '')} | {r['audio']['tempoBpm']} | {r['audio']['loudnessDb']} | "
                   f"{r['audioEnergy']} | {flag} | {cell(t.get('reason', ''))} |")
    return out


def theme_table(themes: dict) -> list[str]:
    out = ["| Video | Kind | Published (UTC) | Themes | Reason |", "| --- | --- | --- | --- | --- |"]
    for v in sorted(themes.values(), key=lambda v: v["publishedAt"]):
        out.append(f"| [{cell(v['title'][:70])}](https://www.youtube.com/watch?v={v['video']}) | {v['kind']} | {v['publishedAt'][:16]} | "
                   f"{', '.join(v.get('themes', []))} | {cell(v.get('reason', ''))} |")
    return out


def agreement(rows: list[dict], labels: list[dict]) -> list[str]:
    by_id = {r["id"]: r for r in rows}
    pairs = [(by_id[l["id"]], l) for l in labels if l["id"] in by_id and "moods" in by_id[l["id"]].get("text", {})]
    if not pairs:
        return ["No labels yet. Fill in `labels.csv` and rerun `report.py`."]
    human = [[m.strip() for m in re.split(r"[,;/ ]+", l["moods"]) if m.strip()] for _, l in pairs]
    model = [r["text"]["moods"] for r, _ in pairs]
    first_hit = sum(h[0] in m for h, m in zip(human, model)) / len(pairs)
    any_hit = sum(bool(set(h) & set(m)) for h, m in zip(human, model)) / len(pairs)
    energy_h = [float(l["energy_1to5"]) for _, l in pairs]
    positivity_h = [float(l["positivity_1to5"]) for _, l in pairs]
    rho = lambda a, b: f"{spearmanr(a, b).statistic:.2f}"
    return [
        f"{len(pairs)} songs labeled.",
        "",
        "| Measure | Value |", "| --- | --- |",
        f"| Human's first tag is among the model's tags | {first_hit:.0%} |",
        f"| Any tag shared | {any_hit:.0%} |",
        f"| Spearman, human energy vs text energy | {rho(energy_h, [r['text']['energy'] for r, _ in pairs])} |",
        f"| Spearman, human energy vs audio energy | {rho(energy_h, [r['audioEnergy'] for r, _ in pairs])} |",
        f"| Spearman, human positivity vs text positivity | {rho(positivity_h, [r['text']['positivity'] for r, _ in pairs])} |",
    ]


def panel_section() -> list[str]:
    from panel import PANEL, PANEL_DIR, sheet_ids, table
    ids = sheet_ids()
    if not all((PANEL_DIR / m / f"{i}.json").exists() for m in PANEL for i in ids):
        return ["Not run yet. Run `panel.py`."]
    return table(ids)


def main() -> None:
    data = json.loads((RESULTS / "moods.json").read_text())
    rows, run = data["rows"], data["run"]
    themes_path = RESULTS / "themes.json"
    themes = json.loads(themes_path.read_text()) if themes_path.exists() else {}
    write_sheet(rows)
    flagged = [r for r in rows if r.get("flagged")]
    sheet = list(csv.DictReader(LABELS.open()))
    lines = [
        START,
        "## Songs",
        "",
        f"{run['songs']} songs. Audio energy is the mean percentile rank of tempo, loudness, brightness, onset rate and percussive share "
        f"within this set, so 0 is the calmest song here and 1 the most energetic. A bold difference is at least 0.4 apart.",
        "",
        *song_table(rows),
        "",
        f"## Text and audio disagree ({len(flagged)})",
        "",
        *[f"- {r['title']} / {r['artist']}: text {r['text']['energy']}, audio {r['audioEnergy']} "
          f"({r['audio']['tempoBpm']} BPM, {r['audio']['loudnessDb']} dB, {r['audio']['percussiveShare']} percussive)." for r in flagged],
        "",
        "## Stream themes",
        "",
        *theme_table(themes),
        "",
        "## Labeling sheet",
        "",
        f"`labels.csv` holds these {len(sheet)} songs. Open each link, listen for a minute, and fill in `moods` (one or two of ceria, galau, "
        "hype, chill, romantis, sendu, strongest first), `energy_1to5` (1 calm, 5 energetic), `positivity_1to5` (1 sad, 5 happy) and `labeler`. "
        "Don't look at the model's tags first.",
        "",
        "| # | Song | Link |", "| --- | --- | --- |",
        *[f"| {i} | {cell(s['title'])} / {cell(s['artist'])} | {s['link']} |" for i, s in enumerate(sheet, 1)],
        "",
        "## Agreement with labels",
        "",
        *agreement(rows, read_labels()),
        "",
        "## Model panel (not ground truth)",
        "",
        "Opus 5.5, Fable 5.2 and Sonnet 5.5 each tagged the labeling-sheet songs blind, from the same prompt and lyrics Haiku got. "
        "This shows whether cheap Haiku agrees with stronger models, and how much strong models agree with each other. "
        "None of them hears the singing, so it does not replace human labels.",
        "",
        *panel_section(),
        "",
        "## Cost and runtime",
        "",
        "| Step | Calls | Total | Per song or video | Tokens in / out | Cost |", "| --- | --- | --- | --- | --- | --- |",
        f"| Audio features (CPU, cached stems) | {run['songs']} | {run['audioSeconds']} s | {run['audioSeconds'] / run['songs']:.1f} s | | $0 |",
        *[f"| {name} (Haiku 5.5 via `claude -p`) | {s['calls']} | {s['seconds']} s | {s['seconds'] / s['calls']:.2f} s | "
          f"{s['inputTokens']} / {s['outputTokens']} | ${s['usd']:.4f} (${s['usd'] / s['calls']:.5f} each) |"
          for name, s in ((n, run[n]) for n in ("songText", "streamTheme") if n in run)],
        END,
    ]
    text = DOC.read_text() if DOC.exists() else f"# Song mood prototype: results\n\n{START}\n{END}\n"
    head, rest = text.split(START, 1)
    DOC.write_text(head + "\n".join(lines) + rest.split(END, 1)[1])
    print(f"wrote {DOC.name}, {len(flagged)} flagged")


if __name__ == "__main__":
    main()
