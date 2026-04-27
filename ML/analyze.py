import sys
import os
import json
import pickle
import tempfile
import numpy as np
import librosa
import soundfile as sf
from collections import Counter

from extract_features import extract_features_from_file, extract_tempo


def load_model():

    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(base_dir, 'models', 'model.pkl')
    scaler_path = os.path.join(base_dir, 'models', 'scaler.pkl')

    with open(model_path, 'rb') as f:
        model = pickle.load(f)

    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)

    return model, scaler


def analyze(audio_file):

    SR = 16000
    CHUNK_SAMPLES    = SR        # 1 second
    MIN_SAMPLES      = SR * 2    # 2 seconds minimum recording
    PAD_THRESHOLD    = SR // 2   # 0.5 seconds — pad if at least this long

    # Load audio at 16kHz to match training sample rate
    y, sr = librosa.load(audio_file, sr=SR)

    # Reject recordings shorter than 2 seconds
    if len(y) < MIN_SAMPLES:
        return {"error": "Recording too short. Please record at least 2 seconds."}

    # Split into 1-second chunks
    chunks = []
    for start in range(0, len(y), CHUNK_SAMPLES):
        chunk = y[start:start + CHUNK_SAMPLES]
        if len(chunk) == CHUNK_SAMPLES:
            chunks.append(chunk)
        elif len(chunk) >= PAD_THRESHOLD:
            # Pad the final short chunk to a full second with zeros
            padded = np.zeros(CHUNK_SAMPLES, dtype=np.float32)
            padded[:len(chunk)] = chunk
            chunks.append(padded)
        # Discard chunks shorter than 0.5 seconds

    model, scaler = load_model()
    tempo = extract_tempo(audio_file)

    chunk_predictions  = []
    chunk_proba        = []

    for chunk in chunks:
        # Write chunk to a temp WAV so extract_features_from_file() can read it
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp_path = tmp.name
        tmp.close()

        try:
            sf.write(tmp_path, chunk, SR)
            features = extract_features_from_file(tmp_path)
        except Exception as e:
            sys.stderr.write(f"warning: skipping chunk — {e}\n")
            os.unlink(tmp_path)
            continue
        finally:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

        features = features.reshape(1, -1)
        features = scaler.transform(features)

        chunk_predictions.append(model.predict(features)[0])
        chunk_proba.append(model.predict_proba(features)[0])

    if not chunk_predictions:
        return {"error": "Could not extract features from any chunk. Recording may be too short or corrupted."}

    # Majority vote across all chunks
    vote_counts  = Counter(chunk_predictions)
    prediction   = vote_counts.most_common(1)[0][0]
    classes      = list(model.classes_)
    winning_idx  = classes.index(prediction)

    # Average probability of the winning class across all chunks
    avg_confidence = float(np.mean([p[winning_idx] for p in chunk_proba]))

    # Full confidence map: average each class probability across all chunks
    avg_proba = np.mean(chunk_proba, axis=0)
    confidence = {
        cls: round(float(prob), 2)
        for cls, prob in zip(classes, avg_proba)
    }

    return {
        "prediction": prediction,
        "confidence": confidence,
        "avg_confidence": round(avg_confidence, 2),
        "chunks_analyzed": len(chunks),
        "tempo": tempo,
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
