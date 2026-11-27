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
function buildASS(p, clip, L, dur) {
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

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  const t1 = up(assEsc(clip.title1 || '')), t2 = up(assEsc(clip.title2 || ''));
  if (t1 || t2) {
    const size = Layout.titleSize(s, t1, t2);
    const lines = [t1, t2 ? `{\\c${assColor(s.titleColor2)}}${t2}` : ''].filter(Boolean).join('\\N');
    ev.push(`Dialogue: 1,${assTime(0)},${assTime(dur)},Title,,0,0,0,,{\\an8\\pos(540,${L.titleTop || 26})\\fs${size}\\fad(350,0)}${lines}`);
  }
  if (s.captions && clip.captionsOn !== false && Array.isArray(clip.captions)) {
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
  return head + ev.join('\n') + '\n';
}

// ffmpeg filter graph: blurred or dark background, facecam/gameplay crops, progress bar,
// subtitles, fades, loudness normalization. Reads subs.ass from the working folder.
function buildFilter(p, L, dur) {
  const s = p.style, fps = Number(s.fps) || 30;
  const fo = Math.max(0, dur - 0.5).toFixed(2);
  const blur = s.background !== 'dark';
  const n = L.items.length + (blur ? 1 : 0);
  const labels = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
  const f = [`[0:v]fps=${fps},setsar=1,split=${n}${labels}`];
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
  if (s.progressBar) {
    f.push(`color=c=0x${hex(s.accent)}:s=1080x14:r=${fps}:d=${dur}[bar]`);
    f.push(`[${last}][bar]overlay=x='-w+w*t/${dur}':y=1906:eof_action=pass[ob]`);
    last = 'ob';
  }
  f.push(`[${last}]ass=subs.ass,fade=t=in:st=0:d=0.3,fade=t=out:st=${fo}:d=0.5,format=yuv420p[v]`);
  if (p.meta.hasAudio) {
    f.push(`[0:a]${s.loudnorm ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=48000,afade=t=in:st=0:d=0.3,afade=t=out:st=${fo}:d=0.5[a]`);
  } else {
    f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur}[a]`);
  }
  return f.join(';\n');
}

// Quick drafts are rendered at half size.
const draftFilter = filter => filter.replace('format=yuv420p[v]', 'scale=540:960,format=yuv420p[v]');

const fileTitle = c => [c.title1, c.title2].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'clip';
// short_07_the_comeback.mp4: the clip's permanent number keeps names stable when clips move.
const shortName = clip => `short_${String(clip.num || 0).padStart(2, '0')}_${fileTitle(clip)}.mp4`;

// Processor (libx264) encoder arguments: final quality, or ultrafast for drafts.
const cpuEncoderArgs = (draft, crf) => (draft
  ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k']
  : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k']);

module.exports = { hex, assColor, assTime, assEsc, buildASS, buildFilter, draftFilter, fileTitle, shortName, cpuEncoderArgs };
