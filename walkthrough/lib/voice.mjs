// Voice narration with ElevenLabs: the lines a flow's steps narrate (`narrate: '…'` on a director
// call), spoken by one voice in one take and cut into lines, cached, so re-recording a flow costs
// nothing until its lines change.
//
// Needs ELEVENLABS_API_KEY in the environment. The voice is the flow's `voice` export, or
// --voice / ELEVENLABS_VOICE. Never put the key in the repo.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const MODEL = 'eleven_turbo_v2_5';
const SETTINGS = {stability: 0.55, similarity_boost: 0.8, style: 0, use_speaker_boost: true};
const LEAD_IN = 'Okay.'; // spoken first and cut off: the take's first sound is often clipped
const GAP = '<break time="1.0s" />';
const PRE = 0.12; // s kept before a line's first sound, so its opening consonant isn't lost

/** The lines a flow narrates, from its source (`narrate: '…'`), in order. */
export function narrationLines(source) {
  return [...source.matchAll(/narrate:\s*(['"`])(.*?)\1/g)].map(m => m[2]);
}

const run = (cmd, args) => execFileSync(cmd, args, {maxBuffer: 1 << 28}).toString();
const durationOf = file => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

/**
 * Every line a flow narrates, spoken as **one take** and cut into lines. Made one request at a
 * time, each clip's first sound tends to come out clipped ("Umami" heard as "Mami", "Save" as
 * "ave"); inside one continuous take every line but the first starts mid-speech, as a narrator
 * reads, and the first follows a lead-in that's cut off. ElevenLabs gives each character's time,
 * so the take is cut exactly. Cached in `dir` by the lines, voice and settings.
 * Writes `<dir>/lines.json`; returns {text: {file, duration}}.
 */
export function voiceFlow(source, {voice, dir, key = process.env.ELEVENLABS_API_KEY}) {
  const lines = narrationLines(source);
  mkdirSync(dir, {recursive: true});
  const text = `${LEAD_IN} ${GAP} ${lines.join(` ${GAP} `)}`;
  const id = createHash('sha256').update(JSON.stringify({MODEL, voice, SETTINGS, text})).digest('hex').slice(0, 16);
  const take = join(dir, `take-${id}.mp3`), timing = join(dir, `take-${id}.json`);
  if (!existsSync(take)) {
    if (!key) throw new Error('narration needs ELEVENLABS_API_KEY');
    const tmp = `${timing}.part`;
    // curl, not fetch: it goes through the machine's HTTPS proxy, if it has one
    const status = run('curl', ['-sS', '-o', tmp, '-w', '%{http_code}', '-X', 'POST', `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
      '-H', `xi-api-key: ${key}`, '-H', 'content-type: application/json', '-d', JSON.stringify({text, model_id: MODEL, voice_settings: SETTINGS})]);
    if (status !== '200') throw new Error(`ElevenLabs answered ${status}: ${readFileSync(tmp, 'utf8').slice(0, 300)}`);
    const answer = JSON.parse(readFileSync(tmp, 'utf8'));
    writeFileSync(take, Buffer.from(answer.audio_base64, 'base64'));
    writeFileSync(timing, JSON.stringify(answer.alignment));
    rmSync(tmp);
  }
  const al = JSON.parse(readFileSync(timing, 'utf8'));
  const chars = al.characters.join(''), st = al.character_start_times_seconds, en = al.character_end_times_seconds;
  if (chars !== text) throw new Error("ElevenLabs' timings don't match the text sent");
  const out = {};
  let pos = text.indexOf(GAP) + GAP.length, prevEnd = 0;
  lines.forEach((line, i) => {
    const a = chars.indexOf(line, pos), b = a + line.length - 1;
    pos = b + 1;
    const next = i + 1 < lines.length ? chars.indexOf(lines[i + 1], pos) : -1;
    const start = Math.max(prevEnd, st[a] - PRE);
    const end = Math.min(en[b] + 0.25, next > 0 ? st[next] - 0.15 : Infinity);
    prevEnd = end;
    const file = join(dir, `line-${id}-${i}.mp3`);
    if (!existsSync(file)) run('ffmpeg', ['-v', 'error', '-y', '-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', take, '-c:a', 'libmp3lame', '-q:a', '2', file]);
    out[line] = {text: line, file, duration: durationOf(file)};
  });
  writeFileSync(join(dir, 'lines.json'), JSON.stringify({voice, model: MODEL, lines: out}, null, 2));
  return out;
}

/**
 * Lays the narration over a finished video: each line at the moment its step began (seconds of the
 * video, from beats.json). Writes `dest` (the video copied, with the voice as its sound track).
 */
export function mixNarration(video, beats, lines, dest) {
  const spoken = beats.filter(b => b.narrate && lines[b.narrate]);
  if (!spoken.length) return 0;
  const inputs = spoken.flatMap(b => ['-i', lines[b.narrate].file]);
  const delays = spoken.map((b, i) => `[${i + 1}:a]adelay=${Math.round(b.voiceAt * 1000)}:all=1[a${i}]`).join(';');
  const mix = `${delays};${spoken.map((_, i) => `[a${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[voice]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', video, ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[voice]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', dest]);
  return spoken.length;
}
