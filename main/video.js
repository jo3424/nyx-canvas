'use strict';
const { t, tr } = require('./i18n');
// ffmpeg helpers: probe, extract 16 kHz mono wav for whisper, export highlight clip, grab frame.
const { execFile } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const systools = require('./systools');
let ffmpegPath = null, ffprobePath = null;
async function resolve(settingsPath) {
  if (settingsPath && fs.existsSync(settingsPath)) ffmpegPath = settingsPath;
  if (!ffmpegPath) ffmpegPath = await systools.which('ffmpeg') || ['C:\\ffmpeg\\bin\\ffmpeg.exe'].find(p => fs.existsSync(p)) || null;
  if (ffmpegPath && !ffprobePath) { const pp = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'); ffprobePath = fs.existsSync(pp) ? pp : await systools.which('ffprobe'); }
  return ffmpegPath;
}
function run(bin, args, timeout = 600000) {
  return new Promise((res, rej) => execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 32 << 20 }, (e, out, err) => e ? rej(new Error(String(err || e.message).split('\n').slice(-4).join(' '))) : res(String(out))));
}
async function need() { const p = await resolve(); if (!p) throw new Error(t('video.034')); return p; }
async function probe(file) {
  await need(); if (!ffprobePath) return null;
  const out = await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], 20000);
  const j = JSON.parse(out); const v = (j.streams || []).find(s => s.codec_type === 'video'); const a = (j.streams || []).find(s => s.codec_type === 'audio');
  return { duration: +(j.format?.duration || 0), width: v?.width, height: v?.height, vcodec: v?.codec_name, acodec: a?.codec_name, hasAudio: !!a };
}
async function extractWav(file) {
  const ff = await need(); const out = path.join(os.tmpdir(), `nyx-a-${Date.now().toString(36)}.wav`);
  await run(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]);
  return out;
}
async function clip(file, t0, t1, out, reencode = true) {
  const ff = await need(); const dur = Math.max(0.1, t1 - t0);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t0), '-i', file, '-t', String(dur)];
  if (reencode) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'); else args.push('-c', 'copy');
  args.push(out); await run(ff, args); return out;
}
async function frame(file, t, out) { const ff = await need(); await run(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-q:v', '2', out], 60000); return out; }
module.exports = { resolve, probe, extractWav, clip, frame, get path() { return ffmpegPath; } };
