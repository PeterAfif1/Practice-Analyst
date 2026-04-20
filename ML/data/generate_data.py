# generate_data.py
# run this once to create all your training data
# it will generate wav files and put them in the correct folders

import numpy as np
from scipy.io import wavfile
import os

# sample rate — how many audio samples per second
# 22050 is standard for audio ML
SAMPLE_RATE = 22050

# how long each audio clip is in seconds
DURATION = 2

# how many samples to generate per category
NUM_SAMPLES = 100


def generate_tone(frequency, duration, sample_rate, volume=0.5):
    # create an array of time values from 0 to duration
    # np.linspace makes evenly spaced numbers
    t = np.linspace(0, duration, int(sample_rate * duration))

    # generate a sine wave at the given frequency
    # this is literally what a pure tone sounds like as numbers
    # volume controls how loud (0 to 1)
    wave = volume * np.sin(2 * np.pi * frequency * t)

    # convert to 16-bit integers — standard wav file format
    wave = (wave * 32767).astype(np.int16)

    return wave


def add_noise(wave, noise_level=0.005):
    # add a tiny bit of random noise to make it more realistic
    # without this every sample is perfectly identical
    noise = np.random.normal(0, noise_level, len(wave))
    noisy = wave + (noise * 32767).astype(np.int16)
    return noisy.astype(np.int16)


def generate_drum_hit(duration, sample_rate, timing_offset=0):
    # drums don't have pitch — they're modeled as noise bursts
    # create array of time values
    t = np.linspace(0, duration, int(sample_rate * duration))

    # start with random noise (that's basically what a drum hit is)
    noise = np.random.normal(0, 1, len(t))

    # apply an exponential decay envelope
    # this makes the sound fade out quickly like a real drum hit
    # higher number in exp = faster decay
    envelope = np.exp(-10 * t)

    # combine noise with envelope
    wave = noise * envelope

    # if timing_offset is set, shift the hit slightly
    # this simulates playing slightly early or late
    if timing_offset > 0:
        # roll shifts the array — simulates late hit
        shift_samples = int(timing_offset * sample_rate)
        wave = np.roll(wave, shift_samples)

    # normalize and convert to 16-bit
    wave = wave / np.max(np.abs(wave))
    wave = (wave * 32767 * 0.5).astype(np.int16)

    return wave


def save_wav(filename, wave, sample_rate):
    # write the wave array to a .wav file
    wavfile.write(filename, sample_rate, wave)


def generate_dataset():
    # A4 = 440hz, standard tuning reference
    # these are the frequencies for common notes
    CORRECT_PITCH = 440.0   # A4 — in tune
    FLAT_PITCH = 415.0      # about 100 cents flat
    SHARP_PITCH = 466.0     # about 100 cents sharp

    # create all the folders if they don't exist
    folders = [
        'data/correct',
        'data/flat',
        'data/sharp',
        'data/off_rhythm'
    ]

    for folder in folders:
        os.makedirs(folder, exist_ok=True)
        print(f"created folder: {folder}")

    print(f"\ngenerating {NUM_SAMPLES} samples per category...\n")

    # --- CORRECT PITCH ---
    for i in range(NUM_SAMPLES):
        # generate a tone at exactly 440hz
        wave = generate_tone(CORRECT_PITCH, DURATION, SAMPLE_RATE)
        # add slight random noise so samples aren't identical
        wave = add_noise(wave, noise_level=0.002)
        # save to correct folder
        save_wav(f'data/correct/correct_{i}.wav', wave, SAMPLE_RATE)

    print(f"generated {NUM_SAMPLES} correct pitch samples")

    # --- FLAT PITCH ---
    for i in range(NUM_SAMPLES):
        # generate a tone slightly below 440hz
        # randomize the flatness a bit so model learns a range
        flat_freq = FLAT_PITCH + np.random.uniform(-10, 10)
        wave = generate_tone(flat_freq, DURATION, SAMPLE_RATE)
        wave = add_noise(wave, noise_level=0.002)
        save_wav(f'data/flat/flat_{i}.wav', wave, SAMPLE_RATE)

    print(f"generated {NUM_SAMPLES} flat pitch samples")

    # --- SHARP PITCH ---
    for i in range(NUM_SAMPLES):
        # generate a tone slightly above 440hz
        sharp_freq = SHARP_PITCH + np.random.uniform(-10, 10)
        wave = generate_tone(sharp_freq, DURATION, SAMPLE_RATE)
        wave = add_noise(wave, noise_level=0.002)
        save_wav(f'data/sharp/sharp_{i}.wav', wave, SAMPLE_RATE)

    print(f"generated {NUM_SAMPLES} sharp pitch samples")

    # --- OFF RHYTHM ---
    for i in range(NUM_SAMPLES):
        # generate a drum hit with a random timing offset
        # offset between 0.05 and 0.2 seconds = noticeably off rhythm
        timing_offset = np.random.uniform(0.05, 0.2)
        wave = generate_drum_hit(DURATION, SAMPLE_RATE, timing_offset)
        save_wav(f'data/off_rhythm/off_rhythm_{i}.wav', wave, SAMPLE_RATE)

    print(f"generated {NUM_SAMPLES} off rhythm samples")

    print("\ndone! dataset ready.")
    print("total samples:", NUM_SAMPLES * 4)


# only runs if you execute this file directly
# not when it's imported by another file
if __name__ == "__main__":
    generate_dataset()
