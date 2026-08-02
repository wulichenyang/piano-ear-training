import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { buildRange, isBlackKey, noteName } from '../lib/notes';

export type KeyKind = 'correct' | 'wrong' | 'playing';

const MIN_KEY_SCALE = 0.7;
const MAX_KEY_SCALE = 2.6;

interface PianoKeyboardProps {
  startMidi: number;
  endMidi: number;
  activeNotes: Set<number>;
  statusMap: Map<number, KeyKind>;
  onNoteOn: (midi: number) => 'correct' | 'wrong' | null;
  onNoteOff: (midi: number) => void;
}

interface KeyButtonProps {
  midi: number;
  isBlack: boolean;
  active: boolean;
  status: KeyKind | undefined;
  label: string;
  style?: CSSProperties;
  onDown: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void;
  onUp: (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => void;
}

const KeyButton = memo(function KeyButton({
  midi,
  isBlack,
  active,
  status,
  label,
  style,
  onDown,
  onUp,
}: KeyButtonProps) {
  const parts = ['key', isBlack ? 'black-key' : 'white-key'];
  if (active) parts.push('is-pressed');
  if (status) parts.push(`is-${status}`);
  return (
    <button
      type="button"
      className={parts.join(' ')}
      aria-label={`琴键 ${label}`}
      data-midi={midi}
      style={style}
      onPointerDown={(event) => onDown(event, midi)}
      onPointerUp={(event) => onUp(event, midi)}
      onPointerCancel={(event) => onUp(event, midi)}
    >
      {!isBlack && <span className="key-label">{label}</span>}
    </button>
  );
});

export function PianoKeyboard({
  startMidi,
  endMidi,
  activeNotes,
  statusMap,
  onNoteOn,
  onNoteOff,
}: PianoKeyboardProps) {
  const notes = useMemo(() => buildRange(startMidi, endMidi), [startMidi, endMidi]);
  const whiteKeys = useMemo(() => notes.filter((midi) => !isBlackKey(midi)), [notes]);
  const blackKeys = useMemo(() => notes.filter((midi) => isBlackKey(midi)), [notes]);
  const slotWidth = 100 / whiteKeys.length;
  const blackKeyStyles = useMemo(
    () =>
      blackKeys.map((midi) => {
        const whiteBefore = whiteKeys.filter((white) => white < midi).length;
        return {
          left: `${whiteBefore * slotWidth}%`,
          width: `${slotWidth * 0.5}%`,
        } as CSSProperties;
      }),
    [blackKeys, whiteKeys, slotWidth],
  );
  const pointerToNote = useRef(new Map<number, number>());
  const pianoRef = useRef<HTMLDivElement>(null);
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchState = useRef<{
    startDistance: number;
    startScale: number;
    startMidX: number;
    startScrollLeft: number;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    engaged: boolean;
  } | null>(null);
  const centeredOnceRef = useRef(false);
  const keyScaleRef = useRef(1);
  const nextParticleIdRef = useRef(0);
  const nextRippleIdRef = useRef(0);
  const [keyScale, setKeyScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [particles, setParticles] = useState<
    { id: number; x: number; y: number; char: string; color: string }[]
  >([]);
  const [ripples, setRipples] = useState<
    { id: number; x: number; y: number; tone: 'correct' | 'wrong' | 'neutral' }[]
  >([]);

  useEffect(() => {
    const element = pianoRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      element.scrollLeft += event.deltaY + event.deltaX;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    const element = pianoRef.current;
    if (!element || centeredOnceRef.current) return;
    const target = element.querySelector<HTMLButtonElement>('[data-midi="64"]');
    if (!target) return;
    const centerE4 = () => {
      const scrollRect = element.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetCenter = targetRect.left + targetRect.width / 2 - scrollRect.left;
      const nextLeft = Math.max(
        0,
        Math.min(targetCenter - scrollRect.width / 2, element.scrollWidth - element.clientWidth),
      );
      element.scrollLeft = nextLeft;
      centeredOnceRef.current = true;
    };
    centerE4();
  }, []);

  const scrollByStep = (direction: number) => {
    const element = pianoRef.current;
    if (!element) return;
    const step = Math.max(220, element.clientWidth * 0.6);
    element.scrollBy({ left: direction * step, behavior: 'smooth' });
  };

  const resetZoom = () => {
    const element = pianoRef.current;
    const ratio = 1 / keyScaleRef.current;
    keyScaleRef.current = 1;
    setKeyScale(1);
    if (element) {
      element.scrollLeft = Math.max(0, element.scrollLeft * ratio);
    }
  };

  const handlePinchDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPointers.current.size >= 2) {
      panRef.current = null;
      setIsPanning(false);
    }
    if (touchPointers.current.size !== 2) return;

    const [first, second] = [...touchPointers.current.values()];
    const startDistance = Math.hypot(first.x - second.x, first.y - second.y);
    if (startDistance < 4) return;

    for (const [pointerId, midi] of pointerToNote.current) {
      pointerToNote.current.delete(pointerId);
      onNoteOff(midi);
    }
    pinchState.current = {
      startDistance,
      startScale: keyScaleRef.current,
      startMidX: (first.x + second.x) / 2,
      startScrollLeft: pianoRef.current ? pianoRef.current.scrollLeft : 0,
    };
  };

