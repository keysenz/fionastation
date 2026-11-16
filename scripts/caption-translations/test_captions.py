import unittest

from captions import cues_from_json3, lines_from_cues, pick_language


class PickLanguage(unittest.TestCase):
    def test_prefers_indonesian_then_english_then_first(self):
        self.assertEqual(pick_language(["en", "id", "ja"]), "id")
        self.assertEqual(pick_language(["ja", "en-US"]), "en-US")
        self.assertEqual(pick_language(["ja", "ko"]), "ja")

    def test_live_chat_is_not_a_track(self):
        self.assertIsNone(pick_language(["live_chat"]))
        self.assertEqual(pick_language(["live_chat", "ja"]), "ja")


class Lines(unittest.TestCase):
    def test_a_gap_between_captions_becomes_an_empty_line(self):
        lines = lines_from_cues([(1000, 3000, "a"), (5000, 7000, "b")])
        self.assertEqual(lines, [
            {"atMs": 1000, "text": "a"},
            {"atMs": 3000, "text": ""},
            {"atMs": 5000, "text": "b"},
            {"atMs": 7000, "text": ""},
        ])

    def test_touching_captions_have_no_gap_line(self):
        lines = lines_from_cues([(0, 2000, "a"), (2000, 4000, "b")])
        self.assertEqual([line["text"] for line in lines], ["a", "b", ""])

    def test_an_overlapping_caption_is_cut_off_by_the_next(self):
        lines = lines_from_cues([(0, 5000, "a"), (3000, 6000, "b")])
        self.assertEqual(lines, [
            {"atMs": 0, "text": "a"},
            {"atMs": 3000, "text": "b"},
            {"atMs": 6000, "text": ""},
        ])

    def test_times_count_from_the_song_start(self):
        lines = lines_from_cues([(61000, 63000, "a")], song_start_ms=60000)
        self.assertEqual(lines[0], {"atMs": 1000, "text": "a"})

    def test_no_cues_give_no_lines(self):
        self.assertEqual(lines_from_cues([]), [])


class Json3(unittest.TestCase):
    def test_reads_text_and_times_and_skips_empty_events(self):
        track = {"events": [
            {"tStartMs": 0, "dDurationMs": 100},
            {"tStartMs": 500, "dDurationMs": 1500, "segs": [{"utf8": "Hello\n"}, {"utf8": "world"}]},
            {"tStartMs": 2000, "dDurationMs": 10, "segs": [{"utf8": "\n"}]},
        ]}
        self.assertEqual(cues_from_json3(track), [(500, 2000, "Hello world")])

    def test_zero_width_spaces_are_dropped(self):
        track = {"events": [{"tStartMs": 0, "dDurationMs": 10, "segs": [{"utf8": "\u200b\u200b hai\u200b"}]}]}
        self.assertEqual(cues_from_json3(track), [(0, 10, "hai")])

    def test_a_karaoke_row_above_the_translation_is_left_out(self):
        track = {
            "wpWinPositions": [{}, {"avVerPos": 0}, {"avVerPos": 100}],
            "events": [
                {"tStartMs": 0, "dDurationMs": 50, "wpWinPosId": 1, "segs": [{"utf8": "romaji"}]},
                {"tStartMs": 0, "dDurationMs": 900, "wpWinPosId": 2, "segs": [{"utf8": "arti"}]},
                {"tStartMs": 0, "dDurationMs": 900, "wpWinPosId": 2, "segs": [{"utf8": "arti"}]},
            ],
        }
        self.assertEqual(cues_from_json3(track), [(0, 900, "arti")])


if __name__ == "__main__":
    unittest.main()
