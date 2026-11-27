#!/usr/bin/env bash
# Stream to Shorts - Linux setup (Kali, Debian, Ubuntu). Run once from the project folder: ./setup.sh
#   1. installs Node.js, ffmpeg, fonts and build tools with apt (asks for your password)
#   2. builds whisper.cpp (speech recognition) into tools/whisper/whisper-cli
#   3. downloads the speech model ggml-small.bin into tools/whisper/models/
# Parts that are already done are skipped, so it is safe to run again.
# Downloads are checked: whisper.cpp is a pinned version whose commit is verified, and the speech model
# is checked with SHA-256 before use. Packages come from your distribution's signed apt repositories.
set -euo pipefail
cd "$(dirname "$0")"
MODEL="${MODEL:-ggml-small.bin}"

# whisper.cpp, pinned: tag and the commit it must point to (github.com/ggml-org/whisper.cpp).
WHISPER_REF="b5907"
WHISPER_COMMIT="5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec"

# SHA-256 of the speech models (https://huggingface.co/ggerganov/whisper.cpp).
model_sha256() {
  case "$1" in
    ggml-tiny.bin) echo be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21 ;;
    ggml-tiny.en.bin) echo 921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f ;;
    ggml-tiny-q5_1.bin) echo 818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7 ;;
    ggml-tiny-q8_0.bin) echo c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca ;;
    ggml-tiny.en-q5_1.bin) echo c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b ;;
    ggml-tiny.en-q8_0.bin) echo 5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94 ;;
    ggml-base.bin) echo 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe ;;
    ggml-base.en.bin) echo a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002 ;;
    ggml-base-q5_1.bin) echo 422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898 ;;
    ggml-base-q8_0.bin) echo c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9 ;;
    ggml-base.en-q5_1.bin) echo 4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f ;;
    ggml-base.en-q8_0.bin) echo a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e ;;
    ggml-small.bin) echo 1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b ;;
    ggml-small.en.bin) echo c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d ;;
    ggml-small-q5_1.bin) echo ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb ;;
    ggml-small-q8_0.bin) echo 49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f ;;
    ggml-small.en-q5_1.bin) echo bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30 ;;
    ggml-small.en-q8_0.bin) echo 67a179f608ea6114bd3fdb9060e762b588a3fb3bd00c4387971be4d177958067 ;;
    ggml-medium.bin) echo 6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208 ;;
    ggml-medium.en.bin) echo cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356 ;;
    ggml-medium-q5_0.bin) echo 19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f ;;
    ggml-medium-q8_0.bin) echo 42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502 ;;
    ggml-medium.en-q5_0.bin) echo 76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0 ;;
    ggml-medium.en-q8_0.bin) echo 43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c ;;
    ggml-large-v1.bin) echo 7d99f41a10525d0206bddadd86760181fa920438b6b33237e3118ff6c83bb53d ;;
    ggml-large-v2.bin) echo 9a423fe4d40c82774b6af34115b8b935f34152246eb19e80e376071d3f999487 ;;
    ggml-large-v2-q5_0.bin) echo 3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2 ;;
    ggml-large-v2-q8_0.bin) echo fef54e6d898246a65c8285bfa83bd1807e27fadf54d5d4e81754c47634737e8c ;;
    ggml-large-v3.bin) echo 64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2 ;;
    ggml-large-v3-q5_0.bin) echo d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1 ;;
    ggml-large-v3-turbo.bin) echo 1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69 ;;
    ggml-large-v3-turbo-q5_0.bin) echo 394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2 ;;
    ggml-large-v3-turbo-q8_0.bin) echo 317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1 ;;
    *) return 1 ;;
  esac
}
MODEL_SHA="$(model_sha256 "$MODEL")" || { echo "Unknown speech model '$MODEL'."; exit 1; }

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
  git clone --depth 1 --branch "$WHISPER_REF" https://github.com/ggml-org/whisper.cpp "$tmp/whisper.cpp"
  got="$(git -C "$tmp/whisper.cpp" rev-parse HEAD)"
  if [ "$got" != "$WHISPER_COMMIT" ]; then
    echo "whisper.cpp $WHISPER_REF is commit $got, expected $WHISPER_COMMIT. Stopping: the download is not the expected code."
    rm -rf "$tmp"; exit 1
  fi
  cmake -S "$tmp/whisper.cpp" -B "$tmp/whisper.cpp/build" -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
  cmake --build "$tmp/whisper.cpp/build" -j"$(nproc)" --target whisper-cli
  mkdir -p tools/whisper
  cp "$tmp/whisper.cpp/build/bin/whisper-cli" tools/whisper/whisper-cli
  rm -rf "$tmp"
fi

echo
mkdir -p tools/whisper/models
sha_ok() { [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$MODEL_SHA" ]; }
if [ -f "tools/whisper/models/$MODEL" ] && sha_ok "tools/whisper/models/$MODEL"; then
  echo "3/3 Speech model: $MODEL already installed (checksum OK)"
else
  echo "3/3 Downloading the speech model $MODEL (about 470 MB for ggml-small.bin)"
  # HTTPS only, also after redirects
  curl -L --fail --proto '=https' --proto-redir '=https' --tlsv1.2 -o "tools/whisper/models/$MODEL.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL"
  if ! sha_ok "tools/whisper/models/$MODEL.part"; then
    rm -f "tools/whisper/models/$MODEL.part"
    echo "The speech model download is damaged or not the official file (SHA-256 mismatch). Run ./setup.sh again."
    exit 1
  fi
  echo "    checksum OK"
  mv "tools/whisper/models/$MODEL.part" "tools/whisper/models/$MODEL"
fi

chmod +x start.sh
echo
echo "Setup complete. Start the app with ./start.sh"
