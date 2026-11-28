# Roadmap

What is planned for Stream → Shorts. Progress is tracked on the **[project board](https://github.com/users/ANIR13/projects)**; each item links to an issue where you can comment or offer help.

Nothing here is a promise or a date: priorities change with feedback. If something matters to you, give the issue a 👍 or open a [feature request](https://github.com/ANIR13/stream-to-shorts/issues/new?template=feature_request.yml).

## Next

- **First tagged release** (1.1.0) with downloadable ZIPs on the Releases page (the release workflow is ready).
- **ES modules** for the interface (it is now split by feature into plain scripts, see docs/ARCHITECTURE.md).

## Later

- **macOS support** (setup and launcher scripts).
- **More caption styles** and animations, with presets to share.
- **More languages** for the interface (contributions welcome: see `app/public/i18n.js`).
- **Chat and event markers** (for example from a Twitch chat log) as an extra highlight signal.

## Ideas being explored

- A **local language model** (llama.cpp) as an extra signal for smart detection: rating what is said, beyond word lists. See [docs/DETECTION.md](docs/DETECTION.md#extending-it).
- Game-specific events from the picture (kill feed, victory screen) and emotion from the voice itself.

- Automatic face tracking for the facecam box.
- Speaker-aware captions for streams with several voices.
- A packaged desktop build that doesn't need Node.js installed.

## Done

See the [changelog](CHANGELOG.md).
