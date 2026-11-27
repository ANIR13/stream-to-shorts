'use strict';
// FFmpeg adapter: the only place that knows how ffmpeg / ffprobe are called.
const { execFileSync } = require('child_process');

// ---- pure helpers (testable without ffmpeg) ----

// "ffmpeg version 9.0.2-4 ..." or "ffmpeg version n7.1 ..." -> 9 / 7; unknown builds count as 7.
function parseVersion(text) { return Number((String(text).match(/ffmpeg version n?(\d+)/) || [])[1]) || 7; }

// ffmpeg 7+ reads the render filter with "-/filter_complex file"; older versions need -filter_complex_script.
const filterArgFor = major => (major >= 7 ? '-/filter_complex' : '-filter_complex_script');

// ffprobe JSON -> the video facts the app needs.
function parseProbe(j) {
  const v = j.streams.find(s => s.codec_type === 'video');
  if (!v) throw new Error('No video stream found');
  const a = j.streams.find(s => s.codec_type === 'audio');
  const [n, d] = String(v.r_frame_rate || '30/1').split('/').map(Number);
  return { duration: Number(j.format.duration), width: v.width, height: v.height, fps: d ? n / d : 30, hasAudio: !!a, size: Number(j.format.size) };
}

// Shown when ffmpeg/ffprobe can't be started at all.
const MISSING_FFMPEG = 'FFmpeg is not installed or could not start. Run the setup again: setup.bat on Windows, ./setup.sh on Linux.';

const HW_ENCODERS = ['h264_qsv', 'h264_nvenc', 'h264_amf'];
const HW_NAMES = { h264_qsv: 'Intel Quick Sync', h264_nvenc: 'NVIDIA NVENC', h264_amf: 'AMD AMF' };
// Encoder arguments for a graphics-card encoder at a quality comparable to libx264 -crf <crf>.
function gpuArgsFor(encoder, crf) {
  if (encoder === 'h264_qsv') return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(crf), '-look_ahead', '0'];
  if (encoder === 'h264_nvenc') return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf + 3), '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (encoder === 'h264_amf') return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf + 2), '-pix_fmt', 'yuv420p'];
  return null;
}

// ---- the adapter ----
// ffmpegPath / ffprobePath: programs to run; runner: from infrastructure/process.
function createFfmpeg({ ffmpegPath, ffprobePath, runner }) {
  let major = null;
  let hwEncoder = null, hwReady = null;
  const api = {
    path: ffmpegPath,
    get major() {
      if (major == null) { try { major = parseVersion(execFileSync(ffmpegPath, ['-version']).toString()); } catch { major = 7; } }
      return major;
    },
    get filterArg() { return filterArgFor(api.major); },
    // Run ffmpeg as part of a job (progress, cancel, errors: see process.runProc).
    run: (job, args, opts) => runner.runProc(job, ffmpegPath, args, opts),
    async probe(src) {
      let out;
      try { out = await runner.runCapture(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src]); }
      catch (e) {
        if (/^Cannot start/.test(e.message)) throw new Error(`${MISSING_FFMPEG} (${e.message})`);
        throw e;
      }
      return parseProbe(JSON.parse(out));
    },
    // Find the first hardware H.264 encoder that works on this PC (once, in the background).
    detectHardware() {
      if (!hwReady) hwReady = (async () => {
        for (const e of HW_ENCODERS) {
          try { await runner.runCapture(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:r=30:d=0.5', '-c:v', e, '-f', 'null', '-']); hwEncoder = e; return; } catch { /* not available */ }
        }
      })();
      return hwReady;
    },
    get hardwareName() { return hwEncoder ? HW_NAMES[hwEncoder] : null; },
    gpuArgs: crf => gpuArgsFor(hwEncoder, crf),
  };
  return api;
}

module.exports = { MISSING_FFMPEG, createFfmpeg, parseVersion, filterArgFor, parseProbe, gpuArgsFor, HW_NAMES };
