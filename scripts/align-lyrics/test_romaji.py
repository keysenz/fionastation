import unittest

from romaji import romanized, to_latin


class Words(unittest.TestCase):
    def test_latin_text_is_untouched(self):
        self.assertEqual(to_latin("Itsu datte jishin ga nakute"), "Itsu datte jishin ga nakute")

    def test_kana_becomes_romaji(self):
        self.assertEqual(to_latin("それは予想通り"), "Sore wa yosou toori")

    def test_kanji_becomes_romaji(self):
        self.assertEqual(to_latin("君の心へ"), "Kimi no kokoro e")

    def test_korean_becomes_romaji(self):
        self.assertEqual(to_latin("바보야, 오늘은 안된다고"), "baboya, oneureun andoendago")

    def test_korean_and_english_on_one_line(self):
        self.assertEqual(to_latin("You are my 사랑"), "You are my sarang")

    def test_punctuation_around_japanese_survives(self):
        self.assertEqual(to_latin("「君は綺麗だ」"), '"kimi wa kirei da"')

    def test_other_scripts_fall_back_to_unidecode(self):
        self.assertEqual(to_latin("Привет мир"), "Privet mir")

    def test_running_twice_changes_nothing(self):
        once = to_latin("空にある何かを見つめてたら")
        self.assertEqual(to_latin(once), once)


class Served(unittest.TestCase):
    def test_blank_breaks_stay_blank(self):
        lines = [{"atMs": 0, "text": ""}, {"atMs": 1000, "text": "君の心へ"}]
        self.assertEqual(
            romanized(lines),
            [{"atMs": 0, "text": ""}, {"atMs": 1000, "text": "Kimi no kokoro e"}],
        )

    def test_a_line_that_romanizes_to_nothing_is_dropped(self):
        lines = [{"atMs": 0, "text": "♪"}, {"atMs": 1000, "text": "夢の中"}]
        self.assertEqual(romanized(lines), [{"atMs": 1000, "text": "Yume no naka"}])


if __name__ == "__main__":
    unittest.main()
