"""Union the timed lyrics two or more workers wrote into one file.

Each worker starts from the same file and only adds entries for its own share
of the catalog, so a plain union by song id is the merge: no key is ever
written by two workers.

    ~/.cache/fiona-lyrics-align/venv/bin/python merge_shards.py \\
        ../../server/lyrics-aligned.json ../../server/lyrics-aligned.a.json ...
"""

import json
import sys
from pathlib import Path


def merge(target: Path, shards: list[Path]) -> int:
    entries = json.loads(target.read_text()) if target.exists() else {}
    added = 0
    for path in shards:
        if not path.exists():
            print(f"missing shard {path}, skipping")
            continue
        for song_id, entry in json.loads(path.read_text()).items():
            if song_id not in entries:
                added += 1
            entries[song_id] = entry
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(target)
    return added


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(f"usage: {argv[0]} <target> <shard> [<shard> ...]", file=sys.stderr)
        return 2
    target = Path(argv[1])
    added = merge(target, [Path(arg) for arg in argv[2:]])
    total = len(json.loads(target.read_text()))
    print(f"merged {len(argv) - 2} shards into {target}: {added} new entries, {total} total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
