# Security policy

Stream → Shorts runs entirely on your own computer: a small web server bound to `127.0.0.1`, no account, no telemetry and no uploads. Security issues still matter: for example a way for a web page or another user on the same machine to read or delete files through the app, or to run commands.

## How the app protects you

Running locally, with no cloud and no account, removes whole classes of risk, but **a local app is not secure just because it has no server on the internet**. Your browser, other websites you visit, downloaded tools and files you receive can all reach it. These are the protections in place, each covered by automated tests (`tests/integration/security.test.js`, `untrusted-project.test.js`):

| Risk | Protection |
|---|---|
| Other computers on your network | The server listens on `127.0.0.1` only; no setting changes that. |
| **Other websites open in your browser** sending commands to the app (cross-site requests) or reading its answers (DNS rebinding) | Every request must come from the app's own page: the `Host` must be `127.0.0.1` or `localhost` with the app's port, and requests marked as coming from another site or origin are refused (`Origin`, `Sec-Fetch-Site`). Other sites can't embed or frame its answers (`Cross-Origin-Resource-Policy`, `X-Frame-Options`). |
| Script injection in the page (for example a title from a project file) | Text is escaped before display, and a strict Content Security Policy only runs the app's own scripts, so injected code doesn't run. |
| Paths outside the app folders (`../`, absolute paths, Windows device names) | Every file name from the browser, an import or a project file is checked: plain names only, inside `source/`, `output/` or `projects/`. |
| Running commands | Programs (ffmpeg, whisper, PowerShell for the Recycle Bin) are started with argument lists, never through a shell, and file paths are never pasted into command text. |
| Tampered or damaged downloads | The setup downloads only from fixed HTTPS addresses and checks SHA-256 before using a file: whisper.cpp and the speech models against checksums pinned in the scripts, ffmpeg against the checksum file of its release. On Linux, whisper.cpp is built from a pinned, verified commit. |
| Filling the disk or the task list | Imports are limited in size (64 GB by default, `S2S_MAX_UPLOAD_GB`) and refused when less than 2 GB would stay free; one import at a time; at most 300 waiting tasks. |
| Tools that keep running | Every task can be cancelled, and closing the app stops the tool that is running. |

## Opening project files from someone else

A project (`projects/<video>/project.json`) is plain data: clips, titles, captions and settings. It can't contain programs. Still, treat a project file from someone you don't know like any downloaded file:

- **What the app does:** when a project is loaded or saved, values that end up in file names, program arguments or the subtitle file are checked. A project whose video points outside `source/` is refused; unsafe clip names, output names, model names, fonts and numbers are replaced by safe defaults. A crafted project can't make the app read, write or delete files outside its folders.
- **What remains:** a project decides what is rendered from your own recording, and its titles and captions appear in your shorts, so check them before publishing. A very large project file can make the app slow. Import projects only from people you trust, and keep a copy of your own projects (the app keeps `project.v<N>.backup.json` when it upgrades one).
- **Never** run scripts or programs that come with a shared project; the app never needs them.

If you find a way around these protections, please report it privately (below).

## Supported versions

Only the latest version on the `main` branch receives security fixes. Update by pulling the latest code (or downloading the ZIP again) before reporting.

| Version | Supported |
|---|---|
| Latest `main` | Yes |
| Older copies | No: please update |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

1. Open the repository's **Security** tab and click **Report a vulnerability**. The report is private: only the maintainer can see it.
2. Describe the problem, the steps to reproduce it, your system (Windows / Linux, Node.js version) and what an attacker could do with it.
3. If you have a fix in mind, describe it in the report; please don't open a public pull request until the issue is fixed.

## What happens next

- You get a reply within **7 days** confirming the report.
- The maintainer checks the problem and keeps you informed of progress.
- Once a fix is released, the issue is published as a security advisory and you are credited, unless you prefer to stay anonymous.

## Automatic scanning

Every pull request and the `main` branch are scanned with GitHub **CodeQL**, and new dependencies or actions in a pull request are checked by **dependency review**. The app itself uses no npm packages (this is checked automatically), and Dependabot keeps the GitHub Actions up to date.

## Scope

**In scope:** the app's own code (`app/`, `setup.*`, `start.*`): the local server and its API (including requests from other websites), file access inside `source/`, `output/` and `projects/`, handling of project files, commands it runs, and the setup scripts and their checksums.

**Out of scope:** problems in FFmpeg, whisper.cpp or Node.js themselves (report them to those projects), attacks that require someone who already controls your user account, and running the server deliberately exposed to a network (it is designed to listen on `127.0.0.1` only).
