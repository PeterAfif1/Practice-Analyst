import sys
import librosa
import numpy as np
import os
import torch
from transformers import Wav2Vec2Processor, Wav2Vec2Model


_processor = None
_model = None


def _get_model():
    global _processor, _model
    if _processor is None:
        sys.stderr.write("loading pretrained Wav2Vec2 (first time only, ~95MB)...\n")
        _processor = Wav2Vec2Processor.from_pretrained("facebook/wav2vec2-base")
        _model = Wav2Vec2Model.from_pretrained("facebook/wav2vec2-base")
        _model.eval()
    return _processor, _model


def _extract_embeddings(y, sr):

    processor, model = _get_model()

    if sr != 16000:
        y = librosa.resample(y, orig_sr=sr, target_sr=16000)
        sr = 16000

    inputs = processor(y, sampling_rate=sr, return_tensors="pt", padding=True)

    with torch.no_grad():
        outputs = model(**inputs)

    embeddings = outputs.last_hidden_state.mean(dim=1).squeeze().numpy()
    return embeddings


def extract_features_from_file(audio_file):
    y, sr = librosa.load(audio_file, sr=16000)
    return _extract_embeddings(y, sr)


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


def load_dataset():
    categories = {
        'correct': 'correct',
        'flat': 'flat',
        'sharp': 'sharp',
        'off_rhythm': 'off_rhythm'
    }

    X = []
    y = []

    base_dir = os.path.dirname(os.path.abspath(__file__))

    for folder, label in categories.items():
        folder_path = os.path.join(base_dir, 'data', folder)

        print(f"looking for data at: {folder_path}")

        files = os.listdir(folder_path)
        print(f"loading {len(files)} files from {folder_path}...")

        for filename in files:
            if filename.endswith('.wav'):
                filepath = os.path.join(folder_path, filename)

                try:
                    audio, sr = librosa.load(filepath, sr=16000)

                    chunks = chunk_audio(audio, sr, chunk_duration=1)

                    print(f"  {filename} → {len(chunks)} chunks")

                    for chunk in chunks:
                        features = _extract_embeddings(chunk, sr)
                        X.append(features)
                        y.append(label)

                except Exception as e:
                    print(f"error processing {filename}: {e}")
                    import traceback
                    traceback.print_exc()

    X = np.array(X)
    y = np.array(y)

    print("\ndone loading dataset")
    print(f"X shape: {X.shape}")
    print(f"y shape: {y.shape}")

    return X, y


if __name__ == "__main__":
    X, y = load_dataset()
    print("\nsample embedding (first 10 dims):")
    print(X[0][:10])
    print("\nlabel:", y[0])
