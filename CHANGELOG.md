# Changelog

All notable changes to Stream → Shorts are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Smart detection** (optional, offline): a multi-signal score, Score = wA·A + wV·V + wS·S + wE·E + wC·C, combining audio excitement, visual activity, what is said (gaming events, insights, questions, hint words, topic words), emotion (laughter, excitement, surprise, frustration, enthusiasm) and context (complete sentences, question and answer, setup and punchline, story). It uses the transcript of the whole stream, with English and French word lists; the fast engine stays the default. Adjustable weights, reasons shown in "Why this moment?", clips that start and end on pauses. Whisper's laughter tags are kept for it. See [docs/DETECTION.md](docs/DETECTION.md).
- Project file format 3: detection settings store the engine and the five weights.
- **Preview quality** option per video: 360p (fast) or 720p (sharp) preview copy.
- **Explainable highlight scoring:** each suggested clip shows why it was picked (loudness, peaks, on-screen action), and the weights and spacing can be adjusted per video.
- **Project file versions:** `project.json` now has a format number. Older projects are upgraded automatically, with the original kept as `project.v<N>.backup.json`; projects from a newer version of the app are refused instead of overwritten.
- **"File missing" label** for shorts whose video was deleted or moved outside the app. Those clips count as needing a render; the label disappears if the file comes back.
- **Automated tests in four levels** (unit, integration, end-to-end with the real FFmpeg, regression) with Node's built-in test runner; see [docs/TESTING.md](docs/TESTING.md).
- **Continuous integration:** tests on Windows and Linux with Node.js 18, 20, 22 and 24, end-to-end tests with FFmpeg, CodeQL and dependency review, Dependabot for actions, and a release workflow that validates a tag and drafts the GitHub release.
- **Startup warnings** when FFmpeg, whisper or the speech model is missing, saying what to run.
- Community files: code of conduct, security policy, support guide, changelog, citation file and roadmap.

### Changed
- The server is split into layers (core logic, services, project repository, FFmpeg adapter). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The rendered shorts are unchanged.
- The README has screenshots, badges and a clearer layout.

### Security
- **The app only answers its own page:** other websites open in the browser can no longer send it commands or read its answers (cross-site requests and DNS rebinding are refused). Security headers and a strict Content Security Policy on every answer.
- **Project files are validated** when loaded and saved: a crafted project can no longer make a render delete or overwrite a file outside the output folder, point to a video outside `source/`, or inject lines into the subtitle file.
- **Imported videos:** strict file names, a size limit (64 GB, `S2S_MAX_UPLOAD_GB`), a free-space check, one import at a time, and no leftover files when an import is interrupted.
- **Verified downloads:** the setup pins whisper.cpp (release b5907) and checks the SHA-256 of whisper.cpp, the speech models and ffmpeg; on Windows it installs the newest stable ffmpeg release instead of the development build. Linux builds whisper.cpp from a verified commit.
- Links open without `cmd.exe`; closing the app stops the running ffmpeg or whisper; at most 300 waiting tasks.
- See [SECURITY.md](SECURITY.md) for the protections and the risks of opening someone else's project file.

### Fixed
- On Windows the app crashed at startup when setup had not been run yet.
- The video was shifted 2 px to the right in the gameplay and split layouts (a thin strip of background showed on the left). Shorts rendered before keep the old position until rendered again.
- Snap to speech could put a clip edge a few hundredths of a second into the next word after a short pause.
- A missing FFmpeg was reported as "Check that the video is still in the source folder"; it now says to run the setup again.
- A clip that ended before it started could be saved; clip times are now checked whenever a project is saved.
- A half-written short could stay in the output folder when the app was closed during a render; it is removed at the next start.
- Task list file could be damaged when two tasks finished at the same moment; it is now written atomically.

## [1.0.0] - 2026-11-26

First public release.

### Added
- Automatic detection of the strongest moments from loudness and scene changes, with a timeline to add and adjust clips.
- Vertical 9:16 layouts (facecam + gameplay, gameplay only, facecam only) with blurred background, title, progress bar and loudness normalisation.
- Offline word-by-word captions with whisper.cpp: word fixes, hint words, editable lines; clip edges snap to pauses in speech.
- Safe-zone overlay for TikTok / Shorts / Reels, quick 10-second drafts, a render queue that resumes after a restart, undo / redo.
- Upload texts (title, description, hashtags) saved next to every short.
- Several videos with separate projects, style presets, title ideas, bulk actions and keyboard shortcuts.
- English and French interface; Windows and Linux (Kali, Debian, Ubuntu) setup scripts and a Kali Linux PDF guide.
- Contributing guide, issue forms and pull request template.

[Unreleased]: https://github.com/ANIR13/stream-to-shorts/compare/c7ac084...HEAD
[1.0.0]: https://github.com/ANIR13/stream-to-shorts/commit/c7ac084
