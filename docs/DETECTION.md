# How moments are detected

**Auto-detect** suggests the strongest moments of a recording. There are two engines; you choose in the Auto-detect popover, and the choice is saved per video.

| | **Fast** (default) | **Smart** (optional) |
|---|---|---|
| Uses | Sound and on-screen action | Sound, action **and what is said** |
| Needs | The analysis (*Analyze video*) | The analysis and the transcript of the whole stream (*Captions & AI → Transcribe whole stream*) |
| Speed | Instant | Instant once the transcript exists (transcribing takes a while, once) |
| Finds | Loud reactions, hype, big plays | Also jokes and laughter, gaming moments, explanations, questions and answers, quiet but meaningful moments |
| Code | `app/src/core/detection.js` | `app/src/core/smart.js` |

Both run entirely on your computer. Neither sends anything anywhere.

## The smart score

Every second of the recording gets five signals between 0 and 1. A candidate clip gets the value of each signal over its strongest part, and its score is their weighted sum:

```
Score = wA·A + wV·V + wS·S + wE·E + wC·C        (weights normalized to add up to 1, shown as 0-100)
```

| Signal | Default weight | What raises it |
|---|---|---|
| **A**: audio excitement | 0.20 | Sustained loudness from 2 dB above the stream's usual level (full at 14 dB) and sudden peaks |
| **V**: visual activity | 0.15 | More change on screen than usual (full when about a quarter of the picture changes) |
| **S**: what is said | 0.35 | Gaming events (*kill, clutch, headshot, GG, victory, boss…*), insights and facts (*the trick is, did you know, en fait, l'astuce…*), questions, numbers, your **words to expect** and word fixes, words that are rare in this stream (the topic), how much is said |
| **E**: emotion | 0.20 | Laughter (*haha, lol, mdr, ptdr*, and laughter tags written by whisper such as `(laughs)`), excitement (*let's go, no way, c'est ouf…*), surprise, frustration, enthusiasm; exclamation marks, stretched words (*noooon*), capitals, speaking fast while it's loud |
| **C**: complete moment | 0.10 | The clip starts and ends on complete sentences; a question and its answer; a setup followed by a reaction (a punchline); a story |

**The default weights are starting points, not validated optimal values.** Adjust them in *Auto-detect → Advanced*; 0 turns a signal off. Setting S, E and C to 0 gives a sound-and-action ranking similar to the fast engine.

Because S and E don't depend on volume, a calm explanation or a dry joke can rank as high as a loud moment. Such clips are labelled *Quiet but meaningful*.

Smart clips start and end on pauses in speech when there is one nearby, and never in the middle of a word.

## Why this moment?

Select a clip to see its score, the share of each signal, and the reasons in plain words (*Laughter*, *Gaming moment "clutch"*, *A question and its answer*…). Click a time to jump there.

## What "semantic" means here, and its limits

The smart engine reads the transcript with word lists and simple rules. **It does not use a language model.** That keeps it fast, small, predictable and fully offline, but:

- It understands **English and French** cues. In other languages it still uses questions, exclamations, numbers, your words to expect, rare topic words, laughter tags and the sound, but misses language-specific phrases.
- It recognises **words, not meaning**: sarcasm, a joke without laughter, or an event nobody comments on are missed. A *kill* is detected when someone says it, not from the picture.
- It depends on the transcript: wrong words from whisper mean wrong signals. Words to expect and word fixes help.
- The weights and word lists were tested on synthetic streams (`tests/unit/smart.test.js`), not tuned on a collection of real streams.

## Extending it

Each signal is an array with one 0-1 value per second (`computeSignals` in `app/src/core/smart.js`), so a better analyser can replace or add one without touching the rest. For example:

- a **local language model** (llama.cpp with a small model) rating each transcript sentence for interest, as a new S or an extra signal;
- **game-specific** event detection from the picture (kill feed, victory screen);
- **laughter and emotion from the voice itself**, not only from words.

To change a word list, edit `LEX` in `app/src/core/smart.js` (words without accents; `kill*` matches any ending) and add a test in `tests/unit/smart.test.js`. Pull requests with word lists for other languages are welcome.
