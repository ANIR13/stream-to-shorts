#!/usr/bin/env bash
# Stream to Shorts - Linux setup (Kali, Debian, Ubuntu). Run once from the project folder: ./setup.sh
#   1. installs Node.js, ffmpeg, fonts and build tools with apt (asks for your password)
#   2. builds whisper.cpp (speech recognition) into tools/whisper/whisper-cli
#   3. downloads the speech model ggml-small.bin into tools/whisper/models/
# Parts that are already done are skipped, so it is safe to run again.
set -e
cd "$(dirname "$0")"
MODEL="${MODEL:-ggml-small.bin}"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script uses apt (Kali, Debian, Ubuntu). On other systems install nodejs, ffmpeg, git, cmake and a C++ compiler, then build whisper.cpp as shown in README.md."
  exit 1
fi

echo "1/3 Installing Node.js, ffmpeg, fonts and build tools (sudo)"
sudo apt-get update
sudo apt-get install -y nodejs ffmpeg git cmake build-essential curl ttf-mscorefonts-installer

echo
if [ -x tools/whisper/whisper-cli ]; then
  echo "2/3 Speech recognition: already installed"
else
  echo "2/3 Building speech recognition, whisper.cpp (a few minutes)"
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$tmp/whisper.cpp"
  cmake -S "$tmp/whisper.cpp" -B "$tmp/whisper.cpp/build" -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
  cmake --build "$tmp/whisper.cpp/build" -j"$(nproc)" --target whisper-cli
  mkdir -p tools/whisper
  cp "$tmp/whisper.cpp/build/bin/whisper-cli" tools/whisper/whisper-cli
  rm -rf "$tmp"
fi

echo
mkdir -p tools/whisper/models
if [ -f "tools/whisper/models/$MODEL" ]; then
  echo "3/3 Speech model: $MODEL already installed"
else
  echo "3/3 Downloading the speech model $MODEL (about 470 MB for ggml-small.bin)"
  curl -L --fail -o "tools/whisper/models/$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL"
  mv "tools/whisper/models/$MODEL.part" "tools/whisper/models/$MODEL"
fi

chmod +x start.sh
echo
echo "Setup complete. Start the app with ./start.sh"
