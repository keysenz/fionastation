import json
import unittest
from pathlib import Path

from keep import Kept, LrcLine, Rejected, Segment, aligned_lines, keep, parse_lrc, sung_lines

FIXTURES = Path(__file__).parent / "fixtures"


def spike(name: str) -> tuple[list[LrcLine], list[Segment]]:
    data = json.loads((FIXTURES / f"{name}.json").read_text())
    lines = [LrcLine(l["atMs"], l["text"]) for l in data["lines"]]
    segments = [Segment(s["startMs"], s["durMs"], s["prob"]) for s in data["segments"]]
    return lines, segments


def served(name: str) -> list[dict]:
    lines, segments = spike(name)
    verdict = keep(segments)
    assert isinstance(verdict, Kept), verdict
    return aligned_lines(lines, segments, verdict)


def sung_texts(lines: list[dict]) -> list[str]:
    return [l["text"] for l in lines if l["text"].strip()]


def segments(*probs: float, dur_ms: int = 2000) -> list[Segment]:
    return [Segment(i * 3000, dur_ms, p) for i, p in enumerate(probs)]


class SpikeSongs(unittest.TestCase):
    def test_pretender_short_keeps_the_first_24_lines_and_moves_them_earlier(self):
        lines, _ = spike("pretender")
        out = served("pretender")
        self.assertEqual(sung_texts(out), [l.text for l in sung_lines(lines)[:24]])
        self.assertEqual(out[-1]["text"], "「君は綺麗だ」")
        self.assertEqual(out[0]["atMs"], 4380)

    def test_betelgeuse_keeps_every_line(self):
        lines, _ = spike("betelgeuse")
        self.assertEqual(sung_texts(served("betelgeuse")), [l.text for l in sung_lines(lines)])

    def test_blue_jeans_short_keeps_the_verse_she_sang(self):
        texts = sung_texts(served("blue_jeans"))
        self.assertEqual(texts[0], "Itsu datte jishin ga nakute")
        self.assertEqual(texts[-1], "Kirei hina hitoda, blue jeans, furui suniikaa")

    def test_served_lines_are_in_time_order(self):
        for name in ["pretender", "betelgeuse", "blue_jeans"]:
            times = [l["atMs"] for l in served(name)]
            self.assertEqual(times, sorted(times), name)


class Rules(unittest.TestCase):
    def test_a_squeezed_line_is_dropped_even_when_confident(self):
        segs = segments(0.9, 0.9, 0.9, 0.9, 0.9)
        segs[2] = Segment(segs[2].start_ms, 100, 0.99)
        self.assertEqual(keep(segs), Kept([0, 1, 3, 4]))

    def test_weak_lines_outside_the_sung_span_are_cut(self):
        self.assertEqual(keep(segments(0.1, 0.2, 0.8, 0.7, 0.9, 0.6, 0.25, 0.05)), Kept([2, 3, 4, 5]))

    def test_a_weak_line_inside_the_span_stays(self):
        self.assertEqual(keep(segments(0.8, 0.05, 0.7, 0.9, 0.6)), Kept([0, 1, 2, 3, 4]))

    def test_three_weak_lines_in_a_row_reject_the_song(self):
        verdict = keep(segments(0.8, 0.9, 0.1, 0.1, 0.1, 0.9, 0.8, 0.7, 0.9))
        self.assertIsInstance(verdict, Rejected)

    def test_two_weak_lines_in_a_row_do_not(self):
        self.assertIsInstance(keep(segments(0.8, 0.9, 0.1, 0.1, 0.9, 0.8, 0.7, 0.9)), Kept)

    def test_too_few_lines_reject_the_song(self):
        self.assertIsInstance(keep(segments(0.1, 0.9, 0.9, 0.9, 0.1)), Rejected)

    def test_a_low_median_rejects_the_song(self):
        self.assertIsInstance(keep(segments(0.35, 0.4, 0.2, 0.45, 0.9)), Rejected)

    def test_nothing_sung_rejects_the_song(self):
        self.assertIsInstance(keep(segments(0.1, 0.2, 0.1, 0.05)), Rejected)


class Blanks(unittest.TestCase):
    def test_a_blank_between_kept_lines_moves_with_the_line_before_it(self):
        lines = [LrcLine(10_000, "a"), LrcLine(12_000, ""), LrcLine(20_000, "b")]
        segs = [Segment(4_000, 1500, 0.9), Segment(13_000, 1500, 0.9)]
        self.assertEqual(
            aligned_lines(lines, segs, Kept([0, 1])),
            [{"atMs": 4_000, "text": "a"}, {"atMs": 6_000, "text": ""}, {"atMs": 13_000, "text": "b"}],
        )

    def test_blanks_outside_the_kept_lines_are_dropped(self):
        lines = [LrcLine(0, ""), LrcLine(10_000, "a"), LrcLine(20_000, "b"), LrcLine(30_000, "")]
        segs = [Segment(4_000, 1500, 0.9), Segment(14_000, 1500, 0.9)]
        self.assertEqual(sung_texts(aligned_lines(lines, segs, Kept([0, 1]))), ["a", "b"])
        self.assertEqual(len(aligned_lines(lines, segs, Kept([0, 1]))), 2)


class Lrc(unittest.TestCase):
    def test_a_row_with_two_stamps_becomes_two_lines_in_time_order(self):
        self.assertEqual(
            parse_lrc("[00:30.00][01:30.50]chorus\n[01:00.00]verse\nnot a line"),
            [LrcLine(30_000, "chorus"), LrcLine(60_000, "verse"), LrcLine(90_500, "chorus")],
        )


if __name__ == "__main__":
    unittest.main()
