// Instructional captions: one short line per step, drawn by Recordly (its captions track), in a band
// of background above the recording so they never cover the app.
//
// A flow gives a step a caption with `caption: 'Click Add website'` on the director call. Each
// caption comes up just before its step and stays until the next one (the last until the end).
// Captions are one line: keep them to an instruction (about 45 characters at most).

export const CAPTION_CHARS = 48;
export const NARRATION_CHARS = 96; // narrated captions show the spoken line: up to two lines

// Sizes in Recordly's units: its layout is relative to a 1080-line frame (render/compositor.ts).
const FONT_SIZE = 32; // caption fontSize: drawn at fontSize × 1.6 per 1080 lines (~51 px, ~4.7% of the height)
const MARGIN = 16; // space above and below the caption box in its band, per 1080 lines
const LEAD = 0.35; // s a caption comes up before its step

/** Recordly's caption style for instructional captions. */
export const CAPTION_STYLE = {
  show: true, animation: 'fade', fontSize: FONT_SIZE, font: 'Inter', bold: true, italic: false, underline: false, uppercase: false,
  color: '#FFFFFF', rows: 1, maxWidth: 90, radius: 10, bgOpacity: 78, manualAdd: true
};

/**
 * The captions: [{id, start, end, text}] in seconds of the video. By default the steps' own
 * instructional captions, each from just before its step; `narrated`, the spoken lines, each from
 * the moment it's spoken. Either stays until the next.
 */
export function captionsFor(beats, duration, {narrated = false} = {}) {
  const steps = beats.filter(b => (narrated ? b.narrate && b.voiceAt != null : b.caption)).sort((a, b) => a.t - b.t);
  const out = [];
  steps.forEach((b, i) => {
    const at = narrated ? b.voiceAt : b.t - LEAD;
    const start = Math.max(0, out.length ? out.at(-1).start + 0.3 : 0, at);
    if (out.length) out.at(-1).end = +(start - 0.02).toFixed(3);
    out.push({id: `cap-${i}`, start: +start.toFixed(3), end: +(duration - 0.05).toFixed(3), text: narrated ? b.narrate : b.caption});
  });
  return out;
}

/**
 * Puts the captions into a Recordly document: the captions track, their style, and a band above
 * the recording to show them in (the scene's top padding), sized for one line.
 * `aspect` is the output's width / height; `sourceAspect` the recording's.
 */
export function applyCaptions(doc, beats, {duration, aspect, sourceAspect = aspect, narrated = false}) {
  const captions = captionsFor(beats, duration, {narrated});
  if (!captions.length) return false;
  doc.captions = captions;
  const rows = narrated ? 2 : 1;
  doc.captionStyle = {...(doc.captionStyle ?? {}), ...CAPTION_STYLE, rows, maxWidth: narrated ? 82 : CAPTION_STYLE.maxWidth};
  // in 1080-line units: the caption box (one line, or two for spoken lines), and the band that holds it
  const k = 1.6, fs = FONT_SIZE * k, box = rows * fs * 1.3 + 2 * 6 * k, band = box + 2 * MARGIN;
  const H = 1080, W = H * aspect, unit = Math.min(W, H);
  const pad = doc.scene?.padding ?? 40;
  // padding is a % of a quarter of the shorter side (render/compositor.ts layout)
  const sides = {t: Math.max(pad, (band / (unit * 0.25)) * 100), l: pad, r: pad, b: pad};
  doc.scene = {...doc.scene, sides};
  // where the band ends: the top of the recording's frame, fitted inside the padding
  const P = s => (s / 100) * unit * 0.25;
  const innerW = W - P(sides.l) - P(sides.r), innerH = H - P(sides.t) - P(sides.b);
  const fh = Math.min(innerH, innerW / sourceAspect);
  const frameTop = P(sides.t) + (innerH - fh) / 2;
  // the caption box centred in the band; Recordly places it by its bottom edge (`bottom`, % of the
  // height from the bottom of the video)
  const top = (frameTop - box) / 2;
  doc.captionStyle.bottom = +(((H - top - box) / H) * 100).toFixed(2);
  return true;
}

/** The output's width / height for a Recordly aspect ('16:10', 'native', …), given the recording's. */
export const aspectOf = (aspect, sourceAspect) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? '');
  return m ? Number(m[1]) / Number(m[2]) : sourceAspect;
};

/** Applies a walkthrough's captions (beats.json) to its Recordly project document. */
export function captionWalkthrough(doc, {beats, meta, durationSec, narrated = false}) {
  const sourceAspect = meta.width / meta.height;
  return applyCaptions(doc, beats, {duration: durationSec, aspect: aspectOf(meta.aspect, sourceAspect), sourceAspect, narrated});
}
