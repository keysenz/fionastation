"""Parsing of uploader-made caption tracks into timed translation lines."""

PREFERRED_LANGUAGES = ("id", "en")


def pick_language(languages: list[str]) -> str | None:
    """The track to use: `id`, then `en`, then the first. A regional `en-US` counts as `en`."""
    languages = [language for language in languages if language != "live_chat"]
    for wanted in PREFERRED_LANGUAGES:
        for language in languages:
            if language.split("-")[0] == wanted:
                return language
    return languages[0] if languages else None


def bottom_window(track: dict) -> int | None:
    """The window id of the lowest caption position, where a translation sits under a karaoke row of romaji."""
    positions = track.get("wpWinPositions", [])
    used = {event["wpWinPosId"] for event in track.get("events", []) if "segs" in event and "wpWinPosId" in event}
    if len(used) < 2:
        return None
    return max(used, key=lambda id: positions[id].get("avVerPos", 0) if id < len(positions) else 0)


def cues_from_json3(track: dict) -> list[tuple[int, int, str]]:
    """(start, end, text) in milliseconds for each distinct caption that has text.

    A track with several windows is a karaoke row above the translation, so only
    the lowest window is read. YouTube repeats an event once per pen, which the
    set drops.
    """
    window = bottom_window(track)
    cues = set()
    for event in track.get("events", []):
        if "segs" not in event or "tStartMs" not in event:
            continue
        if window is not None and event.get("wpWinPosId") != window:
            continue
        text = " ".join("".join(seg.get("utf8", "") for seg in event["segs"]).replace("\u200b", "").split())
        if text:
            start = event["tStartMs"]
            cues.add((start, start + event.get("dDurationMs", 0), text))
    return sorted(cues)


def lines_from_cues(cues: list[tuple[int, int, str]], song_start_ms: int = 0) -> list[dict]:
    """Translation lines timed from the song's start.

    Where one caption ends before the next starts, an empty line marks the gap,
    as in the sung lyrics. A caption that overlaps the next one is cut off by it.
    """
    lines: list[dict] = []
    previous_end: int | None = None
    for start, end, text in sorted(cues):
        if end <= song_start_ms:
            continue
        at = max(start - song_start_ms, 0)
        if previous_end is not None and previous_end < at:
            lines.append({"atMs": previous_end, "text": ""})
        if lines and lines[-1]["atMs"] == at:
            lines.pop()
        lines.append({"atMs": at, "text": text})
        previous_end = end - song_start_ms
    if previous_end is not None:
        lines.append({"atMs": previous_end, "text": ""})
    return lines
