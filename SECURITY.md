# Security policy

Stream → Shorts runs entirely on your own computer: a small web server bound to `127.0.0.1`, no account, no telemetry and no uploads. Security issues still matter: for example a way for a web page or another user on the same machine to read or delete files through the app, or to run commands.

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

## Scope

**In scope:** the app's own code (`app/`, `setup.*`, `start.*`): the local server and its API, file access inside `source/`, `output/` and `projects/`, commands it runs, and the setup scripts.

**Out of scope:** problems in FFmpeg, whisper.cpp or Node.js themselves (report them to those projects), attacks that require someone who already controls your user account, and running the server deliberately exposed to a network (it is designed to listen on `127.0.0.1` only).
