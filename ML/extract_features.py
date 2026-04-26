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


def chunk_audio(y, sr, chunk_duration=3):
    chunk_size = sr * chunk_duration
    chunks = []
    for start in range(0, len(y) - chunk_size, chunk_size):
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

                    # Split into 1-second chunks
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