"""
diagnose_features.py — sample 5 files per class from train/ and print raw
IOI mean, std, and slope so we can verify class separability before training.
"""
import os
import sys
import random
import librosa
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_features import extract_rhythm_features

CLASSES  = ['correct', 'off_rhythm', 'rushed', 'dragging']
SR       = 22050
N_SAMPLE = 5
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

random.seed(42)

print(f"\n{'Class':<12}  {'ioi_mean(ms)':>13}  {'ioi_std(ms)':>11}  {'ioi_slope(ms/n)':>15}  {'beat_dev_std(ms)':>16}  file")
print("-" * 100)

for cls in CLASSES:
    folder = os.path.join(BASE_DIR, 'data', cls, 'train')
    if not os.path.isdir(folder):
        print(f"{cls:<12}  (folder not found)")
        continue
    files = [f for f in os.listdir(folder) if f.endswith('.wav')]
    sample = random.sample(files, min(N_SAMPLE, len(files)))
    for fname in sample:
        try:
            y, sr = librosa.load(os.path.join(folder, fname), sr=SR)
            f = extract_rhythm_features(y, sr)
            # indices: 0=ioi_mean, 1=ioi_std, 5=ioi_slope, 8=beat_dev_std
            ioi_mean     = f[0] * 1000   # convert s → ms
            ioi_std      = f[1] * 1000
            ioi_slope    = f[5] * 1000   # ms per note
            beat_dev_std = f[8] * 1000
            print(f"{cls:<12}  {ioi_mean:>13.1f}  {ioi_std:>11.1f}  {ioi_slope:>15.4f}  {beat_dev_std:>16.1f}  {fname}")
        except Exception as e:
            print(f"{cls:<12}  ERROR: {e}")
    print()
