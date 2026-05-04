#!/usr/bin/env python3
"""
prepare_groove_data.py

Reads the Groove MIDI Dataset info.csv, renders each MIDI to WAV via
FluidSynth, produces three augmented variants (off_rhythm, rushed, dragging),
chunks all audio into 3-second clips, and saves them into the correct
class/split subfolder under ML/data/.

Usage:
    python prepare_groove_data.py \
        --groove-dir "C:/Users/pafif/Downloads/groove-v1.0.0-midionly/groove" \
        --soundfont  "path/to/soundfont.sf2"

Optional:
    --output-dir   Root output directory  (default: ML/data/ next to this script)
    --sr           Sample rate for output WAVs  (default: 22050)

Soundfonts — download one for free:
    GeneralUser GS  https://schristiancollins.com/generaluser.php
    FluidR3_GM      https://member.keymusician.com/Member/FluidR3_GM/index.html
"""

import argparse
import csv
import os
import random
import shutil
import subprocess
import sys
import tempfile
from math import gcd

import librosa
import mido
import numpy as np
import soundfile as sf

# ── Import chunk_audio from extract_features without triggering model load ──
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_features import chunk_audio  # noqa: E402


# ── dependency checks ────────────────────────────────────────────────────────

def _check_fluidsynth():
    if shutil.which("fluidsynth") is None:
        sys.exit(
            "\nError: FluidSynth is not installed or not on PATH.\n"
            "Install it with one of:\n"
            "  winget install FluidSynth.FluidSynth\n"
            "  choco install fluidsynth\n"
            "  Download: https://www.fluidsynth.org/\n"
            "After installing, make sure 'fluidsynth' is on your PATH, then re-run.\n"
        )


def _check_mido():
    try:
        mido  # noqa: F401 — already imported at top
    except ImportError:
        sys.exit(
            "\nError: mido is not installed.\n"
            "Install it with:  pip install mido\n"
        )


# ── soundfont auto-discovery ─────────────────────────────────────────────────

_SF2_CANDIDATES = [
    os.path.expanduser(r"~\Downloads\GeneralUser-GS.sf2"),
    os.path.expanduser(r"~\Downloads\GeneralUser GS v1.471.sf2"),
    os.path.expanduser(r"~\Downloads\FluidR3_GM.sf2"),
    r"C:\tools\fluidsynth\GeneralUser GS v1.471.sf2",
    r"C:\fluidsynth\FluidR3_GM.sf2",
    r"C:\Program Files\fluidsynth\FluidR3_GM.sf2",
    "/usr/share/sounds/sf2/FluidR3_GM.sf2",
    "/usr/share/soundfonts/FluidR3_GM.sf2",
]


def _find_soundfont():
    for path in _SF2_CANDIDATES:
        if os.path.isfile(path):
            return path
    return None


# ── MIDI rendering ───────────────────────────────────────────────────────────

def render_midi(midi_path, soundfont_path, out_wav, sr=22050):
    """Render a MIDI file to WAV using FluidSynth."""
    result = subprocess.run(
        [
            "fluidsynth", "-ni",
            "-F", out_wav,
            "-r", str(sr),
            "-q",
            soundfont_path,
            midi_path,
        ],
        capture_output=True,
    )
    if result.returncode != 0 or not os.path.isfile(out_wav) or os.path.getsize(out_wav) == 0:
        stderr = result.stderr.decode(errors="replace").strip()
        stdout = result.stdout.decode(errors="replace").strip()
        raise RuntimeError(
            f"FluidSynth failed (exit {result.returncode}) — no WAV produced.\n"
            f"  stdout: {stdout[:300]}\n"
            f"  stderr: {stderr[:300]}"
        )


# ── MIDI augmentation helpers ────────────────────────────────────────────────

def _get_tempo(mid):
    """Return first set_tempo value (microseconds/beat), default 500000."""
    for track in mid.tracks:
        for msg in track:
            if msg.type == "set_tempo":
                return msg.tempo
    return 500000


def _ms_to_ticks(ms, ticks_per_beat, tempo_us):
    return int(ms * ticks_per_beat * 1000 / tempo_us)


