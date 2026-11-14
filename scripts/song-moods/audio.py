import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np

SAMPLE_RATE = 22050
TAIL_AFTER_LAST_LINE_S = 8
NO_LYRICS_WINDOW_S = 240
MAX_WINDOW_S = 420
CACHE_NAME = "song-moods-audio.json"


def window_s(last_line_ms: int | None) -> float:
    if last_line_ms is None:
        return NO_LYRICS_WINDOW_S
    return min(last_line_ms / 1000 + TAIL_AFTER_LAST_LINE_S, MAX_WINDOW_S)


def measure(mix: Path, seconds: float) -> dict:
    y, sr = librosa.load(mix, sr=SAMPLE_RATE, mono=True, duration=seconds)
    rms = librosa.feature.rms(y=y)[0]
    db = 20 * np.log10(rms + 1e-6)
    active = db > np.percentile(db, 20)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, units="time")
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    harmonic, percussive = librosa.effects.hpss(y)
    return {
        "seconds": round(len(y) / sr, 1),
        "tempoBpm": round(float(np.atleast_1d(tempo)[0]), 1),
        "loudnessDb": round(float(db[active].mean()), 2),
        "brightnessHz": round(float(np.median(centroid[active])), 0),
        "onsetsPerS": round(len(onsets) / (len(y) / sr), 2),
        "percussiveShare": round(float(np.sum(percussive**2) / (np.sum(harmonic**2) + np.sum(percussive**2))), 3),
    }


def features(work: Path, last_line_ms: int | None) -> dict:
    cache = work / CACHE_NAME
    seconds = window_s(last_line_ms)
    if cache.exists():
        got = json.loads(cache.read_text())
        if got.get("window") == seconds:
            return got["features"]
    started = time.monotonic()
    got = {**measure(work / "seg.wav", seconds), "measureSeconds": round(time.monotonic() - started, 1)}
    cache.write_text(json.dumps({"window": seconds, "features": got}))
    return got


ENERGY_INPUTS = ("tempoBpm", "loudnessDb", "brightnessHz", "onsetsPerS", "percussiveShare")


def audio_energy(rows: list[dict]) -> list[float]:
    """Mean percentile rank of the energy inputs across this set of songs, so 0..1 is relative to the set."""
    ranks = []
    for key in ENERGY_INPUTS:
        values = np.array([row[key] for row in rows], dtype=float)
        ranks.append(values.argsort().argsort() / max(1, len(values) - 1))
    return [round(float(v), 3) for v in np.mean(ranks, axis=0)]


if __name__ == "__main__":
    print(json.dumps(features(Path(sys.argv[1]), int(sys.argv[2]) if len(sys.argv) > 2 else None), indent=1))
