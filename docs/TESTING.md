# Testing

Stream → Shorts uses Node.js's built-in test runner (`node:test`), so testing adds no dependencies. Tests are grouped in four levels:

| Level | Folder | What it checks | Needs |
|---|---|---|---|
| **Unit** | `tests/unit/` | Pure logic: clip times, speech snapping, highlight detection, 9:16 layout, caption timing, render graph, upload texts. | Node.js only |
| **Integration** | `tests/integration/` | Pieces working together on temporary folders: project files and versions, restarts, the task queue, rendering and transcription services (with a fake ffmpeg / whisper), missing tools, interrupted renders. | Node.js only |
| **End-to-end** | `tests/e2e/` | The whole workflow with the **real FFmpeg** on a generated recording: open → analyze → suggested clips → captions → render → check the finished file → restart → cancel a render. | FFmpeg (skipped if missing) |
| **Regression** | `tests/regression/` | One test per bug that was fixed, named after what the user saw, so it can't come back. | Node.js only |

## Running them

```bash
npm test                    # everything (about 20 s; end-to-end is skipped without FFmpeg)
npm run test:unit           # a few seconds
npm run test:integration
npm run test:e2e            # needs FFmpeg: run setup first, or install it on the PATH
npm run test:regression
node --test tests/unit/timing.test.js     # a single file
```

The end-to-end test uses `tools/ffmpeg` when setup has been run, otherwise `ffmpeg` from the PATH. Speech recognition is not needed by any test.

## What is guaranteed, and where it is tested

| Guarantee | Tests |
|---|---|
| A clip always starts before it ends, inside the video, at least 2 s long (detected, edited or saved) | `unit/timing.test.js` (randomized), `regression` |
| With **Snap to speech** on, a clip never starts or ends in the middle of a word when there is a pause within 1.5 s | `unit/timing.test.js` (randomized, ~30 000 edges), `regression` |
| Every layout fits the 1080 × 1920 frame; finished shorts **are** 1080 × 1920 H.264, 30 fps, with sound and the clip's length | `unit/layout-captions.test.js`, `e2e/workflow.test.js` (checks the real file with ffprobe) |
| Captions are in sync with the audio | `unit/layout-captions.test.js` (whisper timestamps → caption lines → subtitle events), `e2e/workflow.test.js` (beeps at known times are heard within 0.1 s of their caption) |
| Projects survive restarts, and a crash while saving never damages a project | `integration/recovery.test.js`, `integration/repository.test.js`, `integration/schema.test.js`, `e2e` |
| Interrupted renders recover safely: a failed or cancelled render keeps the previous short and leaves no half-written file; after a crash the leftover is removed and the render can be resumed | `integration/recovery.test.js`, `e2e` (cancels a real FFmpeg render) |
| Missing FFmpeg, whisper or speech model give plain-language errors and startup warnings that say what to do | `integration/missing-tools.test.js` |
| The core gives the same results as before the modular refactor | `unit/core.test.js` against `tests/fixtures/baseline.json` |

Randomized tests use a fixed seed: a failure prints the values that broke the rule and happens again on every run.

## Writing tests

- **New logic** goes in `app/src/core/` or `app/public/layout.js` / `timing.js` (pure functions), with a unit test.
- **Fixing a bug?** Add a test to `tests/regression/fixed-bugs.test.js` first, named after what the user saw (*"shorts deleted outside the app still showed Rendered"*), with a comment on the cause. It must fail before your fix and pass after it.
- Use the helpers in `tests/helpers.js`: `tmpApp()` (temporary source/projects/output folders), `fakeFfmpeg()`, `realTools()` (real FFmpeg or `null`, to skip).
- Tests must not need the internet, a GPU, whisper or the user's own recordings, and must pass on Windows and Linux.
- If you change what a rendered short looks like **on purpose**, the baseline test fails: regenerate it with `node tests/fixtures/make-baseline.js` and say why in the pull request.
