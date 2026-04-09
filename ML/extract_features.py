import librosa
import numpy as np
import os


def extract_features_from_file(audio_file):
    y, sr = librosa.load(audio_file, sr=22050)

    mfccs = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)

    mfccs_mean = mfccs.mean(axis=1)

    mfccs_std = mfccs.std(axis=1)

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.asarray(tempo).flatten()[0])

    spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr).mean()

    zcr = librosa.feature.zero_crossing_rate(y).mean()

    features = np.concatenate([
        mfccs_mean,
        mfccs_std,
        np.array([tempo]),
        np.array([float(np.asarray(spectral_centroid).flatten()[0])]),
        np.array([float(np.asarray(zcr).flatten()[0])])
    ])

    return features


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
                    features = extract_features_from_file(filepath)

                    X.append(features)
                    y.append(label)

                except Exception as e:
                    print(f"error processing {filename}: {e}")
                    import traceback
                    traceback.print_exc()
                    break

    X = np.array(X)
    y = np.array(y)

    print("\ndone loading dataset")
    print(f"X shape: {X.shape}")
    print(f"y shape: {y.shape}")

    return X, y


if __name__ == "__main__":
    X, y = load_dataset()
    print("\nsample feature vector:")
    print(X[0])
    print("\nlabel:", y[0])
