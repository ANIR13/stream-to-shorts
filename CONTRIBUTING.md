# Contributing to Stream → Shorts

Thanks for wanting to help! Bug reports, ideas, translations and pull requests are all welcome. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md); for questions see [SUPPORT.md](SUPPORT.md), and report security problems privately as described in [SECURITY.md](SECURITY.md).

## Before you start

- **Bugs:** open an issue with the *Bug report* form. Include your system (Windows / Linux), what you did, what you expected, and the error from **Tasks → Technical details** if there is one.
- **Ideas and bigger changes:** open an issue with the *Feature request* form first, so we can agree on the approach before you spend time on it.
- **Small fixes** (typos, wording, obvious bugs): a pull request directly is fine.

## Run the app from source

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. Fork the repository and clone your fork.
3. Get the tools once: `setup.bat` on Windows, `./setup.sh` on Linux (Kali, Debian, Ubuntu).
4. Start it: `start.bat` / `./start.sh` (or `npm start`), then open http://127.0.0.1:5199.

There is no build step: edit the files, then reload the page (interface changes) or restart the app (changes in `app/server.js`).

## How the code is organised

The server is split into layers; **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** explains them and where new code belongs.

| File | Role |
|---|---|
| `app/server.js` | Entry point and HTTP routes: builds the application and calls the services. |
| `app/src/core/` | Pure logic (detection scoring, captions, render graph, upload texts): the easiest place to add and test logic. |
| `app/src/services/` | Detection, transcription, rendering, exports, presets, job queue. |
| `app/src/infrastructure/` | FFmpeg adapter, running programs, tools and environment, trash. |
| `app/src/repository/` | Projects on disk. |
| `app/public/app.js` | The web interface logic. |
| `app/public/layout.js` | 9:16 layout maths, shared by the live preview and the renderer: change both sides at once through this file. |
| `app/public/timing.js` | Clip time rules and snap-to-speech, shared by the editor and the server. |
| `app/public/i18n.js` | French translations of every interface text. |
| `app/public/index.html`, `styles.css` | Page structure and styles. |

## Project rules

1. **No dependencies.** Only Node.js built-ins on the server, plain HTML / CSS / JavaScript in the browser. No npm packages, no frameworks, no build tools.
2. **Fully local.** The app must never send anything over the internet, collect data or require an account. The server listens on `127.0.0.1` only.
3. **Windows and Linux.** Use `path.join`, avoid shell-specific commands, and keep platform-specific code in `app/src/infrastructure/` (see `process.js`, `environment.js`, `trash.js`).
4. **Two languages.** Every new text shown to users needs its French version in `app/public/i18n.js` (an exact entry, or a pattern for texts with numbers or names). Write the English text in the code; texts drawn on canvases go through `tr()`.
5. **Never lose user work.** Anything that deletes goes to the Recycle Bin / trash (`trash.recycle()`), and edits should stay undoable.
6. **Version project files.** If you add, rename or remove anything stored in `project.json`, bump the format and add a migration in `app/src/core/schema.js` (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#project-file-versions)).
7. **Keep the layers.** Logic goes in `app/src/core` (pure, tested), programs and the operating system only in `app/src/infrastructure`, and project files only through the repository.
8. **Never commit media or tools.** Recordings, rendered shorts, project data, ffmpeg, whisper and models are ignored by `.gitignore`; keep it that way.

## Before opening a pull request

- **`npm test` passes** (or `node --test tests/`). Add tests for new logic; see **[docs/TESTING.md](docs/TESTING.md)** for the four test levels. Run `npm run test:e2e` too if you touched rendering or FFmpeg (it needs FFmpeg).
- **Bug fixes come with a regression test** in `tests/regression/fixed-bugs.test.js` that fails without the fix.
- If a test against `tests/fixtures/baseline.json` fails because you changed the output **on purpose**, regenerate it with `node tests/fixtures/make-baseline.js` and say why in the pull request.
- You tried the change in the app: analyze a short video, edit a clip, render it (and a quick draft if you touched rendering).
- If you changed text: it reads well in English **and** French (switch with **EN / FR** at the top right).
- If you touched platform code: it still works on Windows and Linux (say in the pull request which ones you tested).
- One topic per pull request, with a clear title.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything users will notice.

## Code style

- 2-space indentation, single quotes, semicolons, `const` / `let`.
- Short comments that explain *why*, not *what*.
- Keep functions small and names descriptive; follow the style of the surrounding code.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) of this project.
