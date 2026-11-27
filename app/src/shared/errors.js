'use strict';
// Errors that carry an HTTP status, and plain-language explanations of common task failures.

function httpError(code, msg) { const e = new Error(msg); e.code = code; return e; }

// Plain-language explanation of common failures (the technical message stays available as details).
function friendlyError(msg) {
  const m = String(msg || '');
  if (/^Cancelled$/.test(m)) return 'Cancelled.';
  if (/ENOSPC|No space left/i.test(m)) return 'The disk is full. Free some space, then retry.';
  if (/EBUSY|EPERM|EACCES|Permission denied|being used by another process/i.test(m)) return 'A file is locked, probably open in a video player or in Explorer\'s preview. Close it, then retry.';
  if (/Speech model not found|whisper-cli(\.exe)? not found|whisper is missing/i.test(m)) return 'Speech recognition is not installed correctly. See the Captions & AI tab.';
  if (/Cannot start (ffmpeg|ffprobe)/i.test(m)) return 'FFmpeg is missing or could not start. Run the setup again (setup.bat on Windows, ./setup.sh on Linux); if it is installed, your antivirus may be blocking it.';
  if (/Cannot start whisper/i.test(m)) return 'Speech recognition (whisper) is missing or could not start. Run the setup again, or turn captions off.';
  if (/Cannot start/i.test(m)) return 'A tool in the tools folder could not start. It may be missing or blocked by antivirus.';
  if (/Clip was deleted|Clip not found/i.test(m)) return 'This clip was deleted before the task ran.';
  if (/too short/i.test(m)) return 'The clip is shorter than 1 second. Make it longer.';
  if (/Video not found|No such file or directory|ENOENT/i.test(m)) return 'A file is missing. Check that the video is still in the source folder.';
  if (/Invalid data found|moov atom not found/i.test(m)) return 'The video file looks damaged, or it is still being copied.';
  if (/Project not found/i.test(m)) return 'This video\'s project was removed. Open the video again.';
  if (/saved by a newer version/i.test(m)) return 'This project comes from a newer version of the app. Update the app on this computer to open it.';
  return 'Something went wrong. See the details below.';
}

module.exports = { httpError, friendlyError };
