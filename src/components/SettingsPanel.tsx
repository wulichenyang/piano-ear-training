import type { KeySource, Settings, TrainingMode } from '../lib/training';
import { noteName } from '../lib/notes';
import { midiForOctaveStart } from '../lib/training';

interface SettingsPanelProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onStart: () => void;
  busy: boolean;
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={option.value === value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel({ settings, onChange, onStart, busy }: SettingsPanelProps) {
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const startOctaves = [2, 3, 4, 5].filter((octave) => octave < settings.endOctave);
  const endOctaves = [3, 4, 5, 6].filter((octave) => octave > settings.startOctave);
  const rangeStart = noteName(midiForOctaveStart(settings.startOctave));
  const rangeEnd = noteName(midiForOctaveStart(settings.endOctave));

  return (
    <section className="settings glass">
      <h2>练习设置</h2>
      <div className="field">
        <span>出题范围</span>
        <p className="range-hint">
          {rangeStart} - {rangeEnd}
        </p>
      </div>
      <div className="field-row">
        <label className="field">
          <span>起始八度</span>
          <select
            value={settings.startOctave}
            onChange={(event) => {
              const startOctave = Number(event.target.value);
              update({
                startOctave,
                endOctave: Math.max(settings.endOctave, startOctave + 1),
              });
            }}
          >
            {startOctaves.map((octave) => (
              <option key={octave} value={octave}>
                C{octave}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>结束八度</span>
          <select
            value={settings.endOctave}
            onChange={(event) => update({ endOctave: Number(event.target.value) })}
          >
            {endOctaves.map((octave) => (
              <option key={octave} value={octave}>
                C{octave}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field">
        <span>音符来源</span>
        <Segmented<KeySource>
          value={settings.keySource}
          options={[
            { value: 'white', label: '只白键' },
            { value: 'all', label: '黑白都有' },
          ]}
          onChange={(value) => update({ keySource: value })}
        />
      </div>

      <div className="field">
        <span>判断模式</span>
        <Segmented<TrainingMode>
          value={settings.mode}
          options={[
            { value: 'relative', label: '相对音程' },
            { value: 'pitch', label: '绝对音高' },
          ]}
          onChange={(value) => update({ mode: value })}
        />
      </div>

      <div className="field-row">
        <label className="field">
          <span>序列长度</span>
          <select
            value={settings.sequenceLength}
            onChange={(event) => update({ sequenceLength: Number(event.target.value) })}
          >
            {[2, 3, 4, 5].map((length) => (
              <option key={length} value={length}>
                {length} 个音
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>自动播放遍数</span>
          <select
            value={settings.playbackCount}
            onChange={(event) => update({ playbackCount: Number(event.target.value) })}
          >
            {[2, 3].map((count) => (
              <option key={count} value={count}>
                {count} 遍
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.autoReplayWrong}
          onChange={(event) => update({ autoReplayWrong: event.target.checked })}
        />
        <span>弹错自动重播当前音</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showAnswer}
          onChange={(event) => update({ showAnswer: event.target.checked })}
        />
        <span>播放后显示答案</span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showPlaybackKeys}
          onChange={(event) => update({ showPlaybackKeys: event.target.checked })}
        />
        <span>播放时高亮琴键</span>
      </label>

      <button type="button" className="start-btn" onClick={onStart} disabled={busy}>
        开始练习
      </button>
    </section>
  );
}
