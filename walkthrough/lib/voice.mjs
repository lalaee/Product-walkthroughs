// Voice narration with ElevenLabs: each line a step narrates (`narrate: '…'` on a director call),
// spoken by one voice, cached by its text, so re-recording a flow costs nothing for lines already
// made.
//
// Needs ELEVENLABS_API_KEY in the environment. The voice is the flow's `voice` export, or
// --voice / ELEVENLABS_VOICE. Never put the key in the repo.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const MODEL = 'eleven_multilingual_v2';

/** The lines a flow narrates, from its source (`narrate: '…'`), in order. */
export function narrationLines(source) {
  return [...source.matchAll(/narrate:\s*(['"`])(.*?)\1/g)].map(m => m[2]);
}

/** The audio for a line: a cached MP3 in `dir`, made with ElevenLabs if it isn't there. */
export function speak(text, {voice, dir, key = process.env.ELEVENLABS_API_KEY}) {
  mkdirSync(dir, {recursive: true});
  const id = createHash('sha256').update(`${MODEL}\n${voice}\n${text}`).digest('hex').slice(0, 16);
  const file = join(dir, `${id}.mp3`);
  if (!existsSync(file)) {
    if (!key) throw new Error('narration needs ELEVENLABS_API_KEY');
    const tmp = `${file}.part`;
    // curl, not fetch: it goes through the machine's HTTPS proxy, if it has one
    const status = execFileSync('curl', ['-sS', '-o', tmp, '-w', '%{http_code}', '-X', 'POST', `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
      '-H', `xi-api-key: ${key}`, '-H', 'content-type: application/json',
      '-d', JSON.stringify({text, model_id: MODEL, voice_settings: {stability: 0.5, similarity_boost: 0.75}})]).toString();
    if (status !== '200') throw new Error(`ElevenLabs answered ${status} for "${text}": ${existsSync(tmp) ? readFileSync(tmp, 'utf8').slice(0, 300) : ''}`);
    renameSync(tmp, file);
  }
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  return {text, file, duration};
}

/** Makes (or finds) every line a flow narrates; writes `<dir>/lines.json`. Returns {text: {file, duration}}. */
export function voiceFlow(source, {voice, dir}) {
  const lines = {};
  for (const text of narrationLines(source)) lines[text] = speak(text, {voice, dir});
  writeFileSync(join(dir, 'lines.json'), JSON.stringify({voice, model: MODEL, lines}, null, 2));
  return lines;
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
