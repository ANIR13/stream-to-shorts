'use strict';
// What a short looks like, as ffmpeg inputs: the subtitle file (title + captions) and the filter graph.
// Pure functions (no files, no programs).
const Layout = require('../../public/layout.js');

const hex = (c, fallback = 'FFFFFF') => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '') : fallback).toUpperCase();
const assColor = c => { const h = hex(c); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const assTime = t => {
  t = Math.max(0, t);
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
const assEsc = t => String(t).replace(/[\\{}]/g, '').replace(/\s+/g, ' ').trim();

// ASS subtitles: the two-line title and the captions (word-by-word highlight or static lines).
// p: the project as seen by this clip (Layout.effective), L: Layout.compute result, dur: seconds.
// x (from the timeline, optional): { texts: [{ text, start, end, y, size, color }], hideTitle, hideCaptions }.
// Without x the result is exactly what it always was.
function buildASS(p, clip, L, dur, x = {}) {
  const s = p.style;
  const up = t => s.uppercase ? t.toLocaleUpperCase() : t;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,${s.titleFont},${s.titleSize},${assColor(s.titleColor1)},&H000000FF&,&H00000000&,&H64000000&,0,0,0,0,100,100,1,0,1,6,2,8,40,40,26,1
Style: Caption,${s.captionFont},${s.captionSize},${assColor(s.captionColor)},&H000000FF&,&H00000000&,&H80000000&,0,0,0,0,100,100,1,0,1,7,3,5,70,70,0,1
${x.texts && x.texts.length ? `Style: Overlay,${s.titleFont},64,&H00FFFFFF&,&H000000FF&,&H00000000&,&H80000000&,0,0,0,0,100,100,1,0,1,5,2,5,60,60,0,1\n` : ''}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const t1 = up(assEsc(clip.title1 || '')), t2 = up(assEsc(clip.title2 || ''));
  if ((t1 || t2) && !x.hideTitle) {
    const size = Layout.titleSize(s, t1, t2);
    const lines = [t1, t2 ? `{\\c${assColor(s.titleColor2)}}${t2}` : ''].filter(Boolean).join('\\N');
    ev.push(`Dialogue: 1,${assTime(0)},${assTime(dur)},Title,,0,0,0,,{\\an8\\pos(540,${L.titleTop || 26})\\fs${size}\\fad(350,0)}${lines}`);
  }
  if (s.captions && clip.captionsOn !== false && Array.isArray(clip.captions) && !x.hideCaptions) {
    const y = L.captionY, hl = assColor(s.captionHighlight);
    for (const ch of clip.captions) {
      const words = (ch.words || []).map(w => ({ ...w, w: up(assEsc(w.w)) })).filter(w => w.w);
      if (!words.length) continue;
      const cs = ch.s - clip.start, ce = ch.e - clip.start;
      if (ce <= 0 || cs >= dur) continue;
      const pos = `{\\an5\\pos(540,${y})}`;
      if (s.highlightMode !== 'word') {
        ev.push(`Dialogue: 2,${assTime(cs)},${assTime(ce)},Caption,,0,0,0,,${pos}${words.map(w => w.w).join(' ')}`);
        continue;
      }
      words.forEach((w, i) => {
        const ws = i === 0 ? cs : w.s - clip.start;
        const we = i === words.length - 1 ? ce : words[i + 1].s - clip.start;
        if (we <= ws) return;
        const text = words.map((x, j) => j === i ? `{\\c${hl}\\fscx110\\fscy110}${x.w}{\\r}` : x.w).join(' ');
        ev.push(`Dialogue: 2,${assTime(ws)},${assTime(we)},Caption,,0,0,0,,${pos}${text}`);
      });
    }
  }
  for (const o of x.texts || []) {
    const text = assEsc(o.text || '');
    if (!text || !(o.end > o.start)) continue;
    ev.push(`Dialogue: 3,${assTime(o.start)},${assTime(Math.min(o.end, dur))},Overlay,,0,0,0,,{\\an5\\pos(540,${Math.round(o.y)})\\fs${Math.round(o.size)}\\c${assColor(o.color)}\\fad(200,200)}${text}`);
  }
  return head + ev.join('\n') + '\n';
}

// ffmpeg filter graph: blurred or dark background, facecam/gameplay crops, progress bar,
// subtitles, fades, loudness normalization. Reads subs.ass from the working folder.
// x (from the timeline, optional; see core/timeline.js):
//   cuts:   [{ a, b }] parts of input 0 to keep (seconds from the input start), joined as jump cuts
//   images: [{ input, x, y, w, start, end, opacity }] picture layers (input = ffmpeg input number)
//   music:  { input, gain, fadeIn, fadeOut, duck } a music track mixed under the stream
//   muteStream: true drops the stream's own sound
// Without x the result is exactly what it always was.
function buildFilter(p, L, dur, x = {}) {
  const s = p.style, fps = Number(s.fps) || 30;
  const fo = Math.max(0, dur - 0.5).toFixed(2);
  const blur = s.background !== 'dark';
  const n = L.items.length + (blur ? 1 : 0);
  const labels = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
  const f = [];
  let vIn = '[0:v]', aIn = '[0:a]';
  const hasAudio = !!p.meta.hasAudio;
  let normalized = false;
  if (x.cuts && x.cuts.length > 1) {
    // keep only these parts of the input and join them (jump cuts). The sound is normalized before it
    // is cut: loudnorm after the join misplaces the first part's audio when video is in the same graph
    // (found by tests/e2e/timeline.test.js with FFmpeg 7).
    const parts = [];
    const useAudio = hasAudio && !x.muteStream;   // a hidden stream sound is not cut or joined at all
    if (useAudio) {
      f.push(`[0:a]${s.loudnorm ? 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,' : ''}asplit=${x.cuts.length}${x.cuts.map((c, i) => `[la${i}]`).join('')}`);
      normalized = !!s.loudnorm;
    }
    x.cuts.forEach((c, i) => {
      f.push(`[0:v]trim=start=${r3(c.a)}:end=${r3(c.b)},setpts=PTS-STARTPTS[cv${i}]`);
      if (useAudio) f.push(`[la${i}]atrim=start=${r3(c.a)}:end=${r3(c.b)},asetpts=PTS-STARTPTS[ca${i}]`);
      parts.push(`[cv${i}]` + (useAudio ? `[ca${i}]` : ''));
    });
    f.push(`${parts.join('')}concat=n=${x.cuts.length}:v=1:a=${useAudio ? 1 : 0}[vcut]${useAudio ? '[acut]' : ''}`);
    vIn = '[vcut]'; aIn = '[acut]';
  }
  f.push(`${vIn}fps=${fps},setsar=1,split=${n}${labels}`);
  let k = 0;
  if (blur) {
    f.push(`[s${k++}]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=10,eq=brightness=-0.2:saturation=1.15,scale=1080:1920,setsar=1[bg]`);
  } else {
    f.push(`color=c=0x0E0E12:s=1080x1920:r=${fps}:d=${dur}[bg]`);
  }
  let last = 'bg';
  L.items.forEach((it, i) => {
    const { src, dst } = it;
    let chain = `[s${k++}]crop=${src.w}:${src.h}:${src.x}:${src.y}`;
    if (it.key === 'cam' && s.camBoost) chain += ',eq=brightness=0.05:contrast=1.08:saturation=0.95';
    chain += `,scale=${dst.w}:${dst.h}:flags=lanczos,setsar=1`;
    if (it.key === 'cam' && s.camBorder && p.layout.mode === 'split') chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x${hex(s.accent)}:t=6`;
    f.push(`${chain}[it${i}]`);
    f.push(`[${last}][it${i}]overlay=${dst.x}:${dst.y}${blur ? ':shortest=1' : ''}[o${i}]`);
    last = `o${i}`;
  });
  (x.images || []).forEach((im, i) => {
    const alpha = im.opacity < 1 ? `,colorchannelmixer=aa=${r3(im.opacity)}` : '';
    f.push(`[${im.input}:v]scale=${even(im.w)}:-2,format=rgba${alpha}[im${i}]`);
    f.push(`[${last}][im${i}]overlay=${Math.round(im.x)}:${Math.round(im.y)}:enable='between(t,${r3(im.start)},${r3(im.end)})'[oi${i}]`);
    last = `oi${i}`;
  });
  if (s.progressBar) {
    f.push(`color=c=0x${hex(s.accent)}:s=1080x14:r=${fps}:d=${dur}[bar]`);
    f.push(`[${last}][bar]overlay=x='-w+w*t/${dur}':y=1906:eof_action=pass[ob]`);
    last = 'ob';
  }
  f.push(`[${last}]ass=subs.ass,fade=t=in:st=0:d=0.3,fade=t=out:st=${fo}:d=0.5,format=yuv420p[v]`);
  const m = x.music;
  const out = m ? 'st' : 'a';   // with music, the stream's sound is mixed below
  if (hasAudio && !x.muteStream) {
    f.push(`${aIn}${s.loudnorm && !normalized ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=${fo}:d=0.5[${out}]`);
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur}[${out}]`);
  }
  if (m) {
    const mo = Math.max(0, dur - m.fadeOut).toFixed(2);
    f.push(`[${m.input}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${dur},volume=${r3(m.gain)},afade=t=in:st=0:d=${r3(m.fadeIn)},afade=t=out:st=${mo}:d=${r3(m.fadeOut)}[mu]`);
    if (m.duck && hasAudio && !x.muteStream) {
      // the music gets quieter while someone speaks (side-chain compression keyed on the stream)
      f.push('[st]asplit=2[st1][key]');
      f.push('[mu][key]sidechaincompress=threshold=0.04:ratio=8:attack=30:release=500[mud]');
      f.push('[st1][mud]amix=inputs=2:duration=first:normalize=0[a]');
    } else {
      f.push('[st][mu]amix=inputs=2:duration=first:normalize=0[a]');
    }
  }
  return f.join(';\n');
}

const r3 = v => Math.round(Number(v) * 1000) / 1000;
const even = v => Math.max(2, Math.round(Number(v) / 2) * 2);

// Quick drafts are rendered at half size.
const draftFilter = filter => filter.replace('format=yuv420p[v]', 'scale=540:960,format=yuv420p[v]');

const fileTitle = c => [c.title1, c.title2].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'clip';
// short_07_the_comeback.mp4: the clip's permanent number keeps names stable when clips move.
const shortName = clip => `short_${String(clip.num || 0).padStart(2, '0')}_${fileTitle(clip)}.mp4`;

// Processor (libx264) encoder arguments: final quality, or ultrafast for drafts (the balanced profile;
// see core/profiles.js for the others).
const cpuEncoderArgs = (draft, crf) => require('./profiles').cpuArgs('balanced', crf, draft);

module.exports = { hex, assColor, assTime, assEsc, buildASS, buildFilter, draftFilter, fileTitle, shortName, cpuEncoderArgs };
