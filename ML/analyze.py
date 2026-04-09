import sys
import os
import librosa
import pickle
import numpy as np


def load_model():

    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(base_dir, 'models', 'model.pkl')
    scaler_path = os.path.join(base_dir, 'models', 'scaler.pkl')

    with open(model_path, 'rb') as f:
        model = pickle.load(f)

    with open(scaler_path, 'rb') as f:
        scaler = pickle.load(f)

    return model, scaler


def extract_features(audio_file):
    y, sr = librosa.load(audio_file, sr=22050)

    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    mfccs_mean = mfccs.mean(axis=1)
    mfccs_std = mfccs.std(axis=1)

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.asarray(tempo).flatten()[0])

    spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr).mean()
    spectral_centroid = float(np.asarray(spectral_centroid).flatten()[0])

    zcr = librosa.feature.zero_crossing_rate(y).mean()
    zcr = float(np.asarray(zcr).flatten()[0])

    features = np.concatenate([
        mfccs_mean,
        mfccs_std,
        np.array([tempo]),
        np.array([spectral_centroid]),
        np.array([zcr])
    ])

    # Return both the feature array and tempo so analyze() can include it in the response
    return features, tempo


def analyze(audio_file):

    model, scaler = load_model()

    # Unpack the tuple — features go to the model, tempo goes to the response
    features, tempo = extract_features(audio_file)
    features = features.reshape(1, -1)
    features = scaler.transform(features)

    prediction = model.predict(features)[0]

    probabilities = model.predict_proba(features)[0]

    classes = model.classes_

    confidence = {
        cls: round(float(prob), 2)
        for cls, prob in zip(classes, probabilities)
    }

    return {
        "prediction": prediction,
        "confidence": confidence,
        "tempo": tempo
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage")
        sys.exit(1)

    audio_file = sys.argv[1]

    if not os.path.exists(audio_file):
        print(f"error: file not found: {audio_file}")
        sys.exit(1)

    result = analyze(audio_file)
    import json
    print(json.dumps(result))
