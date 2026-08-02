import {
  useEffect,
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
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
}

export function PianoKeyboard({
  startMidi,
  endMidi,
  activeNotes,
  statusMap,
  onNoteOn,
  onNoteOff,
}: PianoKeyboardProps) {
  const notes = useMemo(() => buildRange(startMidi, endMidi), [startMidi, endMidi]);
  const whiteKeys = notes.filter((midi) => !isBlackKey(midi));
  const blackKeys = notes.filter((midi) => isBlackKey(midi));
  const slotWidth = 100 / whiteKeys.length;
  const pointerToNote = useRef(new Map<number, number>());
  const pianoRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; left: number } | null>(null);
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
  const keyScaleRef = useRef(1);
  const [keyScale, setKeyScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);

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

  const handleDown = (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    event.preventDefault();
    if (pinchState.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerToNote.current.set(event.pointerId, midi);
    onNoteOn(midi);
  };

  const handleUp = (event: ReactPointerEvent<HTMLButtonElement>, midi: number) => {
    if (pointerToNote.current.get(event.pointerId) === midi) {
      pointerToNote.current.delete(event.pointerId);
      onNoteOff(midi);
    }
  };

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

  const handleStripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = pianoRef.current;
    dragStart.current = { x: event.clientX, left: element ? element.scrollLeft : 0 };
  };

  const handleStripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const element = pianoRef.current;
    if (!element) return;
    element.scrollLeft = dragStart.current.left - (event.clientX - dragStart.current.x);
  };

  const handleStripEnd = () => {
    dragStart.current = null;
  };

  const keyClass = (midi: number, isBlack: boolean): string => {
    const status = statusMap.get(midi);
    const parts = ['key', isBlack ? 'black-key' : 'white-key'];
    if (activeNotes.has(midi)) parts.push('is-pressed');
    if (status) parts.push(`is-${status}`);
    return parts.join(' ');
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
              <button
                type="button"
                key={midi}
                className={keyClass(midi, false)}
                aria-label={`琴键 ${noteName(midi)}`}
                data-midi={midi}
                onPointerDown={(event) => handleDown(event, midi)}
                onPointerUp={(event) => handleUp(event, midi)}
                onPointerCancel={(event) => handleUp(event, midi)}
              >
                <span className="key-label">{noteName(midi)}</span>
              </button>
            ))}
          </div>
          {blackKeys.map((midi) => {
            const whiteBefore = whiteKeys.filter((white) => white < midi).length;
            return (
              <button
                type="button"
                key={midi}
                className={keyClass(midi, true)}
                aria-label={`琴键 ${noteName(midi)}`}
                data-midi={midi}
                style={{ left: `${whiteBefore * slotWidth}%`, width: `${slotWidth * 0.5}%` }}
                onPointerDown={(event) => handleDown(event, midi)}
                onPointerUp={(event) => handleUp(event, midi)}
                onPointerCancel={(event) => handleUp(event, midi)}
              />
            );
          })}
        </div>
      </div>

      <div
        className="scroll-strip"
        onPointerDown={handleStripDown}
        onPointerMove={handleStripMove}
        onPointerUp={handleStripEnd}
        onPointerCancel={handleStripEnd}
      />
    </div>
  );
}
