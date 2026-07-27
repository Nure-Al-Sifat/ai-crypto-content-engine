#!/usr/bin/env python3
"""
Deep video analysis (Light Stage B) — free, local, no PyTorch.

For one YouTube video: downloads a low-res copy + auto-captions via yt-dlp, then
extracts:
  - transcript + hook (from captions; whisper.cpp can be added for caption-less)
  - editing: scene count, avg shot length, cuts/min  (PySceneDetect)
  - visual: talking-head ratio (face detection), brightness  (OpenCV)
  - audio: tempo, energy, silence ratio, speech rate (WPM)  (Librosa)

Every component is fail-soft: on error it returns null for that field and keeps
going, so a single bad component never crashes the run. Prints one JSON object.

Usage:  python analysis/deep_analyze.py <youtube_url_or_id>
"""
import sys
import os
import re
import json
import glob
import tempfile
import subprocess
import shutil
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")

MODEL = os.path.join(os.path.dirname(__file__), "..", "models", "face_yunet.onnx")


def _run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def download_video(url, workdir):
    """Low-res video only (captions handled separately). Returns path or None."""
    out = os.path.join(workdir, "vid.%(ext)s")
    _run([
        "yt-dlp",
        "-f", "worst[height<=360][ext=mp4]/worst[ext=mp4]/worst",
        "-o", out,
        # Only the first 5 minutes: enough to characterize editing/pacing/hook,
        # far faster and lighter on disk than a full 30-40 min top video. All the
        # deep metrics are rates/ratios, and true length comes from metadata.
        "--download-sections", "*0-300",
        "--no-playlist", "--no-warnings", "--quiet",
        "--no-write-subs", "--no-write-auto-subs",
        url,
    ])
    vids = [f for f in glob.glob(os.path.join(workdir, "vid.*")) if not f.lower().endswith(".vtt")]
    return vids[0] if vids else None


def try_subtitles(url, workdir):
    """Best-effort captions. YouTube rate-limits (429) caption scraping, so this
    is NEVER fatal — a video just gets no transcript when it's blocked."""
    try:
        _run([
            "yt-dlp", "--skip-download",
            "--write-auto-subs", "--write-subs", "--sub-langs", "en.*", "--sub-format", "vtt",
            "-o", os.path.join(workdir, "sub"),
            "--no-playlist", "--no-warnings", "--quiet",
            url,
        ])
    except Exception:
        pass
    subs = glob.glob(os.path.join(workdir, "*.vtt"))
    return subs[0] if subs else None


def parse_vtt(path):
    """VTT -> deduped plain text."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except Exception:
        return ""
    seen, out = set(), []
    for ln in raw.splitlines():
        s = ln.strip()
        if (
            "-->" in s
            or s in ("", "WEBVTT")
            or s.isdigit()
            or s.startswith(("Kind:", "Language:", "NOTE", "STYLE"))
        ):
            continue
        clean = re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ")
        clean = re.sub(r"&[a-z]+;|&#\d+;", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return " ".join(out)


def editing_signals(video):
    try:
        from scenedetect import detect, ContentDetector
        scenes = detect(video, ContentDetector())
        if not scenes:
            return {}
        dur = scenes[-1][1].get_seconds()
        n = len(scenes)
        return {
            "scenes": n,
            "avg_shot_sec": round(dur / n, 2) if n else None,
            "cuts_per_min": round(n / (dur / 60), 2) if dur else None,
        }
    except Exception as e:
        return {"editing_error": str(e)[:80]}


def visual_signals(video):
    try:
        import cv2
        # OpenCV 5 dropped Haar cascades; use the bundled YuNet DNN face detector.
        detector = None
        if os.path.exists(MODEL) and hasattr(cv2, "FaceDetectorYN"):
            detector = cv2.FaceDetectorYN.create(MODEL, "", (320, 320), 0.6)

        cap = cv2.VideoCapture(video)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        step = max(int(fps * 2), 1)  # sample every ~2s
        faces, sampled, bright = 0, 0, []
        i = 0
        while total == 0 or i < total:
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, frame = cap.read()
            if not ok:
                break
            bright.append(float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()))
            if detector is not None:
                h, w = frame.shape[:2]
                detector.setInputSize((w, h))
                _, dets = detector.detect(frame)
                if dets is not None and len(dets) > 0:
                    faces += 1
            sampled += 1
            i += step
            if sampled > 400:
                break
        cap.release()

        out = {"avg_brightness": round(sum(bright) / len(bright), 1) if bright else None}
        if detector is not None:
            out["talking_head_ratio"] = round(faces / sampled, 2) if sampled else None
        return out
    except Exception as e:
        return {"visual_error": str(e)[:80]}


def audio_signals(video, workdir):
    try:
        import librosa
        import numpy as np
        wav = os.path.join(workdir, "audio.wav")
        _run(["ffmpeg", "-y", "-i", video, "-ac", "1", "-ar", "16000", "-vn", wav])
        y, sr = librosa.load(wav, sr=16000, mono=True)
        dur = float(librosa.get_duration(y=y, sr=sr)) or 0.0
        try:
            t = librosa.feature.rhythm.tempo(y=y, sr=sr)
        except Exception:
            t, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(np.asarray(t)).ravel()[0])
        rms = float(np.mean(librosa.feature.rms(y=y)))
        intervals = librosa.effects.split(y, top_db=30)
        speech = sum((e - s) for s, e in intervals) / sr if len(intervals) else 0
        return {
            "duration_sec": round(dur),
            "tempo_bpm": round(tempo, 1),
            "audio_energy": round(rms, 4),
            "silence_ratio": round(1 - (speech / dur), 2) if dur else None,
        }
    except Exception as e:
        return {"audio_error": str(e)[:80]}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: deep_analyze.py <url_or_id>"}))
        return
    url = sys.argv[1]
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={url}"

    workdir = tempfile.mkdtemp(prefix="dna_")
    result = {"url": url}
    try:
        video = download_video(url, workdir)
        vtt = try_subtitles(url, workdir)
        transcript = parse_vtt(vtt) if vtt else ""
        words = transcript.split()
        result["has_captions"] = bool(transcript)
        result["word_count"] = len(words)
        result["hook_text"] = " ".join(words[:60])  # ~ first 30s of speech

        if video:
            result.update(editing_signals(video))
            result.update(visual_signals(video))
            audio = audio_signals(video, workdir)
            result.update(audio)
            dur = audio.get("duration_sec")
            if dur and words:
                result["speech_wpm"] = round(len(words) / (dur / 60))
        else:
            result["error"] = "no video stream downloaded"
    except subprocess.CalledProcessError as e:
        result["error"] = (e.stderr or str(e))[:120]
    except Exception as e:
        result["error"] = str(e)[:120]
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
