import { midiToFreq } from '../lib/notes';

function seededRandom(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

interface ActiveVoice {
  gains: GainNode[];
  oscillators: OscillatorNode[];
  filter: BiquadFilterNode;
  velocity: number;
  timer: number;
}

export class PianoEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
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
      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 1;
      this.wetGain = this.ctx.createGain();
      this.wetGain.gain.value = 0.18;
      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.createImpulseResponse(this.ctx);
      this.dryGain.connect(this.master);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(this.master);
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private createImpulseResponse(ctx: AudioContext): AudioBuffer {
    const seconds = 1.6;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const time = i / ctx.sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - time / seconds, 2.4) * 0.5;
      }
    }
    return impulse;
  }

  noteOn(midi: number, velocity = 0.85): void {
    const ctx = this.ensureContext();
    this.noteOff(midi, 0.06);

    const clampedVelocity = Math.min(1, Math.max(0.05, velocity));
    const frequency = midiToFreq(midi);
    const now = ctx.currentTime;
    const random = seededRandom(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const brightCutoff = Math.min(11000, frequency * 6.5 + 800 + clampedVelocity * 3000);
    filter.frequency.setValueAtTime(brightCutoff, now);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(600, brightCutoff * (0.38 + random * 0.12)),
      now + 0.4 + (midi % 5) * 0.02,
    );
    filter.Q.value = 0.55;

    const gains: GainNode[] = [];
    const oscillators: OscillatorNode[] = [];

    const hammerBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.055), ctx.sampleRate);
    const hammerData = hammerBuffer.getChannelData(0);
    for (let i = 0; i < hammerData.length; i += 1) {
      hammerData[i] = (Math.random() * 2 - 1) * (1 - i / hammerData.length);
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = hammerBuffer;
    const hammerFilter = ctx.createBiquadFilter();
    hammerFilter.type = 'bandpass';
    hammerFilter.frequency.value = 1700 + frequency * 0.8;
    hammerFilter.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.26 * clampedVelocity, now + 0.002);
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
    const inharmonicB = 0.00028 * Math.pow(0.86, (midi - 60) / 12) + 0.00003;

    for (let n = 1; n <= harmonicCount; n += 1) {
      const inharmonicity = Math.sqrt(1 + inharmonicB * n * n);
      const partialFrequency = frequency * n * inharmonicity;
      const partialGain = ctx.createGain();
      const peak = (weights[n - 1] / weightSum) * 0.52 * clampedVelocity;
      const attackSeconds = 0.0025 + n * 0.00035 + random * 0.001;
      const initialDecay = 0.12 + 0.55 * (n / harmonicCount);
      const tailDecay = (decayBase * (1.6 + random * 0.25)) / Math.pow(n, 0.28);
      partialGain.gain.setValueAtTime(0.0001, now);
      partialGain.gain.linearRampToValueAtTime(peak, now + attackSeconds);
      partialGain.gain.exponentialRampToValueAtTime(
        peak * 0.3,
        now + attackSeconds + initialDecay,
      );
      partialGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + attackSeconds + initialDecay + tailDecay,
      );
      partialGain.connect(filter);
      gains.push(partialGain);

      const detuneCents = 1.5 + (n % 3) * 1.2 + random * 1.2;
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

    const resonanceFrequencies = [128, 196, 262];
    for (let i = 0; i < resonanceFrequencies.length; i += 1) {
      const resGain = ctx.createGain();
      const resPeak = (0.026 - i * 0.005) * clampedVelocity;
      resGain.gain.setValueAtTime(0.0001, now);
      resGain.gain.linearRampToValueAtTime(resPeak, now + 0.012);
      resGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4 + i * 0.35);
      const resOsc = ctx.createOscillator();
      resOsc.type = 'sine';
      resOsc.frequency.value = resonanceFrequencies[i] * (1 + random * 0.004);
      resOsc.connect(resGain);
      resGain.connect(filter);
      gains.push(resGain);
      oscillators.push(resOsc);
      resOsc.start(now);
    }

    filter.connect(this.dryGain!);
    filter.connect(this.convolver!);
    const maxDurationSeconds = Math.min(9, decayBase * 2.2 + 1.6);
    const timer = window.setTimeout(
      () => this.releaseVoice(midi, 0.24),
      maxDurationSeconds * 1000,
    );
    this.voices.set(midi, { gains, oscillators, filter, velocity: clampedVelocity, timer });
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

    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (releaseSeconds >= 0.12) {
      const damperBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
      const damperData = damperBuffer.getChannelData(0);
      for (let i = 0; i < damperData.length; i += 1) {
        damperData[i] = (Math.random() * 2 - 1) * (1 - i / damperData.length);
      }
      const damperSource = ctx.createBufferSource();
      damperSource.buffer = damperBuffer;
      const damperFilter = ctx.createBiquadFilter();
      damperFilter.type = 'lowpass';
      damperFilter.frequency.value = 500 + (midi - 21) * 9;
      const damperGain = ctx.createGain();
      const damperPeak = 0.03 * voice.velocity;
      damperGain.gain.setValueAtTime(0.0001, now);
      damperGain.gain.exponentialRampToValueAtTime(damperPeak, now + 0.004);
      damperGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      damperSource.connect(damperFilter);
      damperFilter.connect(damperGain);
      damperGain.connect(voice.filter);
      damperSource.start(now);
      damperSource.stop(now + 0.1);
    }

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
    window.setTimeout(() => {
      try {
        voice.filter.disconnect();
      } catch {
        // 节点可能已断开
      }
    }, (releaseSeconds + 0.15) * 1000);
  }
}
