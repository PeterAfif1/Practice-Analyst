import sys
import os
import pickle
import numpy as np

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

    model, scaler = load_model()

    features = extract_features_from_file(audio_file)

    tempo = extract_tempo(audio_file)

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
        print("usage: python analyze.py <audio_file.wav>")
        sys.exit(1)

    audio_file = sys.argv[1]

    if not os.path.exists(audio_file):
        print(f"error: file not found: {audio_file}")
        sys.exit(1)

    result = analyze(audio_file)
    import json
    print(json.dumps(result))