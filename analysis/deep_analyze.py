#!/usr/bin/env python3
"""
Deep video analysis (Stage B) — free, local, no PyTorch / no paid APIs.

For one YouTube video (first 5 minutes): downloads a low-res copy + captions,
and extracts:
  - transcript + hook  (captions, else whisper.cpp)
  - editing            scenes, avg shot length, cuts/min      (PySceneDetect)
  - vision             talking-head ratio, brightness, facial emotion,
                       objects on screen                      (OpenCV DNN: YuNet
                       face + FER+ emotion + SSD-MobileNet)
  - audio              tempo, energy, silence, speech WPM      (Librosa)
  - thumbnail          face?, text (OCR), brightness           (OpenCV + Tesseract)

All models are small ONNX / ggml files run through OpenCV / whisper.cpp — no
GPU, no PyTorch. Every component is fail-soft: on error it returns null for that
field and keeps going. Prints one JSON object.

Usage:  python analysis/deep_analyze.py <youtube_url_or_id> [thumbnail_url]
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

_MD = os.path.join(os.path.dirname(__file__), "..", "models")
MODEL_FACE = os.path.join(_MD, "face_yunet.onnx")
MODEL_EMOTION = os.path.join(_MD, "emotion-ferplus.onnx")
MODEL_OBJECT = os.path.join(_MD, "ssd_mobilenet.onnx")
MODEL_WHISPER = os.path.join(_MD, "ggml-base.en.bin")

EMOTIONS = ["neutral", "happy", "surprise", "sad", "angry", "disgust", "fear", "contempt"]
COCO = {
    1: "person", 44: "bottle", 62: "chair", 63: "couch", 67: "phone",
    72: "tv/monitor", 73: "laptop", 76: "keyboard", 77: "cell phone", 84: "book",
}


def _run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


# ---------------------------------------------------------------- download ----

def download_video(url, workdir):
    """First 5 min, low-res, no subs. Returns path or None."""
    out = os.path.join(workdir, "vid.%(ext)s")
    _run([
        "yt-dlp", "-f", "worst[height<=360][ext=mp4]/worst[ext=mp4]/worst",
        "-o", out, "--download-sections", "*0-300",
        "--no-playlist", "--no-warnings", "--quiet",
        "--no-write-subs", "--no-write-auto-subs", url,
    ])
    vids = [f for f in glob.glob(os.path.join(workdir, "vid.*")) if not f.lower().endswith(".vtt")]
    return vids[0] if vids else None


def try_subtitles(url, workdir):
    """Best-effort captions. YouTube rate-limits (429), so never fatal."""
    try:
        _run([
            "yt-dlp", "--skip-download",
            "--write-auto-subs", "--write-subs", "--sub-langs", "en.*", "--sub-format", "vtt",
            "-o", os.path.join(workdir, "sub"),
            "--no-playlist", "--no-warnings", "--quiet", url,
        ])
    except Exception:
        pass
    subs = glob.glob(os.path.join(workdir, "*.vtt"))
    return subs[0] if subs else None


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
        clean = re.sub(r"<[^>]+>", "", s).replace("&nbsp;", " ")
        clean = re.sub(r"&[a-z]+;|&#\d+;", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        if clean and clean not in seen:
            seen.add(clean)
            out.append(clean)
    return " ".join(out)


def extract_audio(video, workdir):
    wav = os.path.join(workdir, "audio.wav")
    _run(["ffmpeg", "-y", "-i", video, "-ac", "1", "-ar", "16000", "-vn", wav])
    return wav


def whisper_transcribe(wav, workdir):
    """Fallback transcript when captions are missing/blocked."""
    if not os.path.exists(MODEL_WHISPER) or not shutil.which("whisper-cli"):
        return ""
    try:
        prefix = os.path.join(workdir, "wsp")
        _run(["whisper-cli", "-m", MODEL_WHISPER, "-f", wav,
              "-otxt", "-of", prefix, "-nt", "-l", "en"])
        txt = prefix + ".txt"
        if os.path.exists(txt):
            with open(txt, encoding="utf-8") as f:
                return re.sub(r"\s+", " ", f.read()).strip()
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------- signals -----

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


def _emotion(frame, dets, emo_net):
    """Facial emotion for the top face in a frame. Returns label or None."""
    import cv2
    import numpy as np
    x, y, fw, fh = [max(0, int(v)) for v in dets[0][:4]]
    crop = frame[y:y + fh, x:x + fw]
    if crop.size == 0:
        return None
    g = cv2.resize(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), (64, 64)).astype("float32")
    emo_net.setInput(g.reshape(1, 1, 64, 64))
    return EMOTIONS[int(np.argmax(emo_net.forward()[0]))]


def _objects(frame, obj_net):
    """COCO labels present in a frame (score > 0.5)."""
    import cv2
    import numpy as np
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)[np.newaxis, ...].astype("uint8")
    obj_net.setInput(rgb)
    outs = obj_net.forward(obj_net.getUnconnectedOutLayersNames())
    two = [o for o in outs if o.ndim == 2 and o.shape[-1] != 4]
    if len(two) < 2:
        return set()
    a, b = two[0][0], two[1][0]
    scores, classes = (a, b) if float(np.max(a)) <= 1.001 else (b, a)
    return {COCO.get(int(c), "other") for s, c in zip(scores, classes) if s > 0.5}


def vision_signals(video):
    """One frame pass: face (talking-head) + emotion + objects + brightness.
    Each detector is independently fail-soft — a bad frame or model skips that
    signal without losing the others."""
    try:
        import cv2
    except Exception as e:
        return {"vision_error": str(e)[:120]}

    def net(path, ctor):
        try:
            return ctor() if os.path.exists(path) else None
        except Exception:
            return None

    face_net = net(MODEL_FACE, lambda: cv2.FaceDetectorYN.create(MODEL_FACE, "", (320, 320), 0.6))
    emo_net = net(MODEL_EMOTION, lambda: cv2.dnn.readNetFromONNX(MODEL_EMOTION))
    obj_net = net(MODEL_OBJECT, lambda: cv2.dnn.readNetFromONNX(MODEL_OBJECT))

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    step = max(int(fps * 2), 1)
    sampled, faces, bright = 0, 0, []
    emo, obj, errs = {}, {}, {}
    i = 0
    while total == 0 or i < total:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        if not ok:
            break
        sampled += 1
        h, w = frame.shape[:2]
        bright.append(float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()))

        if face_net is not None:
            try:
                face_net.setInputSize((w, h))
                _, dets = face_net.detect(frame)
                if dets is not None and len(dets) > 0:
                    faces += 1
                    if emo_net is not None:
                        try:
                            lab = _emotion(frame, dets, emo_net)
                            if lab:
                                emo[lab] = emo.get(lab, 0) + 1
                        except Exception as e:
                            errs.setdefault("emotion_error", str(e)[:100])
            except Exception as e:
                errs.setdefault("face_error", str(e)[:100])

        if obj_net is not None and sampled % 2 == 0:  # every ~4s (SSD is heavier)
            try:
                for lab in _objects(frame, obj_net):
                    obj[lab] = obj.get(lab, 0) + 1
            except Exception as e:
                errs.setdefault("object_error", str(e)[:100])
        i += step
        if sampled > 300:
            break
    cap.release()

    res = {"avg_brightness": round(sum(bright) / len(bright), 1) if bright else None}
    if face_net is not None:
        res["talking_head_ratio"] = round(faces / sampled, 2) if sampled else None
    if emo:
        tot = sum(emo.values())
        res["dominant_emotion"] = max(emo, key=emo.get)
        res["emotion_mix"] = {k: round(v / tot, 2) for k, v in sorted(emo.items(), key=lambda x: -x[1])[:3]}
    elif "emotion_error" in errs:
        res["emotion_error"] = errs["emotion_error"]

    objects = [k for k, _ in sorted(obj.items(), key=lambda x: -x[1]) if k != "other"][:5]
    if objects:
        res["top_objects"] = objects
    elif "object_error" in errs:
        res["object_error"] = errs["object_error"]  # only surface if nothing detected
    return res


def audio_signals(wav):
    try:
        import librosa
        import numpy as np
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


def thumbnail_signals(thumb_url, workdir):
    if not thumb_url:
        return {}
    try:
        import cv2
        import urllib.request
        p = os.path.join(workdir, "thumb.jpg")
        urllib.request.urlretrieve(thumb_url, p)
        img = cv2.imread(p)
        if img is None:
            return {}
        res = {"thumb_brightness": round(float(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).mean()), 1)}
        if os.path.exists(MODEL_FACE):
            fn = cv2.FaceDetectorYN.create(MODEL_FACE, "", (img.shape[1], img.shape[0]), 0.6)
            _, d = fn.detect(img)
            res["thumb_has_face"] = bool(d is not None and len(d) > 0)
        try:
            import pytesseract
            txt = pytesseract.image_to_string(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            words = [w for w in re.sub(r"[^A-Za-z0-9 ]", " ", txt).split() if len(w) > 1]
            res["thumb_text_words"] = len(words)
            res["thumb_text"] = " ".join(words[:8])
        except Exception:
            pass
        return res
    except Exception as e:
        return {"thumb_error": str(e)[:60]}


# ------------------------------------------------------------------- main -----

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: deep_analyze.py <url_or_id> [thumb_url]"}))
        return
    url = sys.argv[1]
    thumb_url = sys.argv[2] if len(sys.argv) > 2 else ""
    if not url.startswith("http"):
        url = f"https://www.youtube.com/watch?v={url}"

    workdir = tempfile.mkdtemp(prefix="dna_")
    result = {"url": url}
    try:
        video = download_video(url, workdir)
        vtt = try_subtitles(url, workdir)
        transcript = parse_vtt(vtt) if vtt else ""

        if video:
            wav = extract_audio(video, workdir)
            if not transcript:  # captions blocked -> whisper.cpp fallback
                transcript = whisper_transcribe(wav, workdir)
            result.update(editing_signals(video))
            result.update(vision_signals(video))
            audio = audio_signals(wav)
            result.update(audio)
            words = transcript.split()
            result["has_captions"] = bool(vtt)
            result["word_count"] = len(words)
            result["hook_text"] = " ".join(words[:60])
            dur = audio.get("duration_sec")
            if dur and words:
                result["speech_wpm"] = round(len(words) / (dur / 60))
        else:
            result["error"] = "no video stream downloaded"

        result.update(thumbnail_signals(thumb_url, workdir))
    except subprocess.CalledProcessError as e:
        result["error"] = (e.stderr or str(e))[:120]
    except Exception as e:
        result["error"] = str(e)[:120]
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
