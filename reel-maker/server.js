import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import Busboy from "busboy";

const app = express();

app.get("/health", (_, res) => res.send("ok"));

app.post("/render", (req, res) => {
  const bb = Busboy({ headers: req.headers, limits: { fileSize: 1024 * 1024 * 1024 } });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-"));
  const inVideo = path.join(tmpDir, "in_video");
  const inAudio = path.join(tmpDir, "in_audio");
  const outMp4 = path.join(tmpDir, "out.mp4");

  const fields = {
    topText: "Los 1000 momentos históricos que poca gente conoce",
    bottomText: "Texto inferior",
    num: "1",
    start: "0",
    end: "0",
    audioVolume: "1.0"
  };

  let videoPath = null;
  let audioPath = null;

  bb.on("field", (name, val) => { fields[name] = val; });

  bb.on("file", (name, file, info) => {
    const filename = info.filename || name;
    const ext = path.extname(filename).toLowerCase() || "";
    const target = name === "video" ? (inVideo + ext) : (inAudio + ext);
    const ws = fs.createWriteStream(target);
    file.pipe(ws);
    file.on("end", () => {
      if (name === "video") videoPath = target;
      if (name === "audio") audioPath = target;
    });
  });

  bb.on("close", () => {
    try {
      if (!videoPath) return res.status(400).send("Falta el vídeo");
      if (!audioPath) return res.status(400).send("Falta el audio (mp3/m4a/wav)");

      const start = Number(fields.start || 0);
      const end = Number(fields.end || 0);

      const num = String(fields.num || "1");
      const topText = String(fields.topText || "");
      const bottomText = String(fields.bottomText || "");
      const audioVolume = Number(fields.audioVolume || 1.0);

      const fontFile = path.resolve("fonts/BebasNeue-Regular.ttf");

      const topBand = 380;
      const bottomBand = 300;
      const numStrip = 160;

      const safeTop = 130;
      const barX = 80, barY = 46, barW = 920, barH = 12;

      const topLines = topText.split("\n").slice(0, 3);
      const topDraw = topLines.map((line, i) =>
        `drawtext=fontfile=${fontFile}:text='${escapeFF(line)}':x=(w-text_w)/2:y=${safeTop + i*90}:fontsize=110:fontcolor=white:borderw=8:bordercolor=0x00000099`
      ).join(",");

      const badgeText = `#${num}`;

      const pillW = 420, pillH = 112;
      const pillX = `(w-${pillW})/2`;
      const pillY = `${topBand} + (h-${topBand}-${bottomBand}-${numStrip}) + ((${numStrip}-${pillH})/2)`;

      const ssArgs = start > 0 ? ["-ss", String(start)] : [];
      const toArgs = (end && end > start) ? ["-to", String(end)] : [];

      const filter = [
        `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,format=yuv420p[v0]`,
        `[v0]drawbox=x=0:y=0:w=1080:h=${topBand}:color=black@1:t=fill,` +
          `drawbox=x=0:y=1920-${bottomBand}:w=1080:h=${bottomBand}:color=black@1:t=fill,` +
          `drawbox=x=0:y=${topBand}+(1920-${topBand}-${bottomBand}-${numStrip}):w=1080:h=${numStrip}:color=black@1:t=fill,` +
          `drawbox=x=${barX}:y=${barY}:w=${barW}:h=${barH}:color=white@0.18:t=fill,` +
          `drawbox=x=${barX}:y=${barY}:w=${barW}:h=${barH}:color=white@0.55:t=fill,` +
          `${topDraw},` +
          `drawbox=x=${pillX}:y=${pillY}:w=${pillW}:h=${pillH}:color=white@0.06:t=fill:radius=56,` +
          `drawbox=x=${pillX}:y=${pillY}:w=${pillW}:h=${pillH}:color=white@0.12:t=2:radius=56,` +
          `drawtext=fontfile=${fontFile}:text='${escapeFF(badgeText)}':x=(w-text_w)/2:y=${pillY}+78:fontsize=88:fontcolor=0xff7a00:shadowcolor=0x00000066:shadowx=0:shadowy=6,` +
          `drawtext=fontfile=${fontFile}:text='${escapeFF(bottomText)}':x=(w-text_w)/2:y=1920-${bottomBand}+80:fontsize=58:fontcolor=white:borderw=6:bordercolor=0x00000099` +
          `[v]`,
        `[1:a]volume=${audioVolume},aformat=fltp:44100:stereo[aud]`
      ].join(";");

      const ff = [
        ...ssArgs,
        "-i", videoPath,
        "-stream_loop", "-1",
        "-i", audioPath,
        ...toArgs,

        "-filter_complex", filter,
        "-map", "[v]",
        "-map", "[aud]",

        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-level", "4.1",
        "-preset", "veryfast",
        "-crf", "18",

        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "44100",

        "-shortest",
        "-movflags", "+faststart",
        outMp4
      ];

      const p = spawn("ffmpeg", ff, { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      p.stderr.on("data", d => err += d.toString());

      p.on("close", (code) => {
        if (code !== 0) {
          res.status(500).send("FFmpeg error:\n" + err.slice(-4000));
          cleanup(tmpDir);
          return;
        }
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="reel_${Date.now()}.mp4"`);
        fs.createReadStream(outMp4).pipe(res).on("close", () => cleanup(tmpDir));
      });

    } catch (e) {
      res.status(500).send(String(e?.message || e));
      cleanup(tmpDir);
    }
  });

  req.pipe(bb);
});

function cleanup(dir){
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function escapeFF(s){
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n");
}

app.listen(process.env.PORT || 10000, () => {
  console.log("Listening on", process.env.PORT || 10000);
});