  const handlePinchMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    const position = touchPointers.current.get(event.pointerId);
    if (!position) return;
    position.x = event.clientX;
    position.y = event.clientY;

    const pinch = pinchState.current;
    if (!pinch || touchPointers.current.size < 2) return;
    const [first, second] = [...touchPointers.current.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    if (distance < 1) return;

    const nextScale = Math.min(
      MAX_KEY_SCALE,
      Math.max(MIN_KEY_SCALE, pinch.startScale * (distance / pinch.startDistance)),
    );
    const scaleRatio = nextScale / pinch.startScale;
    keyScaleRef.current = nextScale;
    setKeyScale(nextScale);

    const element = pianoRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const midX = (first.x + second.x) / 2;
    const contentX = pinch.startScrollLeft + (pinch.startMidX - rect.left);
    const nextScrollLeft = contentX * scaleRatio - (midX - rect.left);
    element.scrollLeft = Math.max(
      0,
      Math.min(nextScrollLeft, element.scrollWidth - element.clientWidth),
    );
  };

  const handlePinchEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    touchPointers.current.delete(event.pointerId);
    if (touchPointers.current.size < 2) {
      pinchState.current = null;
    }
  };

  const handleDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      event.preventDefault();
      if (pinchState.current) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerToNote.current.set(event.pointerId, midi);
      const judgment = onNoteOn(midi);

      const scroller = pianoRef.current;
      const keyRect = event.currentTarget.getBoundingClientRect();
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const colors = ['#4f8dff', '#8b5cf6', '#22c3a6', '#f2b84b'];
        const chars = ['♪', '♫', '♩', '♬'];
        const id = nextParticleIdRef.current;
        nextParticleIdRef.current += 1;
        setParticles((prev) => [
          ...prev.slice(-8),
          {
            id,
            x: keyRect.left - scrollerRect.left + scroller.scrollLeft + keyRect.width / 2,
            y: keyRect.top - scrollerRect.top + keyRect.height * 0.28,
            char: chars[midi % chars.length],
            color: colors[midi % colors.length],
          },
        ]);
        window.setTimeout(() => {
          setParticles((prev) => prev.filter((particle) => particle.id !== id));
        }, 900);

        const rippleId = nextRippleIdRef.current;
        nextRippleIdRef.current += 1;
        setRipples((prev) => [
          ...prev.slice(-6),
          {
            id: rippleId,
            x: event.clientX - scrollerRect.left + scroller.scrollLeft,
            y: event.clientY - scrollerRect.top + scroller.scrollTop,
            tone:
              judgment === 'correct' ? 'correct' : judgment === 'wrong' ? 'wrong' : 'neutral',
          },
        ]);
        window.setTimeout(() => {
          setRipples((prev) => prev.filter((ripple) => ripple.id !== rippleId));
        }, 550);
      }
    },
    [onNoteOn],
  );

  const handleUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
      if (pointerToNote.current.get(event.pointerId) === midi) {
        pointerToNote.current.delete(event.pointerId);
        onNoteOff(midi);
      }
    },
    [onNoteOff],
  );

  const handleKeysDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'mouse') return;
    if (pinchState.current || touchPointers.current.size >= 2) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: pianoRef.current ? pianoRef.current.scrollLeft : 0,
      engaged: false,
    };
  };

  const handleKeysMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'mouse') return;
    if (pinchState.current) return;
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;

    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (!pan.engaged) {
      if (Math.hypot(dx, dy) <= 10) return;
      const midi = pointerToNote.current.get(event.pointerId);
      if (midi !== undefined) {
        pointerToNote.current.delete(event.pointerId);
        onNoteOff(midi);
      }
      pan.engaged = true;
      pan.startLeft = pianoRef.current ? pianoRef.current.scrollLeft : 0;
      setIsPanning(true);
    }

    const element = pianoRef.current;
    if (!element) return;
    element.scrollLeft = Math.max(
      0,
      Math.min(pan.startLeft - dx, element.scrollWidth - element.clientWidth),
    );
  };

  const handleKeysEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'mouse') return;
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
      setIsPanning(false);
    }
  };

  return (
    <div className="piano-shell glass">
      <div className="piano-toolbar">
        <button
          type="button"
          className="keyboard-nav"
          aria-label="重置琴键缩放"
          onClick={resetZoom}
        >
          1x
        </button>
        <button
          type="button"
          className="keyboard-nav"
          aria-label="键盘向左滚动"
          onClick={() => scrollByStep(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="keyboard-nav"
          aria-label="键盘向右滚动"
          onClick={() => scrollByStep(1)}
        >
          ›
        </button>
      </div>

      <div className="piano-scroll" ref={pianoRef}>
        <div
          className={`piano-keys${isPanning ? ' is-panning' : ''}`}
          style={{ '--key-scale': keyScale } as CSSProperties}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDownCapture={handlePinchDown}
          onPointerMoveCapture={handlePinchMove}
          onPointerUpCapture={handlePinchEnd}
          onPointerCancelCapture={handlePinchEnd}
          onPointerDown={handleKeysDown}
          onPointerMove={handleKeysMove}
          onPointerUp={handleKeysEnd}
          onPointerCancel={handleKeysEnd}
        >
          <div className="white-key-row">
            {whiteKeys.map((midi) => (
              <KeyButton
                key={midi}
                midi={midi}
                isBlack={false}
                active={activeNotes.has(midi)}
                status={statusMap.get(midi)}
                label={noteName(midi)}
                onDown={handleDown}
                onUp={handleUp}
              />
            ))}
          </div>
          {blackKeys.map((midi, index) => (
            <KeyButton
              key={midi}
              midi={midi}
              isBlack
              active={activeNotes.has(midi)}
              status={statusMap.get(midi)}
              label={noteName(midi)}
              style={blackKeyStyles[index]}
              onDown={handleDown}
              onUp={handleUp}
            />
          ))}
          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className={`key-ripple${
                ripple.tone === 'correct'
                  ? ' is-correct'
                  : ripple.tone === 'wrong'
                    ? ' is-wrong'
                    : ''
              }`}
              style={{ left: ripple.x, top: ripple.y }}
            />
          ))}
          {particles.map((particle) => (
            <span
              key={particle.id}
              className="note-particle"
              style={{ left: particle.x, top: particle.y, color: particle.color }}
            >
              {particle.char}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
