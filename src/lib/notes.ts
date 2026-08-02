export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function isBlackKey(midi: number): boolean {
  return NOTE_NAMES[midi % 12].includes('#');
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function buildRange(startMidi: number, endMidi: number): number[] {
  const notes: number[] = [];
  for (let midi = startMidi; midi <= endMidi; midi += 1) {
    notes.push(midi);
  }
  return notes;
}
