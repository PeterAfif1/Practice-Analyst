import sys
import os
import json
import pickle
import numpy as np
import librosa
from collections import Counter

from extract_features import extract_rhythm_features, extract_tempo


SR             = 22050
CHUNK_SAMPLES  = SR * 3   # 3-second chunks — matches training
MIN_SAMPLES    = SR * 3   # require at least one full chunk
PAD_THRESHOLD  = SR       # pad final short chunk if >= 1 second


def load_model():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_path  = os.path.join(base_dir, 'models', 'model.pkl')
    scaler_path = os.path.join(base_dir, 'models', 'scaler.pkl')

    with open(model_path, 'rb') as f:
        model = pickle.load(f)
    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)

    return model, scaler


def analyze(audio_file):
    y, sr = librosa.load(audio_file, sr=SR)

    if len(y) < MIN_SAMPLES:
        return {"error": "Recording too short. Please record at least 3 seconds."}

    # Split into 3-second chunks (matching training chunk size)
    chunks = []
    for start in range(0, len(y), CHUNK_SAMPLES):
        chunk = y[start:start + CHUNK_SAMPLES]
        if len(chunk) == CHUNK_SAMPLES:
            chunks.append(chunk)
        elif len(chunk) >= PAD_THRESHOLD:
            padded = np.zeros(CHUNK_SAMPLES, dtype=np.float32)
            padded[:len(chunk)] = chunk
            chunks.append(padded)

    model, scaler = load_model()

    try:
        tempo = extract_tempo(audio_file)
    except Exception as e:
        sys.stderr.write(f"warning: tempo extraction failed — {e}\n")
        tempo = None

    chunk_predictions = []
    chunk_proba       = []

    for chunk in chunks:
        try:
            features = extract_rhythm_features(chunk, SR)
        except Exception as e:
            sys.stderr.write(f"warning: skipping chunk — {e}\n")
            continue

        if not np.any(features):  # zero-vector = fewer than 3 onsets detected
            continue

        features = scaler.transform(features.reshape(1, -1))
        chunk_predictions.append(model.predict(features)[0])
        chunk_proba.append(model.predict_proba(features)[0])

    if not chunk_predictions:
        return {"error": "Could not extract features from any chunk. Recording may be too short or silent."}

    vote_counts  = Counter(chunk_predictions)
    prediction   = vote_counts.most_common(1)[0][0]
    classes      = list(model.classes_)
    winning_idx  = classes.index(prediction)

    avg_confidence = float(np.mean([p[winning_idx] for p in chunk_proba]))

    avg_proba  = np.mean(chunk_proba, axis=0)
    confidence = {cls: round(float(prob), 2) for cls, prob in zip(classes, avg_proba)}

    return {
        "prediction":       prediction,
        "confidence":       confidence,
        "avg_confidence":   round(avg_confidence, 2),
        "chunks_analyzed":  len(chunks),
        "tempo":            tempo,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python analyze.py <audio_file.wav>")
        sys.exit(1)

    audio_file = sys.argv[1]

    if not os.path.exists(audio_file):
        print(f"error: file not found: {audio_file}")
        sys.exit(1)

    result = analyze(audio_file)
    print(json.dumps(result))
