"""Transcribe one audio file with faster-whisper (open-source Whisper, CPU, int8).

    python scripts/transcribe.py <audio> <out.txt> [--model small.en] [--prompt "names..."]

Called by src/podcasts/whisper.ts. Writes the transcript as plain text, one segment per line.
Needs `pip install -r scripts/requirements-whisper.txt`; faster-whisper decodes audio through
PyAV, so no system ffmpeg is needed. The model downloads once into ~/.cache/huggingface.
"""

import argparse
import os
import sys
import time

from faster_whisper import WhisperModel


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("out")
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--prompt", default=None, help="names and terms to spell right")
    parser.add_argument("--beam-size", type=int, default=1)
    args = parser.parse_args()

    started = time.monotonic()
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    segments, info = model.transcribe(
        args.audio,
        beam_size=args.beam_size,
        vad_filter=True,
        initial_prompt=args.prompt,
    )
    # segments is a generator: transcription happens as it is consumed.
    lines = [segment.text.strip() for segment in segments if segment.text.strip()]
    with open(args.out, "w", encoding="utf-8") as out:
        out.write("\n".join(lines) + "\n")
    elapsed = time.monotonic() - started
    print(
        f"transcribed {info.duration / 60:.1f} min of audio in {elapsed / 60:.1f} min ({args.model})",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
