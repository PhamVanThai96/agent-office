#!/usr/bin/env python3
"""Chuyển giọng nói trong file âm thanh thành chữ (faster-whisper, chạy trên máy, không gọi API).
Dùng: transcribe.py <file> [model=small] [lang=vi]. In JSON {language, duration, text, segments:[{start,end,text}]} ra stdout."""
import json, sys
from faster_whisper import WhisperModel

path = sys.argv[1]
model = sys.argv[2] if len(sys.argv) > 2 else "small"
lang = sys.argv[3] if len(sys.argv) > 3 else "vi"
m = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=4)  # int8: nhẹ RAM, đủ nhanh trên CPU
segs, info = m.transcribe(path, language=None if lang == "auto" else lang, vad_filter=True, beam_size=1)
out = [{"start": round(s.start, 1), "end": round(s.end, 1), "text": s.text.strip()} for s in segs]
print(json.dumps({"language": info.language, "duration": round(info.duration, 1), "text": " ".join(x["text"] for x in out), "segments": out}, ensure_ascii=False))
