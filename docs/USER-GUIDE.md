# Stream → Shorts: user guide

A local app that turns long stream recordings into vertical 9:16 Shorts, TikToks and Reels with animated captions.
Everything runs on this PC. There's no account, no login and no upload.

## Kali Linux (or Debian / Ubuntu)

The same app runs on Linux. Copy the whole project folder to the Linux machine (at least `app/`, `start.sh`, `source/`, `projects/`, `output/` and `tools/whisper/models/`). The `.exe` files in `tools/` are Windows programs; Linux ignores them.

1. Install what the app needs (once):

   ```bash
   sudo apt update
   sudo apt install -y nodejs ffmpeg ttf-mscorefonts-installer
   ```

   `ttf-mscorefonts-installer` adds Impact, Arial Black, Arial and Verdana for titles and captions (accept its licence when asked). Bahnschrift, Segoe UI Black and Tahoma are Windows-only fonts: Linux uses a similar font instead.

2. Speech recognition (for captions): build whisper.cpp once and put the program in `tools/whisper/`. Run this from the project folder:

   ```bash
   sudo apt install -y git cmake build-essential
   git clone --depth 1 https://github.com/ggml-org/whisper.cpp ~/whisper.cpp
   cmake -S ~/whisper.cpp -B ~/whisper.cpp/build -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release
   cmake --build ~/whisper.cpp/build -j"$(nproc)" --target whisper-cli
   cp ~/whisper.cpp/build/bin/whisper-cli tools/whisper/whisper-cli
   ```

   The speech model in `tools/whisper/models/` (`ggml-small.bin`) is the same file on Windows and Linux.

3. Start the app from the project folder:

   ```bash
   chmod +x start.sh
   ./start.sh
   ```

   Your browser opens at http://127.0.0.1:5199. Keep the terminal open while you work; Ctrl+C stops the app.

Notes for Linux:
- Deleted shorts and "start this video over" go to the desktop trash (through `gio`). Without a desktop they go to a `.trash` folder inside the project folder.
- Projects made on Windows open on Linux, and back, as long as the video file in `source/` has the same name.
- The graphics-card encoder works on Linux with NVIDIA (NVENC) or Intel (Quick Sync) drivers; otherwise renders use the processor.

## Language

The app shows in **French** when your browser is in French, otherwise in English. Switch with **EN / FR** at the top right. Your titles, captions and file names are never translated.

## Start

The first time, double-click **`setup.bat`** to download the tools (once). Then double-click **`start.bat`**. Your browser opens at http://127.0.0.1:5199. Close the black window to stop the app.

## Workflow

1. **Choose a video.** Put it in `source/` (fastest for big files, then click ⟳), click **＋ Import video**, or drop the video on the app window. A short **Getting started** checklist guides you through a new video.
2. **Analyze video.** The app scans loudness and on-screen action, builds a fast preview and suggests the strongest moments. A 45-minute stream takes a few minutes.
3. **Edit clips** on the left:
   - On the timeline: **drag across empty space** to create a clip, drag a clip to move it, and drag its edges to trim. Red marks show clips that share footage.
   - **Snap to speech** (on by default): clip edges stick to pauses and sentence ends, so a short never starts or ends mid-word. The blue line under the timeline shows speech. Hold **Alt** while dragging to place an edge freely.
   - **Video size: S / M / L** (next to Play) makes room for the editor on small screens.
   - Or use the Start/End fields, or press **I** / **O** to set start/end at the playhead.
   - Add a two-line title. If it is too long to fit, a note says how much it was shrunk. **💡 Title ideas** proposes three titles from what was said in the clip (worked out on this PC from the captions; edit them freely). Rendering a clip without a title asks first.
   - Above the list: search clips by title or number, show only *not rendered / outdated / untitled / failed / over 60 s*, and sort by time, strength or number.
   - **Layout / Style for this clip** override the project settings for one clip (e.g. facecam-only for a reaction).
   - Caption lines: **Enter** splits a line at the cursor, **Backspace** at the start joins it to the line above, and **✕** removes it. Fixing a word keeps its timing.
   - **Auto-detect** finds more moments. **＋ Add** creates a clip at the playhead. In **Captions & AI**, a search result of the whole-stream transcript has **＋ Clip** to make a clip right there.
   - Tick clips in the list to change many at once (captions, layout, style, trim to 60 s, delete) with the menu above the list.
   - Clips over 60 s get a **Trim to 60 s** button; rendering them asks first.
4. **Layout tab.** Drag the **FACECAM** and **GAMEPLAY** boxes over your video. Choose *Facecam + Gameplay*, *Gameplay only* or *Facecam only*.
5. **Safe zones.** Under the 9:16 preview, tick **Show what TikTok / Shorts / Reels cover** to see the areas their buttons and text hide. If your title or captions are in one, a warning appears with a one-click fix ("Keep the title below the apps' top bar" is also in the Style tab).
6. **Style tab.** Set fonts, colours, caption size and position, words per line, the background, the progress bar and quality. **Presets** save a look and reuse it on any video (three are built in).
7. **Captions & AI tab.** Set the spoken language, or keep auto-detect, and optionally translate the captions to English. Captions are generated on this PC with Whisper.
   - **Words to expect**: list names and jargon (e.g. *checkmate, en passant*) so the AI spells them right. If the AI ever copies this list into the captions during a silence, it is removed automatically.
   - **Word fixes**: words the AI keeps getting wrong (*made in two* → *mate in two*). They are applied to every new caption automatically; **Apply to all existing captions** fixes the ones you already have. In **Edit clip**, **Fix a word everywhere…** does the same in one step.
   - In **Edit clip**, click **Generate captions** to review and fix the words before rendering.
   - If you retrim a clip after correcting its captions, your corrections are kept. Only the added seconds are transcribed.