def _apply_note_shift(track, shift_fn, ticks_per_beat, tempo_us):
    """
    Return a new MidiTrack where each note_on (velocity > 0) has its
    absolute tick time adjusted by shift_fn(note_index) → delta_ticks.

    Works on absolute times to avoid cascading rounding errors, then
    rebuilds relative times before returning.
    """
    # Build absolute-time list
    abs_events = []
    t = 0
    for msg in track:
        t += msg.time
        abs_events.append([t, msg])

    # Shift note_on events
    note_idx = 0
    for event in abs_events:
        msg = event[1]
        if msg.type == "note_on" and msg.velocity > 0:
            delta = shift_fn(note_idx)
            event[0] = max(0, event[0] + delta)
            note_idx += 1

    # Stable sort by new absolute time
    abs_events.sort(key=lambda e: e[0])

    # Rebuild relative times
    new_track = mido.MidiTrack()
    prev = 0
    for abs_t, msg in abs_events:
        new_track.append(msg.copy(time=max(0, abs_t - prev)))
        prev = abs_t
    return new_track


# ── three augmentation strategies ────────────────────────────────────────────

def augment_off_rhythm(mid_path, out_path):
    """Random per-hit timing jitter of ±50–150 ms on every note.
    Range is larger than natural human timing variation (~20–80 ms std)
    so the class is clearly separable from correct."""
    mid = mido.MidiFile(mid_path)
    tempo = _get_tempo(mid)
    tpb = mid.ticks_per_beat

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)
    for track in mid.tracks:
        def _jitter(_idx, _tpb=tpb, _tempo=tempo):
            sign = random.choice([-1, 1])
            ms = random.uniform(50, 150)
            return sign * _ms_to_ticks(ms, _tpb, _tempo)
        new_mid.tracks.append(_apply_note_shift(track, _jitter, tpb, tempo))
    new_mid.save(out_path)


def _file_duration_ticks(mid):
    """Return the total length of the MIDI file in ticks."""
    return max(sum(msg.time for msg in track) for track in mid.tracks)


def _apply_tempo_ramp(mid_path, out_path, speed_factor, n_steps=40,
                      ramp_seconds=3.0):
    """
    Replace the MIDI file's tempo with a linear ramp from base_tempo to
    base_tempo / speed_factor, compressed into a fixed ramp_seconds window
    (default 3 s) at the start of the file.  The rest of the file holds the
    final tempo.

      speed_factor > 1  →  file gets faster  (rushed)
      speed_factor < 1  →  file gets slower  (dragging)

    Previously the ramp was spread across total_ticks (the whole file), so a
    30-second file only produced ~3 BPM of change per 3-second chunk — below
    the noise floor of ioi_slope.  By capping the ramp to ramp_seconds every
    3-second chunk that overlaps the ramp window sees the full
    speed_factor change, making the signal clearly detectable.
    """
    mid = mido.MidiFile(mid_path)
    base_tempo_us = _get_tempo(mid)   # µs per beat at nominal tempo
    end_tempo_us  = int(base_tempo_us / speed_factor)
    tpb           = mid.ticks_per_beat

    # Convert ramp_seconds → ticks using the base tempo.
    # ticks_per_second = tpb × (1_000_000 / base_tempo_us)
    ticks_per_sec = tpb * 1_000_000 / base_tempo_us
    ramp_ticks    = int(ticks_per_sec * ramp_seconds)

    # Build (abs_tick → tempo_us) ramp points within [0, ramp_ticks].
    # After ramp_ticks the file stays at end_tempo_us.
    ramp_events = [
        (
            int(i / n_steps * ramp_ticks),
            int(base_tempo_us + (end_tempo_us - base_tempo_us) * i / n_steps),
        )
        for i in range(n_steps + 1)
    ]
    # Final hold: lock end tempo for the rest of the file so there are no
    # tempo-event gaps that could confuse FluidSynth.
    ramp_events.append((ramp_ticks, end_tempo_us))

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)

    # Determine which track index carries tempo events
    tempo_track_idx = 0  # type-1: tempo track is always track 0

    for track_idx, track in enumerate(mid.tracks):
        # Collect existing events as absolute times, dropping old set_tempo msgs
        abs_events = []
        t = 0
        for msg in track:
            t += msg.time
            if msg.type != "set_tempo":
                abs_events.append([t, msg])

        # Inject ramp set_tempo messages into the designated tempo track
        if track_idx == tempo_track_idx:
            for abs_t, tempo_us in ramp_events:
                abs_events.append(
                    [abs_t, mido.MetaMessage("set_tempo", tempo=tempo_us, time=0)]
                )

        abs_events.sort(key=lambda e: e[0])

        new_track = mido.MidiTrack()
        prev = 0
        for abs_t, msg in abs_events:
            new_track.append(msg.copy(time=abs_t - prev))
            prev = abs_t
        new_mid.tracks.append(new_track)

    new_mid.save(out_path)


