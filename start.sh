#!/usr/bin/env bash
# Stream to Shorts - Linux / macOS launcher. Keep this terminal open while you work.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Run ./setup.sh first (once), then ./start.sh again."
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x tools/ffmpeg/ffmpeg ]; then
  echo "ffmpeg is not installed. Run ./setup.sh first (once), then ./start.sh again."
  exit 1
fi
echo "Starting Stream to Shorts... your browser will open automatically."
echo
echo "  Keep this terminal open while you work. Closing it (or Ctrl+C) stops the app and any rendering."
echo "  If it stops by mistake, run ./start.sh again: the app offers to resume your tasks."
echo
exec node app/server.js "$@"