8. **Render.** Everything is in the **Render ▾** menu at the top: this clip, selected clips, **new & outdated only**, or all clips. Finished shorts go to `output/<video name>/` and keep their clip number (`short_07_…`) even if you add or move clips.
   - **⚡ Quick draft** (under the preview, or press **D**) renders 10 seconds from the playhead in low quality in about 10 seconds, to check the look before a full render.
   - Clips you change after rendering are marked **Outdated**.
   - The **Exports** tab plays each short, jumps to its clip, and can move a file to the Recycle Bin.
   - **Upload text:** each short gets a `.txt` next to it with a title, a description (your own, or a quote of what was said) and your hashtags. **Copy title** / **Copy description** put them on the clipboard. Set the hashtags at the top of the Exports tab.
   - **Encoder** (Style tab): *Faster (graphics card)* uses Intel Quick Sync / NVIDIA / AMD when available. On this PC it is about 15% faster with smaller files and very slightly lower quality; if it fails, the processor takes over automatically.

While tasks run, the top bar shows overall progress and the time left (e.g. *Rendering 4/13 · about 28 min left*). You get one notification when the whole batch is done.
The **Tasks** button (top right) lists every task. Cancelling asks for confirmation, and cancelled or failed tasks can be retried one by one or all at once. If a task fails, the message says why in plain words; **Technical details** has the exact error, with a Copy button.

**Keep the black window open while you work.** Closing it stops the app and any rendering. The page then shows a message, and when you run `start.bat` again it reconnects and offers to **resume** the stopped tasks. Unfinished renders never replace a finished short.

Edits save automatically. **Ctrl+Z** / **Ctrl+Y** (or the ↶ ↷ buttons at the top) undo and redo your changes to clips, titles, captions, layout and style, including auto-detect and word fixes. Rendered videos and generated captions are not undone. If the same video is open in two tabs, the app warns you; if both change it, you choose which version to keep.

Keyboard: everything can be reached with **Tab**. Press **?** in the app for the full list, including keys for the timeline, the layout boxes and caption lines. **Space** play/pause · **← / →** seek 1 s (Shift = 5 s) · **↑ / ↓** previous/next clip · **I / O** set clip start/end · **P** play clip · **D** quick draft · **Esc** close popups.

## Several videos

Each video in `source/` is its own project with its own clips, captions, hint words, word fixes, history and output folder (`output/<video name>/`). Nothing is shared between videos except style presets.

- Open another video from the list at the top. Once you have opened two or more, a **videos bar** appears for one-click switching. It shows each video's progress and any running tasks.
- Switching saves first. When you come back, the same clip, timeline zoom, tab, playhead and undo history are restored.
- Tasks for different videos share one queue (one render at a time keeps the PC responsive). The Tasks list groups them by video, and notifications name the video.

## Start a video over

The **⋯** button next to the video list opens this video's project or output folder, or **starts the video over**: its clips, edits, captions and analysis go to the Recycle Bin (recoverable), finished shorts are kept.

## Folders

| Folder | What's inside |
|---|---|
| `source/` | Your original recordings |
| `output/` | Rendered shorts |
| `projects/` | Your edits, analysis, preview files and caption cache (safe to delete; this resets a video) |
| `tools/` | ffmpeg, Whisper speech recognition and its model |
| `app/` | The app (Node.js, no extra packages) |

## Notes

- You need **Node.js** installed.
- Whisper models live in `tools/whisper/models/` (`setup.bat` / `setup.sh` download `ggml-small.bin`). For better accuracy, add `ggml-medium.bin` or `ggml-large-v3.bin` from https://huggingface.co/ggerganov/whisper.cpp. Bigger models are slower.
- For Arabic captions, pick **Arial** or **Tahoma** as the caption font, because Impact has no Arabic letters.

## Smart detection

**Auto-detect** has two engines:

- **Fast** (default): the loudest, most action-packed moments. Instant, needs only *Analyze video*.
- **Smart**: also listens to what is said. It finds jokes and laughter, gaming moments (kills, clutches, wins), explanations and facts, questions with their answers, and quiet moments where something interesting is said. Clips start and end on complete sentences.

Smart detection needs the transcript of the whole stream: click **Transcribe whole stream** in *Captions & AI* once (it takes a while), then choose **Smart** in the Auto-detect popover. Words to expect and word fixes improve it.

Select a clip to see **Why this moment?**: the share of each signal and the reasons, with times you can click. Under *Advanced* you can change how much each signal counts; the defaults are starting points, so adjust them to your streams. Details and limits: [how detection works](DETECTION.md).

## Sharing projects safely

You can copy a project folder (`projects/<video name>/`) to another computer together with its video. When you receive one from someone else:

- The app checks it when it opens and refuses or repairs anything unsafe (a video outside the `source` folder, file names that leave the app folders). It can't run programs.
- Its titles and captions end up in your shorts: read them before publishing.
- Only open projects from people you trust, and never run a script or program that comes with one.

More details: [SECURITY.md](../SECURITY.md).
