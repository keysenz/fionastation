import unittest

import io
import subprocess
import urllib.error
from contextlib import redirect_stdout
from unittest import mock

from align import attempt, fetch_json, songs_from


def video(url: str, songs: list[tuple[str, str, str]], gone: bool = False, membership: bool = False) -> dict:
    return {
        "membership": membership,
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

    def test_a_membership_video_contributes_no_songs(self):
        songs = songs_from([
            video("members", [("a", "One", "00:00:00")], membership=True),
            video("free", [("b", "Two", "00:00:00")]),
        ])
        self.assertEqual([s["id"] for s in songs], ["b"])

    def test_a_video_without_the_flag_is_kept(self):
        songs = songs_from([video("v1", [("a", "One", "00:00:00")])])
        self.assertEqual([s["id"] for s in songs], ["a"])


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("http://x", code, "err", {}, None)


def response(body: bytes):
    reply = mock.MagicMock()
    reply.__enter__.return_value = io.BytesIO(body)
    return reply


class Fetch(unittest.TestCase):
    def fetch(self, outcomes):
        sleeps = []
        with mock.patch("urllib.request.urlopen", side_effect=outcomes) as opened, redirect_stdout(io.StringIO()):
            try:
                body = fetch_json("http://x", sleep=sleeps.append)
            except Exception as error:
                body = error
        return body, opened.call_count, sleeps

    def test_a_502_is_retried_and_the_next_answer_is_returned(self):
        body, calls, sleeps = self.fetch([http_error(502), response(b'{"ok": 1}')])
        self.assertEqual(body, {"ok": 1})
        self.assertEqual(calls, 2)
        self.assertEqual(sleeps[0], 5)

    def test_a_404_raises_without_a_retry(self):
        body, calls, _ = self.fetch([http_error(404), response(b"{}")])
        self.assertIsInstance(body, urllib.error.HTTPError)
        self.assertEqual(calls, 1)

    def test_a_connection_that_never_recovers_gives_up(self):
        body, calls, _ = self.fetch([ConnectionResetError()] * 10)
        self.assertIsInstance(body, ConnectionResetError)
        self.assertEqual(calls, 6)


class Failures(unittest.TestCase):
    def test_after_one_song_fails_the_rest_of_its_video_is_not_run(self):
        failed: set[str] = set()
        calls = []

        def run_for(song):
            def run():
                calls.append(song["id"])
                raise subprocess.CalledProcessError(1, "yt-dlp")
            return run

        songs = [
            {"id": "a", "video": "members"},
            {"id": "b", "video": "members"},
            {"id": "c", "video": "other"},
        ]
        with redirect_stdout(io.StringIO()):
            results = [attempt(song, failed, run_for(song)) for song in songs]
        self.assertEqual(calls, ["a", "c"])
        self.assertEqual(results, [None, None, None])
        self.assertEqual(failed, {"members", "other"})


if __name__ == "__main__":
    unittest.main()
