import { useCallback, useEffect, useRef, useState } from 'react';
import { PianoEngine } from './audio/pianoEngine';
import { PianoKeyboard } from './components/PianoKeyboard';
import { SettingsPanel } from './components/SettingsPanel';
import { noteName } from './lib/notes';
import {
  generateSequence,
  loadSettings,
  saveSettings,
  type SessionResult,
  type Settings,
} from './lib/training';

type Phase = 'idle' | 'playing' | 'listening' | 'completed';
type KeyKind = 'correct' | 'wrong' | 'playing';

const NOTE_DURATION_MS = 520;
const NOTE_GAP_MS = 620;
const KEYBOARD_START_MIDI = 21;
const KEYBOARD_END_MIDI = 108;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function loadRecentResults(): SessionResult[] {
  try {
    const raw = localStorage.getItem('piano-results');
    return raw ? (JSON.parse(raw) as SessionResult[]) : [];
  } catch {
    return [];
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: '准备练习',
  playing: '正在播放',
  listening: '请跟弹',
  completed: '完成',
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<number[]>([]);
  const [played, setPlayed] = useState<number[]>([]);
  const [playPass, setPlayPass] = useState(0);
  const [playTotalPass, setPlayTotalPass] = useState(0);
  const [message, setMessage] = useState('设置好音域与难度，点击「开始练习」');
  const [keyStatus, setKeyStatus] = useState<Map<number, KeyKind>>(new Map());
  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recent, setRecent] = useState<SessionResult[]>(() => loadRecentResults());
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);

  const engineRef = useRef<PianoEngine | null>(null);
  const timersRef = useRef<number[]>([]);
  const cancelTokenRef = useRef(0);
  const roundStartRef = useRef(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const setPhaseState = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  const playedRef = useRef(played);
  playedRef.current = played;
  const targetRef = useRef(target);
  targetRef.current = target;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const wrongCountRef = useRef(0);

  const midiHandlersRef = useRef({ onOn: (_midi: number) => {}, onOff: (_midi: number) => {} });

  const getEngine = useCallback((): PianoEngine => {
    if (!engineRef.current) {
      engineRef.current = new PianoEngine();
    }
    return engineRef.current;
  }, []);

  const flashKey = useCallback((midi: number, kind: KeyKind, durationMs: number) => {
    setKeyStatus((prev) => {
      const next = new Map(prev);
      next.set(midi, kind);
      return next;
    });
    const timer = window.setTimeout(() => {
      setKeyStatus((prev) => {
        const next = new Map(prev);
        if (next.get(midi) === kind) next.delete(midi);
        return next;
      });
    }, durationMs);
    timersRef.current.push(timer);
  }, []);

  const playSequence = useCallback(
    async (sequence: number[], passes: number, onFirstPassComplete?: () => void) => {
      const engine = getEngine();
      const token = cancelTokenRef.current + 1;
      cancelTokenRef.current = token;
      setPlayTotalPass(passes);
      const shouldStop = () =>
        token !== cancelTokenRef.current || phaseRef.current === 'completed';

      for (let pass = 1; pass <= passes; pass += 1) {
        if (shouldStop()) return;
        setPlayPass(pass);
        if (phaseRef.current === 'playing') {
          setMessage(`正在播放第 ${pass} / ${passes} 遍`);
        }

        for (const midi of sequence) {
          if (shouldStop()) return;
          if (settingsRef.current.showPlaybackKeys) {
            flashKey(midi, 'playing', 560);
          }
          engine.noteOn(midi);
          const timer = window.setTimeout(() => engine.noteOff(midi), NOTE_DURATION_MS);
          timersRef.current.push(timer);
          await sleep(NOTE_GAP_MS);
        }
        if (pass === 1 && onFirstPassComplete) {
          onFirstPassComplete();
        }
        if (pass < passes) await sleep(420);
      }

      if (token === cancelTokenRef.current) {
        setPlayPass(0);
      }
    },
    [flashKey, getEngine],
  );

  const startRound = useCallback(async () => {
    cancelTokenRef.current += 1;
    const sequence = generateSequence(settingsRef.current);
    if (sequence.length === 0) {
      setPhaseState('idle');
      setMessage('当前音域内可用音太少，请扩大音域范围');
      return;
    }

    targetRef.current = sequence;
    setTarget(sequence);
    playedRef.current = [];
    setPlayed([]);
    wrongCountRef.current = 0;
    setKeyStatus(new Map());
    setElapsedMs(0);
    setAnswerRevealed(false);
    roundStartRef.current = performance.now();
    setPhaseState('playing');

    const showFirstPassHint = () => {
      if (phaseRef.current !== 'playing') return;
      setPhaseState('listening');
      const answerHint = settingsRef.current.showAnswer
        ? `（答案：${sequence.map(noteName).join(' ')}）`
        : '';
      const nextStep = Math.min(sequence.length, playedRef.current.length + 1);
      setMessage(`请跟弹第 ${nextStep} 个音${answerHint}`);
    };

    await playSequence(sequence, settingsRef.current.playbackCount, showFirstPassHint);
    if (phaseRef.current === 'playing') {
      showFirstPassHint();
    }
  }, [playSequence]);

  const relisten = useCallback(async () => {
    const sequence = targetRef.current;
    if (sequence.length === 0) return;
    cancelTokenRef.current += 1;
    playedRef.current = [];
    setPlayed([]);
    setPhaseState('playing');

    await playSequence(sequence, 1);
    if (phaseRef.current !== 'playing') return;

    setPhaseState('listening');
    const nextStep = Math.min(sequence.length, playedRef.current.length + 1);
    setMessage(
      playedRef.current.length === 0
        ? '重新听完了，请从第 1 个音开始跟弹'
        : `继续跟弹第 ${nextStep} 个音`,
    );
  }, [playSequence]);

  const handleNoteOn = useCallback(
    (midi: number) => {
      getEngine().noteOn(midi);
      setPressedNotes((prev) => {
        const next = new Set(prev);
        next.add(midi);
        return next;
      });

      if (phaseRef.current !== 'listening' && phaseRef.current !== 'playing') return;
      const index = playedRef.current.length;
      const sequence = targetRef.current;
      if (index >= sequence.length) return;

      const currentSettings = settingsRef.current;
      const correct = midi === sequence[index];
      if (!correct) {
        const current = sequence[index];
        wrongCountRef.current += 1;
        flashKey(midi, 'wrong', 400);
        setMessage(`第 ${index + 1} 个音不对，再听一遍当前音`);

        if (currentSettings.autoReplayWrong) {
          const timer = window.setTimeout(() => {
            getEngine().noteOn(current);
            const offTimer = window.setTimeout(
              () => getEngine().noteOff(current),
              NOTE_DURATION_MS,
            );
            timersRef.current.push(offTimer);
          }, 450);
          timersRef.current.push(timer);
        }
        return;
      }

      flashKey(midi, 'correct', 420);
      const nextPlayed = [...playedRef.current, midi];
      playedRef.current = nextPlayed;
      setPlayed(nextPlayed);

      if (nextPlayed.length === sequence.length) {
        const elapsed = Math.round(performance.now() - roundStartRef.current);
        const wrong = wrongCountRef.current;
        setElapsedMs(elapsed);
        setPhaseState('completed');
        const result: SessionResult = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          finishedAt: Date.now(),
          sequenceLength: sequence.length,
          totalNotes: sequence.length,
          wrongNotes: wrong,
          elapsedMs: elapsed,
        };
        setRecent((prev) => [result, ...prev].slice(0, 10));
        setMessage(`完成！用时 ${formatDuration(elapsed)}，共弹错 ${wrong} 次`);
      } else {
        setMessage(`第 ${nextPlayed.length + 1} 个音，继续`);
      }
    },
    [flashKey, getEngine],
  );

  const handleNoteOff = useCallback(
    (midi: number) => {
      getEngine().noteOff(midi);
      setPressedNotes((prev) => {
        const next = new Set(prev);
        next.delete(midi);
        return next;
      });
    },
    [getEngine],
  );

  const revealAnswer = () => {
    setAnswerRevealed((prev) => {
      const next = !prev;
      if (next && targetRef.current.length > 0) {
        setMessage(`目标序列：${targetRef.current.map(noteName).join(' ')}`);
      } else if (phaseRef.current === 'listening') {
        setMessage(`请跟弹第 ${playedRef.current.length + 1} 个音`);
      }
      return next;
    });
  };

  useEffect(() => {
    midiHandlersRef.current = { onOn: handleNoteOn, onOff: handleNoteOff };
  }, [handleNoteOff, handleNoteOn]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem('piano-results', JSON.stringify(recent));
    } catch {
      // localStorage 不可用时静默跳过
    }
  }, [recent]);

  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;
    const inputs: MIDIInput[] = [];
    let access: MIDIAccess | null = null;
    let cancelled = false;

    const attach = (input: MIDIInput) => {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        const data = event.data;
        if (!data || data.length < 2) return;
        const command = data[0] & 0xf0;
        const midi = data[1];
        const velocity = data[2] ?? 0;
        if (command === 0x90 && velocity > 0) {
          midiHandlersRef.current.onOn(midi);
        } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
          midiHandlersRef.current.onOff(midi);
        }
      };
      inputs.push(input);
    };

    const onStateChange = () => {
      if (access) access.inputs.forEach(attach);
    };

    navigator
      .requestMIDIAccess()
      .then((midiAccess) => {
        if (cancelled) return;
        access = midiAccess;
        midiAccess.inputs.forEach(attach);
        midiAccess.addEventListener('statechange', onStateChange);
      })
      .catch(() => {
        // 没有 MIDI 设备时静默跳过
      });

    return () => {
      cancelled = true;
      if (access) access.removeEventListener('statechange', onStateChange);
      for (const input of inputs) input.onmidimessage = null;
    };
  }, []);

  useEffect(
    () => () => {
      cancelTokenRef.current += 1;
      for (const timer of timersRef.current) window.clearTimeout(timer);
      engineRef.current?.stopAll();
    },
    [],
  );

  const phaseClassName = phase;
  const currentStep = Math.min(played.length + 1, target.length);

  return (
    <div className="app">
      <div className="bg-ribbons" aria-hidden="true">
        <span className="ribbon r1" />
        <span className="ribbon r2" />
        <span className="ribbon r3" />
      </div>

      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark">♪</span>
          <h1 className="shimmer-text">钢琴耳训练</h1>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn settings-toggle"
            onClick={() => setSettingsOpen((prev) => !prev)}
          >
            {settingsOpen ? '收起设置' : '展开设置'}
          </button>
          <span className={`phase-pill ${phaseClassName}`}>{PHASE_LABEL[phase]}</span>
        </div>
      </header>

      <main className="content">
        <aside className={`settings-column ${settingsOpen ? 'open' : ''}`}>
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onStart={startRound}
            busy={phase === 'playing'}
          />
        </aside>

        <section className="train-column">
          <div className="train-status glass">
            <div className="status-head">
              <h2 className="status-title">
                {phase === 'idle' && '准备就绪'}
                {phase === 'playing' && `正在播放第 ${playPass} / ${playTotalPass} 遍`}
                {phase === 'listening' && `请跟弹 ${currentStep} / ${target.length}`}
                {phase === 'completed' && `本轮完成 · 用时 ${formatDuration(elapsedMs)}`}
              </h2>
              {target.length > 0 && (
                <div className="progress-dots" aria-label="跟弹进度">
                  {target.map((_, index) => (
                    <span
                      key={index}
                      className={
                        index < played.length
                          ? 'dot done'
                          : index === played.length && phase === 'listening'
                            ? 'dot current'
                            : 'dot'
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="feedback glass">
            <p className="feedback-message">{message}</p>
            {(settings.showAnswer || answerRevealed) && target.length > 0 && (
              <p className="answer-line">
                目标序列：<strong>{target.map(noteName).join(' ')}</strong>
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                onClick={startRound}
                disabled={phase === 'playing'}
              >
                下一题
              </button>
              <button
                type="button"
                className="btn"
                onClick={relisten}
                disabled={target.length === 0 || phase === 'playing'}
              >
                重听一遍
              </button>
              <button type="button" className="btn" onClick={revealAnswer} disabled={target.length === 0}>
                {answerRevealed ? '隐藏答案' : '显示答案'}
              </button>
            </div>
          </div>

          <div className="recent glass">
            <h2>最近练习</h2>
            {recent.length === 0 ? (
              <p className="recent-empty">还没有记录，完成一轮练习后会显示在这里。</p>
            ) : (
              <ul className="recent-list">
                {recent.slice(0, 5).map((result) => (
                  <li key={result.id} className="recent-item">
                    <span>
                      {new Date(result.finishedAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      · {result.sequenceLength} 音
                    </span>
                    <span>
                      弹错 {result.wrongNotes} 次 · {formatDuration(result.elapsedMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <div className={`keyboard-area ${phaseClassName}`}>
        <PianoKeyboard
          startMidi={KEYBOARD_START_MIDI}
          endMidi={KEYBOARD_END_MIDI}
          activeNotes={pressedNotes}
          statusMap={keyStatus}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
        />
        <div className="keyboard-flow" aria-hidden="true" />
      </div>
    </div>
  );
}
