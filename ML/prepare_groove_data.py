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
    """Random per-hit timing jitter of ±20–80 ms on every note."""
    mid = mido.MidiFile(mid_path)
    tempo = _get_tempo(mid)
    tpb = mid.ticks_per_beat

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)
    for track in mid.tracks:
        def _jitter(_idx, _tpb=tpb, _tempo=tempo):
            sign = random.choice([-1, 1])
            ms = random.uniform(20, 80)
            return sign * _ms_to_ticks(ms, _tpb, _tempo)
        new_mid.tracks.append(_apply_note_shift(track, _jitter, tpb, tempo))
    new_mid.save(out_path)


def augment_rushed(mid_path, out_path):
    """
    Each successive hit arrives progressively earlier, simulating a
    drummer who gradually speeds up (tempo drift faster).
    Step: 0.5 ms per note — gives ~125 ms total drift over 250 notes.
    """
    mid = mido.MidiFile(mid_path)
    tempo = _get_tempo(mid)
    tpb = mid.ticks_per_beat
    step = _ms_to_ticks(0.5, tpb, tempo)

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)
    for track in mid.tracks:
        new_mid.tracks.append(
            _apply_note_shift(track, lambda i: -(i * step), tpb, tempo)
        )
    new_mid.save(out_path)


def augment_dragging(mid_path, out_path):
    """
    Each successive hit arrives progressively later, simulating a
    drummer who gradually slows down (tempo drift slower).
    Step: 0.5 ms per note.
    """
    mid = mido.MidiFile(mid_path)
    tempo = _get_tempo(mid)
    tpb = mid.ticks_per_beat
    step = _ms_to_ticks(0.5, tpb, tempo)

    new_mid = mido.MidiFile(ticks_per_beat=tpb, type=mid.type)
    for track in mid.tracks:
        new_mid.tracks.append(
            _apply_note_shift(track, lambda i: i * step, tpb, tempo)
        )
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
    for i, chunk in enumerate(full_chunks):
        sf.write(os.path.join(out_dir, f"{prefix}_chunk{i:03d}.wav"),
                 chunk.astype(np.float32), sr)
    return len(full_chunks)


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

            # ── render original → correct ──────────────────────────────
            orig_wav = os.path.join(tmpdir, f"{safe}_orig.wav")
            try:
                render_midi(midi_path, soundfont, orig_wav, sr=args.sr)
            except (subprocess.CalledProcessError, RuntimeError) as e:
                print(f"  render failed: {e}")
                skipped += 1
                continue

            n = save_chunks(orig_wav,
                            os.path.join(output_dir, "correct", split),
                            safe, sr_target=args.sr)
            totals["correct"] += n
            print(f"  correct/{split}: {n} chunks")

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
