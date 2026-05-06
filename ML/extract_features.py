import sys
import librosa
import numpy as np
import os



def extract_tempo(audio_file):
    y, sr = librosa.load(audio_file, sr=22050)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return float(np.asarray(tempo).flatten()[0])


def extract_rhythm_features(y, sr):
    """
    Extract 16 rhythm-specific features from an audio clip.

    Features:
        ioi_mean, ioi_std, ioi_min, ioi_max, ioi_cv  — IOI statistics
        ioi_slope     — linear trend of IOIs (kept as supporting signal)
        tempo         — BPM estimated by librosa beat tracker on full clip
        beat_dev_mean, beat_dev_std, beat_dev_max  — deviation from ideal linear grid
        onset_density — onsets per second
        n_onsets      — raw onset count
        duration      — clip length in seconds
        tempo_start   — BPM estimated on the first half of the clip
        tempo_end     — BPM estimated on the second half of the clip
        tempo_delta   — tempo_end - tempo_start  (positive = rushing, negative = dragging)

    Returns a float32 array of shape (16,). Returns zeros if fewer than 3
    onsets are detected (clip too quiet / too short to analyse).
    """
    duration = len(y) / sr

    onsets = librosa.onset.onset_detect(y=y, sr=sr, units='time')
    n_onsets = len(onsets)
    onset_density = n_onsets / duration if duration > 0 else 0.0

    if n_onsets < 3:
        return np.zeros(16, dtype=np.float32)

    iois = np.diff(onsets)
    ioi_mean = float(np.mean(iois))
    ioi_std  = float(np.std(iois))
    ioi_min  = float(np.min(iois))
    ioi_max  = float(np.max(iois))
    ioi_cv   = ioi_std / (ioi_mean + 1e-8)

    ioi_slope = float(np.polyfit(np.arange(len(iois)), iois, 1)[0])

    tempo_raw, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.asarray(tempo_raw).flatten()[0])

    # Fit a perfectly regular grid to onset positions; residuals capture
    # random timing errors (large for off_rhythm, small for the rest)
    idx = np.arange(n_onsets, dtype=float)
    fitted = np.polyval(np.polyfit(idx, onsets, 1), idx)
    residuals = onsets - fitted
    beat_dev_mean = float(np.mean(np.abs(residuals)))
    beat_dev_std  = float(np.std(residuals))
    beat_dev_max  = float(np.max(np.abs(residuals)))

    # Within-chunk tempo change: split clip in half and estimate BPM on each.
    # tempo_delta directly measures acceleration (rushed > 0) or
    # deceleration (dragging < 0) without relying on noisy IOI slope.
    mid = len(y) // 2
    t_start_raw, _ = librosa.beat.beat_track(y=y[:mid], sr=sr)
    t_end_raw,   _ = librosa.beat.beat_track(y=y[mid:], sr=sr)
    tempo_start = float(np.asarray(t_start_raw).flatten()[0])
    tempo_end   = float(np.asarray(t_end_raw).flatten()[0])
    tempo_delta = tempo_end - tempo_start

    return np.array([
        ioi_mean, ioi_std, ioi_min, ioi_max, ioi_cv, ioi_slope,
        tempo,
        beat_dev_mean, beat_dev_std, beat_dev_max,
        onset_density, float(n_onsets), duration,
        tempo_start, tempo_end, tempo_delta,
    ], dtype=np.float32)


def chunk_audio(y, sr, chunk_duration=3):
    chunk_size = sr * chunk_duration
    chunks = []
    for start in range(0, len(y), chunk_size):
        chunks.append(y[start:start + chunk_size])
    return chunks