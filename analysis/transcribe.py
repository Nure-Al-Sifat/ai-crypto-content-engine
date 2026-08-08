#!/usr/bin/env python3
"""
FULL video → text (100%, end-to-end) — free, local.

Unlike deep_analyze.py (which samples the first 5 minutes for Viral DNA), this
transcribes the WHOLE video:
  1. YouTube captions (whole video, English preferred, else original language).
  2. Fallback: download full audio + whisper.cpp (needs a whisper model).

Saves the complete transcript to data/transcripts/<id>.txt.

Usage:  python analysis/transcribe.py <youtube_url_or_id>
"""
import sys
import os
import re
import glob
import time
import tempfile
import subprocess
import shutil

# English model. For NON-English videos with no captions, download the
# MULTILINGUAL model (ggml-base.bin) and point MODEL at it.
MODEL_EN = os.path.join(os.path.dirname(__file__), "..", "models", "ggml-base.en.bin")
MODEL_ML = os.path.join(os.path.dirname(__file__), "..", "models", "ggml-base.bin")


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def parse_vtt(path):
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return ""
    seen, out = set(), []
    for ln in raw.splitlines():
        s = ln.strip()
        if ("-->" in s or s in ("", "WEBVTT") or s.isdigit()
                or s.startswith(("Kind:", "Language:", "NOTE", "STYLE"))):
            continue
        c = re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ")
        c = re.sub(r"&[a-z]+;|&#\d+;", " ", c)
        c = re.sub(r"\s+", " ", c).strip()
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return " ".join(out)


def full_captions(url, wd, retries=4):
    """Whole-video captions. Prefer English (incl. auto-translated), else any.
    YouTube rate-limits caption requests (429), so retry with backoff — the
    captions usually exist, the fetch just needs another try."""
    for langs in ("en.*,en", ".*"):
        for attempt in range(retries):
            try:
                run([
                    "yt-dlp", "--skip-download", "--write-auto-subs", "--write-subs",
                    "--sub-langs", langs, "--sub-format", "vtt",
                    "-o", os.path.join(wd, "sub"),
                    "--no-playlist", "--no-warnings", "--quiet",
                    "--sleep-requests", "1", url,
                ])
            except subprocess.CalledProcessError as e:
                if "429" in (e.stderr or "") and attempt < retries - 1:
                    print(f"[transcribe] caption 429 — retrying in {2 ** attempt}s...", file=sys.stderr)
                    time.sleep(2 ** attempt)
                    continue
            subs = glob.glob(os.path.join(wd, "*.vtt"))
            if subs:
                text = parse_vtt(subs[0])
                if text:
                    return text, os.path.basename(subs[0])
            break  # got a response but no usable subs for this lang set
    return "", None


def whisper_full(url, wd):
    """Download full audio and transcribe with whisper.cpp (slow on CPU)."""
    model = MODEL_ML if os.path.exists(MODEL_ML) else MODEL_EN
    if not os.path.exists(model) or not shutil.which("whisper-cli"):
        return ""
    run([
        "yt-dlp", "-f", "bestaudio", "-x", "--audio-format", "wav",
        "-o", os.path.join(wd, "a.%(ext)s"),
        "--no-playlist", "--no-warnings", "--quiet", url,
    ])
    wavs = glob.glob(os.path.join(wd, "a.*"))
    if not wavs:
        return ""
    wav16 = os.path.join(wd, "a16.wav")
    run(["ffmpeg", "-y", "-i", wavs[0], "-ac", "1", "-ar", "16000", wav16])
    prefix = os.path.join(wd, "out")
    cmd = ["whisper-cli", "-m", model, "-f", wav16, "-otxt", "-of", prefix, "-nt"]
    if model == MODEL_ML:
        cmd += ["-l", "auto"]  # multilingual: auto-detect the spoken language
        # Set WHISPER_TRANSLATE=true to get an English translation instead of
        # the original-language transcript.
        if os.environ.get("WHISPER_TRANSLATE", "").lower() in ("1", "true", "yes"):
            cmd += ["--translate"]
    run(cmd)
    txt = prefix + ".txt"
    if os.path.exists(txt):
        with open(txt, encoding="utf-8") as f:
            return re.sub(r"\s+", " ", f.read()).strip()
    return ""


def main():
    if len(sys.argv) < 2:
        print("usage: transcribe.py <youtube_url_or_id>")
        return
    url = sys.argv[1]
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{6,})", url)
    vid = m.group(1) if m else (url if re.fullmatch(r"[A-Za-z0-9_-]{6,}", url) else "video")
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={url}"

    wd = tempfile.mkdtemp(prefix="tx_")
    try:
        print("[transcribe] fetching full captions...", file=sys.stderr)
        text, src = full_captions(url, wd)
        method = f"captions ({src})" if text else None
        if not text:
            print("[transcribe] no captions — running whisper.cpp on full audio (this can be slow)...", file=sys.stderr)
            text = whisper_full(url, wd)
            method = "whisper.cpp"
        if not text:
            print("❌ FAILED — no captions available and whisper produced nothing.")
            print("   To transcribe caption-less / non-English videos, add the multilingual")
            print("   whisper model: curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o models/ggml-base.bin")
            return

        outdir = os.path.join(os.path.dirname(__file__), "..", "data", "transcripts")
        os.makedirs(outdir, exist_ok=True)
        outfile = os.path.abspath(os.path.join(outdir, f"{vid}.txt"))
        with open(outfile, "w", encoding="utf-8") as f:
            f.write(text)

        wc = len(text.split())
        print(f"\n✅ FULL transcript via {method}: {wc} words")
        print(f"   saved → {outfile}")
        print("\n--- preview (first 120 words) ---")
        print(" ".join(text.split()[:120]))
    except subprocess.CalledProcessError as e:
        print(f"❌ FAILED: {(e.stderr or str(e))[:200]}")
    finally:
        shutil.rmtree(wd, ignore_errors=True)


if __name__ == "__main__":
    main()