def augment_rushed(mid_path, out_path):
    """Ramp tempo 30 % faster within the first 3 seconds (e.g. 120 → 156 BPM).
    Every 3-second chunk that overlaps that window sees the full acceleration."""
    _apply_tempo_ramp(mid_path, out_path, speed_factor=1.30)


def augment_dragging(mid_path, out_path):
    """Ramp tempo 30 % slower within the first 3 seconds (e.g. 120 → 92 BPM).
    Every 3-second chunk that overlaps that window sees the full deceleration."""
    _apply_tempo_ramp(mid_path, out_path, speed_factor=1.0 / 1.30)


def _apply_natural_jitter(mid_path, out_path, sigma_ms=15, cap_ms=30):
    """
    Add small Gaussian timing jitter (σ=15 ms, capped at ±30 ms) to every
    note_on in the MIDI, simulating natural human timing variation.

    Without this, the correct class is metronomically perfect (ioi_std ≈ 0,
    beat_dev_std ≈ 0), which is physically impossible for a human performer.
    The model would learn a decision boundary that real recordings can never
    satisfy, causing it to misclassify good playing as off_rhythm or rushed.
    """
    mid = mido.MidiFile(mid_path)
    tempo = _get_tempo(mid)
    tpb   = mid.ticks_per_beat

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)
    for track in mid.tracks:
        def _jitter(_idx, _tpb=tpb, _tempo=tempo):
            raw_ms  = random.gauss(0, sigma_ms)
            clamped = max(-cap_ms, min(cap_ms, raw_ms))
            return _ms_to_ticks(abs(clamped), _tpb, _tempo) * (1 if clamped >= 0 else -1)
        new_mid.tracks.append(_apply_note_shift(track, _jitter, tpb, tempo))
    new_mid.save(out_path)


AUGMENTATIONS = [
    ("off_rhythm", augment_off_rhythm),
    ("rushed",     augment_rushed),
    ("dragging",   augment_dragging),
]

# ── chunking + saving ────────────────────────────────────────────────────────

SPLIT_MAP = {"train": "train", "test": "test", "validation": "val"}


