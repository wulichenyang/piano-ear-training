import { buildRange, isBlackKey } from './notes';

export type KeySource = 'white' | 'all';

export interface Settings {
  settingsVersion: number;
  startOctave: number;
  endOctave: number;
  keySource: KeySource;
  sequenceLength: number;
  playbackCount: number;
  showAnswer: boolean;
  showPlaybackKeys: boolean;
  celebrateOnComplete: boolean;
  autoReplayWrong: boolean;
}

export interface SessionResult {
  id: string;
  finishedAt: number;
  sequenceLength: number;
  totalNotes: number;
  wrongNotes: number;
  elapsedMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: 2,
  startOctave: 4,
  endOctave: 5,
  keySource: 'white',
  sequenceLength: 3,
  playbackCount: 2,
  showAnswer: false,
  showPlaybackKeys: false,
  celebrateOnComplete: true,
  autoReplayWrong: false,
};

export function midiForOctaveStart(octave: number): number {
  return (octave + 1) * 12;
}

export function availableNotes(settings: Settings): number[] {
  const startMidi = midiForOctaveStart(settings.startOctave);
  const endMidi = midiForOctaveStart(settings.endOctave);
  const range = buildRange(startMidi, endMidi);
  return settings.keySource === 'white' ? range.filter((midi) => !isBlackKey(midi)) : range;
}

export function generateSequence(settings: Settings): number[] {
  const pool = availableNotes(settings);
  if (pool.length < settings.sequenceLength) return [];

  const sequence: number[] = [];
  let guard = 0;
  while (sequence.length < settings.sequenceLength && guard < 400) {
    guard += 1;
    const midi = pool[Math.floor(Math.random() * pool.length)];
    if (sequence.length === 0 || midi !== sequence[sequence.length - 1]) {
      sequence.push(midi);
    }
  }
  return sequence;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('piano-settings');
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings> & Record<string, unknown>;
    delete parsed.mode;
    if (Number(parsed.settingsVersion ?? 1) < 2) {
      parsed.showPlaybackKeys = false;
      parsed.autoReplayWrong = false;
      if (parsed.startOctave === 3 && parsed.endOctave === 5) {
        parsed.startOctave = DEFAULT_SETTINGS.startOctave;
        parsed.endOctave = DEFAULT_SETTINGS.endOctave;
      }
      parsed.settingsVersion = 2;
    }
    const startOctave = Math.min(7, Math.max(1, parsed.startOctave ?? DEFAULT_SETTINGS.startOctave));
    const endOctave = Math.min(8, Math.max(2, parsed.endOctave ?? DEFAULT_SETTINGS.endOctave));
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      startOctave,
      endOctave: Math.max(endOctave, startOctave + 1),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem('piano-settings', JSON.stringify(settings));
  } catch {
    // localStorage 不可用时静默跳过
  }
}
