import unittest

from align import songs_from


def video(url: str, songs: list[tuple[str, str, str]], gone: bool = False) -> dict:
    return {
        "video_url": url,
        "is_gone": gone,
        "karaoke_song": [
            {"id": song_id, "song_title": title, "timestamp": stamp}
            for song_id, title, stamp in songs
        ],
    }


class Songs(unittest.TestCase):
    def test_songs_span_from_their_stamp_to_the_next_song(self):
        songs = songs_from([
            video("v1", [("a", "One", "00:10:00"), ("b", "Two", "00:14:30")]),
        ])
        self.assertEqual(
            [(s["id"], s["start"], s["end"]) for s in songs],
            [("a", 600, 870), ("b", 870, None)],
        )

    def test_songs_are_ordered_by_their_stamp(self):
        songs = songs_from([
            video("v1", [("b", "Two", "00:04:00"), ("a", "One", "00:01:00")]),
        ])
        self.assertEqual([s["id"] for s in songs], ["a", "b"])

    def test_a_gone_video_contributes_no_songs(self):
        songs = songs_from([
            video("dead", [("a", "One", "00:00:00")], gone=True),
            video("live", [("b", "Two", "00:00:00")]),
        ])
        self.assertEqual([s["id"] for s in songs], ["b"])

    def test_a_video_without_the_flag_is_kept(self):
        songs = songs_from([video("v1", [("a", "One", "00:00:00")])])
        self.assertEqual([s["id"] for s in songs], ["a"])


if __name__ == "__main__":
    unittest.main()