def save_chunks(wav_path, out_dir, prefix, sr_target=22050):
    """
    Load WAV, mix to mono, optionally resample, chunk to 3-second clips
    (dropping any partial final chunk), and save each as a numbered WAV.
    Returns the number of chunks saved.
    """
    y, sr = sf.read(wav_path, always_2d=False)

    if y.ndim == 2:
        y = y.mean(axis=1)

    if sr != sr_target:
        from scipy.signal import resample_poly
        g = gcd(sr_target, sr)
        y = resample_poly(y, sr_target // g, sr // g).astype(np.float32)
        sr = sr_target

    chunks = chunk_audio(y, sr, chunk_duration=3)
    full_chunks = [c for c in chunks if len(c) == sr * 3]

    if not full_chunks:
        return 0

    os.makedirs(out_dir, exist_ok=True)
    saved = 0
    for i, chunk in enumerate(full_chunks):
        # Skip silent or near-silent chunks: require at least 3 detected onsets
        # and a non-zero mean inter-onset interval so the feature extractor
        # won't produce a useless zero vector at training time.
        onsets = librosa.onset.onset_detect(y=chunk, sr=sr, units='time')
        if len(onsets) < 3:
            continue
        iois = np.diff(onsets)
        if len(iois) == 0 or float(np.mean(iois)) == 0.0:
            continue
        sf.write(os.path.join(out_dir, f"{prefix}_chunk{i:03d}.wav"),
                 chunk.astype(np.float32), sr)
        saved += 1
    return saved


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Prepare Groove MIDI dataset — render, augment, chunk, and sort into ML/data/."
    )
    parser.add_argument(
        "--groove-dir", required=True,
        help="Path to the groove/ directory that contains info.csv",
    )
    parser.add_argument(
        "--soundfont", default=None,
        help="Path to a GM .sf2 soundfont file (auto-detected if omitted)",
    )
    parser.add_argument(
        "--output-dir", default=None,
        help="Root output directory (default: ML/data/ next to this script)",
    )
    parser.add_argument(
        "--sr", type=int, default=22050,
        help="Sample rate for rendered and saved WAVs (default: 22050)",
    )
    args = parser.parse_args()

    _check_fluidsynth()
    _check_mido()

    soundfont = args.soundfont or _find_soundfont()
    if not soundfont or not os.path.isfile(soundfont):
        sys.exit(
            "\nError: No soundfont (.sf2) found.\n"
            "Download one for free:\n"
            "  GeneralUser GS: https://schristiancollins.com/generaluser.php\n"
            "  FluidR3_GM:     https://member.keymusician.com/Member/FluidR3_GM/index.html\n"
            "Then pass it with:  --soundfont path/to/soundfont.sf2\n"
        )

    groove_dir = args.groove_dir
    csv_path = os.path.join(groove_dir, "info.csv")
    if not os.path.isfile(csv_path):
        sys.exit(f"Error: info.csv not found at {csv_path}")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = args.output_dir or os.path.join(script_dir, "data")

    # Clear existing chunks before regenerating so stale files never mix with
    # new ones.  Only the train/val/test subfolders inside each class dir are
    # wiped; the class directories themselves are left in place.
    print("Clearing existing chunks...")
    for cls in ["correct", "off_rhythm", "rushed", "dragging"]:
        for split in ["train", "val", "test"]:
            split_dir = os.path.join(output_dir, cls, split)
            if not os.path.isdir(split_dir):
                continue
            removed = 0
            for fname in os.listdir(split_dir):
                if fname.endswith(".wav"):
                    os.remove(os.path.join(split_dir, fname))
                    removed += 1
            if removed:
                print(f"  cleared {removed:>5} files from {cls}/{split}/")
    print("Done clearing.\n")

    with open(csv_path, newline="") as f:
        all_rows = list(csv.DictReader(f))

    rows = [r for r in all_rows if r["beat_type"] == "beat"]
    print(f"Loaded info.csv — {len(all_rows)} total rows, {len(rows)} beats (fills skipped)")

    totals = {cls: 0 for cls in ["correct", "off_rhythm", "rushed", "dragging"]}
    skipped = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, row in enumerate(rows, 1):
            midi_rel = row["midi_filename"]
            split = SPLIT_MAP.get(row["split"], row["split"])
            duration = float(row["duration"])
            bpm = row["bpm"]

            if duration < 3.0:
                print(f"[{idx:>3}/{len(rows)}] SKIP too short ({duration:.1f}s): {midi_rel}")
                skipped += 1
                continue

            midi_path = os.path.join(groove_dir, midi_rel)
            if not os.path.isfile(midi_path):
                print(f"[{idx:>3}/{len(rows)}] SKIP missing: {midi_rel}")
                skipped += 1
                continue

            safe = midi_rel.replace("/", "_").replace("\\", "_").replace(".mid", "")
            print(f"[{idx:>3}/{len(rows)}] {safe}  bpm={bpm}  split={split}")

            # ── render original → correct (with natural jitter) ───────
            orig_wav    = os.path.join(tmpdir, f"{safe}_orig.wav")
            jitter_mid  = os.path.join(tmpdir, f"{safe}_jitter.mid")
            jitter_wav  = os.path.join(tmpdir, f"{safe}_jitter.wav")
            try:
                render_midi(midi_path, soundfont, orig_wav, sr=args.sr)
                _apply_natural_jitter(midi_path, jitter_mid)
                render_midi(jitter_mid, soundfont, jitter_wav, sr=args.sr)
            except (subprocess.CalledProcessError, RuntimeError) as e:
                print(f"  render failed: {e}")
                skipped += 1
                continue

            n = save_chunks(orig_wav,
                            os.path.join(output_dir, "correct", split),
                            safe, sr_target=args.sr)
            totals["correct"] += n
            n2 = save_chunks(jitter_wav,
                             os.path.join(output_dir, "correct", split),
                             f"{safe}_jitter", sr_target=args.sr)
            totals["correct"] += n2
            print(f"  correct/{split}: {n + n2} chunks ({n} clean + {n2} jittered)")

            # ── augmented variants ─────────────────────────────────────
            for cls, aug_fn in AUGMENTATIONS:
                aug_mid = os.path.join(tmpdir, f"{safe}_{cls}.mid")
                aug_wav = os.path.join(tmpdir, f"{safe}_{cls}.wav")
                try:
                    aug_fn(midi_path, aug_mid)
                    render_midi(aug_mid, soundfont, aug_wav, sr=args.sr)
                except Exception as e:
                    print(f"  {cls} failed: {e}")
                    continue

                n = save_chunks(aug_wav,
                                os.path.join(output_dir, cls, split),
                                f"{safe}_{cls}", sr_target=args.sr)
                totals[cls] += n
                print(f"  {cls}/{split}: {n} chunks")

    print(f"\nDone.  Skipped {skipped} file(s).")
    print("Chunks saved:")
    for cls, n in totals.items():
        print(f"  {cls:12s}: {n:5d}")


if __name__ == "__main__":
    main()
