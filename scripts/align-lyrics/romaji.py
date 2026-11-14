"""Latin-script lines for lyrics that LRCLIB serves in kana, kanji or hangul.

The song list shows only romaji, so a line is romanized once its timing is
settled. Japanese goes through pykakasi (Hepburn), Korean through
korean-romanizer (revised romanization), and any other script falls back to
Unidecode. Latin text passes through untouched, so a second pass changes
nothing.

Run it on an existing file to romanize lines an older run wrote:

    ~/.cache/fiona-lyrics-align/venv/bin/python romaji.py ../../server/lyrics-aligned.json
"""

import json
import re
import sys
from pathlib import Path

import cutlet
import unidecode
from korean_romanizer.romanizer import Romanizer

JAPANESE = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
HANGUL = re.compile(r"[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7af]+")
NON_LATIN = re.compile(r"[^\x00-\x7f\u00c0-\u024f\u1e00-\u1eff]+")

# Full-width and CJK punctuation becomes the ASCII mark with the same job, so
# a line never keeps a character outside the Latin block.
PUNCTUATION = str.maketrans({
    "「": '"', "」": '"', "『": '"', "』": '"',
    "、": ",", "。": ".", "・": " ", "〜": "~", "～": "~",
    "！": "!", "？": "?", "：": ":", "；": ";",
    "（": "(", "）": ")", "〈": "<", "〉": ">", "《": "<", "》": ">",
    "【": "[", "】": "]", "…": "...", "‥": "..", "—": "-",
})

KAKASI = cutlet.Cutlet()
KAKASI.use_foreign_spelling = False


def to_latin(text: str) -> str:
    """`text` with every non-Latin letter romanized and punctuation left alone."""
    text = HANGUL.sub(_korean, text)
    text = JAPANESE.sub(_japanese, text)
    text = text.translate(PUNCTUATION)
    text = NON_LATIN.sub(_other, text)
    return re.sub(r"\s+", " ", text).strip()


def _japanese(match: re.Match[str]) -> str:
    roman = KAKASI.romaji(match.group())
    if match.start() > 0 and roman[:1].isupper():
        roman = roman[:1].lower() + roman[1:]
    return roman


def _korean(match: re.Match[str]) -> str:
    return Romanizer(match.group()).romanize()


def _other(match: re.Match[str]) -> str:
    return unidecode.unidecode(match.group())


def romanized(lines: list[dict]) -> list[dict]:
    """The served lines with their text in Latin script.

    A line that romanizes to nothing is dropped, because an empty text is how
    the file marks a break. Blank lines stay blank.
    """
    out = []
    for line in lines:
        if not line["text"].strip():
            out.append(line)
            continue
        text = to_latin(line["text"])
        if text:
            out.append({**line, "text": text})
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} <lyrics-aligned.json>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    entries = json.loads(path.read_text())
    changed = 0
    for entry in entries.values():
        if entry.get("status") != "Aligned":
            continue
        before = entry.get("lines") or []
        after = romanized(before)
        if after != before:
            changed += 1
            entry["lines"] = after
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)
    print(f"romanized {changed} entries in {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
