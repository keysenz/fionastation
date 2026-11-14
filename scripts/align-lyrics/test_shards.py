import json
import tempfile
import unittest
from pathlib import Path

from align import shard_of
from merge_shards import merge


def songs(count: int) -> list[dict]:
    return [{"id": f"s{i}", "title": f"Song {i}"} for i in range(count)]


class Shards(unittest.TestCase):
    def test_two_workers_cover_every_song_once(self):
        catalog = songs(9)
        first = shard_of(catalog, 0, 2)
        second = shard_of(catalog, 1, 2)
        self.assertEqual([s["id"] for s in first], ["s0", "s2", "s4", "s6", "s8"])
        self.assertEqual([s["id"] for s in second], ["s1", "s3", "s5", "s7"])
        self.assertEqual(len(first) + len(second), len(catalog))
        self.assertEqual({s["id"] for s in first} & {s["id"] for s in second}, set())

    def test_three_workers_cover_every_song_once(self):
        catalog = songs(10)
        parts = [shard_of(catalog, index, 3) for index in range(3)]
        ids = [song["id"] for part in parts for song in part]
        self.assertEqual(sorted(ids), sorted(s["id"] for s in catalog))

    def test_one_worker_takes_everything(self):
        self.assertEqual(shard_of(songs(3), 0, 1), songs(3))


class Merge(unittest.TestCase):
    def write(self, directory: Path, name: str, entries: dict) -> Path:
        path = directory / name
        path.write_text(json.dumps(entries))
        return path

    def test_entries_from_every_shard_land_in_the_target(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            target = self.write(directory, "main.json", {"a": {"status": "Aligned"}})
            left = self.write(directory, "a.json", {"a": {"status": "Aligned"}, "b": {"status": "Aligned"}})
            right = self.write(directory, "b.json", {"c": {"status": "Rejected"}})
            self.assertEqual(merge(target, [left, right]), 2)
            self.assertEqual(sorted(json.loads(target.read_text())), ["a", "b", "c"])

    def test_a_missing_shard_is_skipped(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            target = self.write(directory, "main.json", {"a": {"status": "Aligned"}})
            self.assertEqual(merge(target, [directory / "nope.json"]), 0)
            self.assertEqual(sorted(json.loads(target.read_text())), ["a"])

    def test_the_merge_is_idempotent(self):
        with tempfile.TemporaryDirectory() as name:
            directory = Path(name)
            target = self.write(directory, "main.json", {})
            shard = self.write(directory, "a.json", {"b": {"status": "Aligned"}})
            merge(target, [shard])
            self.assertEqual(merge(target, [shard]), 0)


if __name__ == "__main__":
    unittest.main()
