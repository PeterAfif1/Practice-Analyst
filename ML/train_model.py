import os
import pickle
from collections import Counter

import librosa
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report
from sklearn.preprocessing import StandardScaler

from extract_features import _extract_embeddings, chunk_audio


CLASSES = ['correct', 'off_rhythm', 'rushed', 'dragging']


def _load_split(split, base_dir):
    X, y = [], []
    for cls in CLASSES:
        folder = os.path.join(base_dir, 'data', cls, split)
        if not os.path.isdir(folder):
            print(f"  warning: {folder} not found, skipping")
            continue
        files = [f for f in os.listdir(folder) if f.endswith('.wav')]
        print(f"  {cls}/{split}: {len(files)} files")
        for filename in files:
            try:
                audio, sr = librosa.load(os.path.join(folder, filename), sr=16000)
                for chunk in chunk_audio(audio, sr, chunk_duration=1):
                    X.append(_extract_embeddings(chunk, sr))
                    y.append(cls)
            except Exception as e:
                print(f"    error {filename}: {e}")
    return np.array(X), np.array(y)


def _print_distribution(y, label):
    counts = Counter(y)
    total = len(y)
    max_n = max(counts.values(), default=1)
    print(f"\n{label} ({total} samples):")
    for cls in CLASSES:
        n = counts.get(cls, 0)
        bar = '█' * (n * 30 // max_n)
        print(f"  {cls:<12} {n:>6}  {n / total * 100:5.1f}%  {bar}")


def train():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    print("Loading train split...")
    X_train, y_train = _load_split('train', base_dir)
    print("Loading val split...")
    X_val, y_val = _load_split('val', base_dir)
    print("Loading test split...")
    X_test, y_test = _load_split('test', base_dir)

    _print_distribution(y_train, "Train distribution")
    _print_distribution(y_val,   "Val distribution")
    _print_distribution(y_test,  "Test distribution")

    print("\nScaling features...")
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_val   = scaler.transform(X_val)
    X_test  = scaler.transform(X_test)

    print("\nTraining Random Forest...")
    model = RandomForestClassifier(n_estimators=100, random_state=42, class_weight='balanced')
    model.fit(X_train, y_train)

    val_acc = model.score(X_val, y_val)
    print(f"\nVal accuracy:  {val_acc * 100:.2f}%")
    print(classification_report(y_val, model.predict(X_val), target_names=CLASSES, zero_division=0))

    test_acc = model.score(X_test, y_test)
    print(f"Test accuracy: {test_acc * 100:.2f}%")
    print(classification_report(y_test, model.predict(X_test), target_names=CLASSES, zero_division=0))

    models_dir = os.path.join(base_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    with open(os.path.join(models_dir, 'model.pkl'), 'wb') as f:
        pickle.dump(model, f)
    with open(os.path.join(models_dir, 'scaler.pkl'), 'wb') as f:
        pickle.dump(scaler, f)

    print("\nModel saved to models/model.pkl")
    print("Scaler saved to models/scaler.pkl")
    print("Training complete.")


if __name__ == "__main__":
    train()
