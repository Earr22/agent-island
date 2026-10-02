"""Encode native showcase frames; never capture or read the desktop."""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("input", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--ffmpeg")
args = parser.parse_args()
manifest = json.loads((args.input / "showcase-manifest.json").read_text(encoding="utf-8-sig"))
assert manifest["syntheticData"] and manifest["decisionCardRendered"] and manifest["decisionAnswered"]
assert manifest["bilingualCaptions"] and manifest["captionLanguages"] == ["zh-CN", "en"]
assert not any(manifest[key] for key in (
    "desktopCaptured", "sessionMonitoring", "clipboardRead",
    "windowsNotificationsRead", "httpListenerStarted",
))
paths = sorted((args.input / "frames").glob("frame-*.png"))
assert len(paths) == manifest["frameCount"] == 180
args.output.mkdir(parents=True, exist_ok=True)

# A shared palette keeps text and background stable between GIF frames.
with Image.open(args.input / "decision.png") as sample:
    palette = sample.convert("RGB").quantize(colors=192)
frames = []
for path in paths:
    with Image.open(path) as frame:
        assert frame.size == (manifest["width"], manifest["height"])
        frames.append(frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE))
durations = [round((i + 1) * 100 / manifest["fps"]) * 10 - round(i * 100 / manifest["fps"]) * 10 for i in range(len(frames))]
frames[0].save(args.output / "demo.gif", save_all=True, append_images=frames[1:],
               duration=durations, loop=0, optimize=True, disposal=1)
for name in ("quota", "work", "decision", "todos"):
    shutil.copyfile(args.input / f"{name}.png", args.output / f"{name}.png")

ffmpeg = args.ffmpeg or shutil.which("ffmpeg")
if not ffmpeg:
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
if ffmpeg:
    subprocess.run([
        ffmpeg, "-y", "-loglevel", "error", "-framerate", str(manifest["fps"]),
        "-i", str(args.input / "frames" / "frame-%04d.png"),
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-map_metadata", "-1",
        str(args.output / "demo.mp4"),
    ], check=True)
with Image.open(args.output / "demo.gif") as gif:
    total_duration = 0
    for index in range(gif.n_frames):
        gif.seek(index)
        total_duration += gif.info["duration"]
    assert total_duration == 15000 and gif.info["loop"] == 0
    print(json.dumps({"gifFrames": gif.n_frames, "durationMs": total_duration,
                      "dimensions": gif.size, "videoEncoded": bool(ffmpeg)}))
