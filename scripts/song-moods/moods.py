import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


Mood = Literal["ceria", "galau", "hype", "chill", "romantis", "sendu"]
Theme = Literal["birthday", "anniversary", "late-night", "debut", "collab", "seasonal", "cover-release", "regular-karaoke", "original-release"]


JS_LANE = [str(Path.home() / ".cache" / "fiona-limits" / "capped"), "4G", "0-3"]


class SongMood(BaseModel):
    moods: list[Mood] = Field(description="1 or 2 tags, the strongest first")
    energy: float = Field(description="0 = calm, 1 = energetic, as the song sounds, not only what the words say")
    positivity: float = Field(description="0 = sad, 1 = happy")
    reason: str = Field(description="one line, in English")


class StreamTheme(BaseModel):
    themes: list[Theme] = Field(description="1 or 2 tags, the strongest first")
    reason: str = Field(description="one line, in English")


SONG_SYSTEM = """You tag the mood of songs that an Indonesian VTuber, Fiona, sings on stream. Lyrics may be Indonesian, Japanese, Korean or English.

Mood tags, as an Indonesian listener uses them:
- ceria: cheerful, bright, upbeat in feeling
- galau: heartache, longing, confused about love, overthinking a relationship
- hype: high energy, pumped, anthemic, makes you move or shout along
- chill: relaxed, easy, laid-back, background-friendly
- romantis: tender love, affection, falling for someone
- sendu: melancholic, gloomy, grief or quiet sadness that is not about romance

Use what you know about the song and artist as well as the lyrics. Energy is how energetic the song sounds (tempo, arrangement), positivity is how happy it feels. Clamp both to 0..1."""

THEME_SYSTEM = """You tag the theme of a whole stream or video by Fiona, an Indonesian VTuber. You get the video title, its kind, when it was published (UTC; Fiona's viewers are in UTC+7), and the songs sung in it.

Themes: birthday, anniversary, late-night (a stream starting roughly 22:00 to 03:00 UTC+7, or titled as one), debut, collab, seasonal (a holiday or season), cover-release (a produced song cover upload), regular-karaoke (an ordinary singing stream), original-release (her own song). Pick from the title first and the setlist second."""


class Haiku:
    """Calls Haiku through a headless Claude Code session, so it runs on the user's Claude login with no API key."""

    def __init__(self) -> None:
        self.last: dict = {}

    def ask(self, system: str, prompt: str, schema: type[BaseModel]) -> BaseModel | None:
        started = time.monotonic()
        done = subprocess.run(
            [*JS_LANE, "claude", "-p", "--model", "haiku", "--output-format", "json", "--tools", "", "--no-session-persistence",
             "--settings", '{"disableAllHooks":true}', "--system-prompt", system,
             "--json-schema", json.dumps(schema.model_json_schema()), prompt],
            capture_output=True, text=True, check=True, cwd=tempfile.gettempdir(),
        )
        answer = json.loads(done.stdout)
        usage = answer["usage"]
        self.last = {
            "model": next(iter(answer["modelUsage"])),
            "inputTokens": usage["input_tokens"] + usage["cache_creation_input_tokens"] + usage["cache_read_input_tokens"],
            "outputTokens": usage["output_tokens"],
            "usd": answer["total_cost_usd"],
            "seconds": round(time.monotonic() - started, 2),
        }
        if answer.get("is_error") or "structured_output" not in answer:
            return None
        return schema.model_validate(answer["structured_output"])


def song_prompt(song: dict, lyrics: dict) -> str:
    text = "\n".join(lyrics["lines"]) if lyrics["lines"] else "(no lyrics available)"
    return f"Title: {song['title']}\nArtist: {song['artist']}\n\nLyrics:\n{text}"


def theme_prompt(video: dict) -> str:
    setlist = "\n".join(f"- {s['song_title']} / {s['artist']}" for s in video["karaoke_song"])
    return f"Title: {video['video_title']}\nKind: {video['kind']}\nPublished: {video['published_at']}\n\nSongs:\n{setlist}"


def clamp(mood: SongMood) -> SongMood:
    return mood.model_copy(update={
        "moods": list(dict.fromkeys(mood.moods))[:2],
        "energy": min(1.0, max(0.0, mood.energy)),
        "positivity": min(1.0, max(0.0, mood.positivity)),
    })
