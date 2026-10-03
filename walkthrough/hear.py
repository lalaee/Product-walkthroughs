#!/usr/bin/env python3
"""Listens to a walkthrough's narration, for agents that can't: transcribes each line (local
speech recognition, faster-whisper) and compares it with the script.

    python3 walkthrough/hear.py out/<flow>      # needs: pip install faster-whisper

For each line: what was heard, whether the words match the script, and how confidently its first
word was heard. A clipped opening ("Umami" heard as "Mami", "Save" as "ave") shows up as a
missing or wrong first word, or a low first-word confidence. Exits 1 if any line doesn't match.
"""
import json, re, sys
from pathlib import Path

from faster_whisper import WhisperModel

WEAK = 0.5  # first-word confidence below this: listen to that line

out = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
lines = json.loads((out / 'voice.json').read_text())
model = WhisperModel('small.en', device='cpu', compute_type='int8')
words = lambda s: re.findall(r"[a-z0-9']+", s.lower().replace('-', ' '))

bad = 0
for text, line in lines.items():
    segments, _ = model.transcribe(line['file'], word_timestamps=True, beam_size=5, condition_on_previous_text=False)
    heard = [w for s in segments for w in s.words]
    said = ''.join(w.word for w in heard).strip()
    match = words(said) == words(text)
    first = heard[0].probability if heard else 0
    flag = 'ok' if match and first >= WEAK else ('WEAK START' if match else 'MISMATCH')
    bad += flag != 'ok'
    print(f'{flag:10} first={first:.2f}  "{text}"' + ('' if match else f'\n{"":10} heard:     "{said}"'))
print(f'{len(lines) - bad} of {len(lines)} lines heard as written')
sys.exit(1 if bad else 0)
