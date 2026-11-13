import re
from dataclasses import dataclass
from statistics import median

MIN_DURATION_MS = 300
SUNG_PROB = 0.3
WEAK_PROB = 0.15
MAX_WEAK_RUN = 3
MIN_LINES = 4
MIN_MEDIAN_PROB = 0.5


@dataclass(frozen=True)
class LrcLine:
    at_ms: int
    text: str


@dataclass(frozen=True)
class Segment:
    start_ms: int
    dur_ms: int
    prob: float


@dataclass(frozen=True)
class Kept:
    indices: list[int]


@dataclass(frozen=True)
class Rejected:
    reason: str


LRC_STAMP = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")


def parse_lrc(text: str) -> list[LrcLine]:
    lines = []
    for row in text.splitlines():
        stamps = list(LRC_STAMP.finditer(row))
        if not stamps or stamps[0].start() != 0:
            continue
        rest = row[stamps[-1].end():].strip()
        for stamp in stamps:
            minutes, seconds, fraction = stamp.groups()
            at_ms = (int(minutes) * 60 + int(seconds)) * 1000
            if fraction is not None:
                at_ms += round(float(f"0.{fraction}") * 1000)
            lines.append(LrcLine(at_ms, rest))
    return sorted(lines, key=lambda line: line.at_ms)


def sung_lines(lines: list[LrcLine]) -> list[LrcLine]:
    return [line for line in lines if line.text.strip()]


def keep(segments: list[Segment]) -> Kept | Rejected:
    """Indices of the segments Fiona sang, or why the song is rejected.

    The aligner squeezes text that was never sung into a sliver, and it gives a
    sung line a low probability now and then.
    """
    survivors = [i for i, s in enumerate(segments) if s.dur_ms >= MIN_DURATION_MS]
    strong = [i for i in survivors if segments[i].prob >= SUNG_PROB]
    if not strong:
        return Rejected("no line was sung clearly")
    span = [i for i in survivors if strong[0] <= i <= strong[-1]]
    run = 0
    for i in span:
        run = run + 1 if segments[i].prob < WEAK_PROB else 0
        if run >= MAX_WEAK_RUN:
            return Rejected(f"{MAX_WEAK_RUN} weak lines in a row, a section was probably skipped")
    if len(span) < MIN_LINES:
        return Rejected(f"only {len(span)} lines were sung")
    middle = median(segments[i].prob for i in span)
    if middle < MIN_MEDIAN_PROB:
        return Rejected(f"median probability {middle:.2f} is too low")
    return Kept(span)


def aligned_lines(
    lines: list[LrcLine], segments: list[Segment], kept: Kept
) -> list[dict]:
    sung_positions = [i for i, line in enumerate(lines) if line.text.strip()]
    retimed = {sung_positions[k]: segments[k].start_ms for k in kept.indices}
    return breaks_follow_the_line_before(lines, retimed)


def breaks_follow_the_line_before(lines: list[LrcLine], retimed: dict[int, int]) -> list[dict]:
    out: list[dict] = []
    shift: int | None = None
    pending_break: int | None = None
    for position, line in enumerate(lines):
        if position in retimed:
            if pending_break is not None and pending_break < retimed[position]:
                out.append({"atMs": pending_break, "text": ""})
            pending_break = None
            shift = retimed[position] - line.at_ms
            out.append({"atMs": retimed[position], "text": line.text})
        elif not line.text.strip() and shift is not None:
            pending_break = line.at_ms + shift
    return out
