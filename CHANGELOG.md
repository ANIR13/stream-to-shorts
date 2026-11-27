# Changelog

All notable changes to Stream → Shorts are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Preview quality** option per video: 360p (fast) or 720p (sharp) preview copy.
- **Explainable highlight scoring:** each suggested clip shows why it was picked (loudness, peaks, on-screen action), and the weights and spacing can be adjusted per video.
- **Project file versions:** `project.json` now has a format number. Older projects are upgraded automatically, with the original kept as `project.v<N>.backup.json`; projects from a newer version of the app are refused instead of overwritten.
- **"File missing" label** for shorts whose video was deleted or moved outside the app. Those clips count as needing a render; the label disappears if the file comes back.
- **Automated tests in four levels** (unit, integration, end-to-end with the real FFmpeg, regression) with Node's built-in test runner; see [docs/TESTING.md](docs/TESTING.md).
- **Startup warnings** when FFmpeg, whisper or the speech model is missing, saying what to run.
- Community files: code of conduct, security policy, support guide, changelog, citation file and roadmap.

### Changed
- The server is split into layers (core logic, services, project repository, FFmpeg adapter). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The rendered shorts are unchanged.
- The README has screenshots, badges and a clearer layout.

### Fixed
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
