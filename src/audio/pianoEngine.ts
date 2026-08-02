import { midiToFreq } from '../lib/notes';

interface ActiveVoice {
  gains: GainNode[];
  oscillators: OscillatorNode[];
  timer: number;
}

export class PianoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices = new Map<number, ActiveVoice>();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 22;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.004;
      this.compressor.release.value = 0.3;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  noteOn(midi: number, velocity = 0.85): void {
    const ctx = this.ensureContext();
    this.noteOff(midi, 0.06);

    const frequency = midiToFreq(midi);
    const now = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(9000, frequency * 6 + 700 + velocity * 2800);
    filter.Q.value = 0.5;

    const gains: GainNode[] = [];
    const oscillators: OscillatorNode[] = [];

    const hammerBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const hammerData = hammerBuffer.getChannelData(0);
    for (let i = 0; i < hammerData.length; i += 1) {
      hammerData[i] = (Math.random() * 2 - 1) * (1 - i / hammerData.length);
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = hammerBuffer;
    const hammerFilter = ctx.createBiquadFilter();
    hammerFilter.type = 'bandpass';
    hammerFilter.frequency.value = 1800 + frequency;
    hammerFilter.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.32 * velocity, now + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noiseSource.connect(hammerFilter);
    hammerFilter.connect(noiseGain);
    noiseGain.connect(filter);
    noiseSource.start(now);
    noiseSource.stop(now + 0.08);

    const harmonicCount = Math.min(12, Math.max(6, Math.round(6 + frequency / 220)));
    const weights: number[] = [];
    let weightSum = 0;
    for (let n = 1; n <= harmonicCount; n += 1) {
      const weight = 1 / Math.pow(n, 1.6);
      weights.push(weight);
      weightSum += weight;
    }
    const decayBase = Math.max(0.5, 2.4 - frequency / 1300);

    for (let n = 1; n <= harmonicCount; n += 1) {
      const inharmonicity = Math.sqrt(1 + 0.00045 * n * n);
      const partialFrequency = frequency * n * inharmonicity;
      const partialGain = ctx.createGain();
      const peak = (weights[n - 1] / weightSum) * 0.55 * velocity;
      const attackSeconds = 0.003 + n * 0.0004;
      const timeConstant = decayBase / Math.pow(n, 0.75);
      partialGain.gain.setValueAtTime(0.0001, now);
      partialGain.gain.linearRampToValueAtTime(peak, now + attackSeconds);
      partialGain.gain.setTargetAtTime(0.0001, now + attackSeconds, timeConstant);
      partialGain.connect(filter);
      gains.push(partialGain);

      const detuneCents = 2 + (n % 3) * 1.5;
      for (const detune of [-detuneCents, detuneCents]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = partialFrequency;
        osc.detune.value = detune;
        osc.connect(partialGain);
        osc.start(now);
        oscillators.push(osc);
      }
    }

    filter.connect(this.master!);
    const maxDurationSeconds = Math.max(0.8, decayBase * 2.4);
    const timer = window.setTimeout(
      () => this.releaseVoice(midi, 0.22),
      maxDurationSeconds * 1000,
    );
    this.voices.set(midi, { gains, oscillators, timer });
  }

  noteOff(midi: number, releaseSeconds = 0.32): void {
    this.releaseVoice(midi, releaseSeconds);
  }

  stopAll(): void {
    for (const midi of [...this.voices.keys()]) {
      this.releaseVoice(midi, 0.15);
    }
  }

  private releaseVoice(midi: number, releaseSeconds: number): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi);
    window.clearTimeout(voice.timer);
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    for (const gain of voice.gains) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.setTargetAtTime(0.0001, now, releaseSeconds * 0.35);
      } catch {
        // 极端情况下忽略包络错误
      }
    }
    for (const osc of voice.oscillators) {
      try {
        osc.stop(now + releaseSeconds + 0.08);
      } catch {
        // 已停止的振荡器忽略
      }
    }
  }
}
