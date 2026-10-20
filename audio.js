/**
 * An interaction-only instrument, made from locally rendered Earshot samples.
 * Enabling loads silently. Taps and actual held pointer movement advance notes.
 */
const SOUND_URLS = {
  tick: new URL('./audio/touch.wav', import.meta.url),
  air: new URL('./audio/air.wav', import.meta.url),
  pluck: new URL('./audio/pluck-low.wav', import.meta.url),
  bell: new URL('./audio/bell.wav', import.meta.url),
};
const SCORE_URL = new URL('./audio/score.json', import.meta.url);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, Number.isFinite(n) ? n : a));
const MASTER_LEVEL = 0.74;

export class LoopAudio {
  constructor() {
    this.enabled = false;
    this.scene = 0;
    this.context = null;
    this.buffers = {};
    this.voices = new Set();
    this.kind = 'pluck';
    this.epoch = 0;
    this.destroyed = false;
    this.previousEnergy = 0;
    this.onsetEnvelope = 0;
    this.lastSampleTime = 0;
    this.lastNoteTime = -10;
    this.lastNoteLevel = 0;
    this.noteId = 0;
    this.pitch = 1 / 3;
    this.motion = 0;
    this.gestureActive = false;
    this.travel = 0;
    this.noteDistance = 0.055;
    this.noteInterval = 0.125;
    this.phraseCursors = Array.from({ length: 4 }, () => ({ phrase: 0, event: 0, progress: 0 }));
    this.hidden = typeof document !== 'undefined' && document.hidden;
    this._onVisibility = () => {
      this.hidden = document.hidden;
      if (this.hidden) {
        this._cancelGesture();
        this._stopVoices();
        this._mute();
        this._stopAir();
        this.lastNoteLevel = 0;
        this.context?.suspend().catch(() => {});
      } else if (this.enabled && this.context) {
        this.context.resume().then(() => {
          if (!this._canPlay()) return;
          this.master.gain.setTargetAtTime(MASTER_LEVEL, this.context.currentTime, 0.06);
        }).catch(() => {});
      }
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
  }

  async enable() {
    if (this.destroyed) return false;
    const token = ++this.epoch;
    this.enabled = true;
    try {
      if (!this.context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio is unavailable');
        const c = this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this.master = c.createGain();
        this.master.gain.value = 0;
        this.analyser = c.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.66;
        this.master.connect(this.analyser);
        this.analyser.connect(c.destination);
        this.timeData = new Float32Array(this.analyser.fftSize);
        this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
        this.airFilter = c.createBiquadFilter();
        this.airFilter.type = 'lowpass';
        this.airFilter.frequency.value = 1200;
        this.airFilter.Q.value = 0.38;
        this.airGain = c.createGain();
        this.airGain.gain.value = 0;
        this.airFilter.connect(this.airGain);
        this.airGain.connect(this.master);
      }
      // Resume is requested inside the originating user gesture, before fetching.
      const resume = this.hidden ? Promise.resolve() : this.context.resume();
      if (!this.loading) {
        this.loading = Promise.all([
          ...Object.entries(SOUND_URLS).map(async ([key, url]) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Audio load failed: ${key}`);
            this.buffers[key] = await this.context.decodeAudioData(await response.arrayBuffer());
          }),
          fetch(SCORE_URL).then(async response => {
            if (!response.ok) throw new Error('Musical score failed to load');
            this.score = await response.json();
          }),
        ]).catch(error => { this.loading = null; throw error; });
      }
      await Promise.all([resume, this.loading]);
      if (token !== this.epoch || !this.enabled || this.destroyed) return false;
      if (!this.hidden) {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setTargetAtTime(MASTER_LEVEL, this.context.currentTime, 0.012);
      }
      return true;
    } catch (error) {
      this.lastError = error;
      this.disable();
      return false;
    }
  }

  disable() {
    this.enabled = false;
    ++this.epoch;
    this._cancelGesture();
    this._stopVoices();
    this._mute();
    this._stopAir();
    this.context?.suspend().catch(() => {});
    this.previousEnergy = this.onsetEnvelope = 0;
    this.lastNoteLevel = 0;
  }

  setScene(sceneIndex) {
    if (!Number.isFinite(sceneIndex)) return;
    const next = ((Math.floor(sceneIndex) % 4) + 4) % 4;
    if (next === this.scene) return;
    this.scene = next;
    this.travel = 0;
    this.motion = 0;
    this._fadeVoices(0.12);
    this._decayAir(0.12);
  }

  // Compatibility only. Animation-frame calls must never manufacture sound.
  setMotion() {}

  grab() {
    if (this.destroyed || this.hidden) return false;
    this.gestureActive = true;
    this.travel = 0;
    this.motion = 0;
    return true;
  }

  /** Only call for an actual pointermove while held.
   * distance = hypot(deltaX, deltaY) / min(viewportWidth, viewportHeight).
   * Returns true only when this movement starts one score event.
   */
  move(distance, speed = 0, sceneIndex = this.scene) {
    this.setScene(sceneIndex);
    if (!this.gestureActive || !this._canPlay() || !(distance > 0) || !Number.isFinite(distance)) return false;
    const now = this.context.currentTime;
    this.motion = clamp(Math.abs(speed));
    this._startAir();
    const weight = [0.55, 1, 0.34, 0.65][this.scene];
    const level = (0.022 + this.motion * 0.11) * weight;
    this._holdParam(this.airGain.gain, now);
    this.airGain.gain.linearRampToValueAtTime(level, now + 0.018);
    this.airGain.gain.setValueAtTime(level, now + 0.035);
    this.airGain.gain.linearRampToValueAtTime(0, now + 0.30);
    this.airFilter.frequency.setTargetAtTime(650 + this.motion * 3200, now, 0.06);
    this.airSource.playbackRate.setTargetAtTime(0.76 + this.motion * 0.32, now, 0.09);
    // Keep at most one pending distance threshold. Long/fast moves never queue
    // a burst, and a stopped pointer cannot release accumulated notes later.
    this.travel = Math.min(this.noteDistance, this.travel + distance);
    if (this.travel < this.noteDistance || now - this.lastNoteTime < this.noteInterval) return false;
    this.travel = 0;
    return this._advanceNote();
  }

  release(completed, sceneIndex = this.scene) {
    this.setScene(sceneIndex);
    this._cancelGesture();
    this._decayAir(0.12);
  }

  ping(sceneIndex = this.scene) {
    this.setScene(sceneIndex);
    return this._advanceNote();
  }

  /**
   * Bands/onset are measured from the actual post-gain signal. notePulse and
   * noteId only change when an audible sample source really starts.
   * pitch maps MIDI C3..C6 to 0..1; muted output preserves the last note identity.
   */
  sample() {
    const empty = {
      energy: 0, low: 0, mid: 0, high: 0, onset: 0, beat: 0,
      notePulse: 0, noteId: this.noteId, pitch: this.pitch,
      phraseProgress: this.phraseCursors[this.scene].progress, kind: this.kind, instrument: this.kind,
    };
    if (!this._canPlay() || this.context.state !== 'running') return empty;
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getFloatFrequencyData(this.frequencyData);
    let squareSum = 0;
    for (const v of this.timeData) squareSum += v * v;
    const energy = clamp(Math.sqrt(squareSum / this.timeData.length) * 30);
    const hzPerBin = this.context.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      let power = 0;
      const a = Math.max(1, Math.ceil(lo / hzPerBin));
      const b = Math.min(this.frequencyData.length, Math.floor(hi / hzPerBin) + 1);
      for (let i = a; i < b; i++) power += Math.pow(10, this.frequencyData[i] / 10);
      return clamp(Math.sqrt(power) * 28);
    };
    const now = this.context.currentTime;
    const dt = Math.min(0.15, Math.max(0.001, now - this.lastSampleTime));
    const rise = Math.max(0, energy - this.previousEnergy - 0.005);
    this.onsetEnvelope = Math.max(this.onsetEnvelope * Math.exp(-dt * 9), clamp(rise * 4));
    this.previousEnergy = energy;
    this.lastSampleTime = now;
    const noteAge = Math.max(0, now - this.lastNoteTime);
    const notePulse = clamp(this.lastNoteLevel * Math.exp(-noteAge * 4.4));
    return {
      energy, low: band(40, 300), mid: band(300, 2000), high: band(2000, 14000),
      onset: this.onsetEnvelope, beat: clamp(this.lastNoteLevel * Math.exp(-noteAge * 7)),
      notePulse, noteId: this.noteId, pitch: this.pitch,
      phraseProgress: this.phraseCursors[this.scene].progress,
      kind: this.kind, instrument: this.kind,
    };
  }

  destroy() {
    this.disable();
    this.destroyed = true;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    this.context?.close().catch(() => {});
    this.context = null;
    this.buffers = {};
  }

  _canPlay() {
    return this.enabled && !this.hidden && !this.destroyed
      && this.context?.state === 'running' && !!this.score && !!this.buffers.tick;
  }

  _play(kind, level = 0.6, midi = null, gate = 0.8, group = null, rateOverride = null) {
    if (!this._canPlay() || !this.buffers[kind]) return false;
    const now = this.context.currentTime;
    const baseMidi = this.score.baseMidi[kind];
    const rate = rateOverride ?? (midi !== null && baseMidi !== undefined ? 2 ** ((midi - baseMidi) / 12) : 1);
    const voiceGroup = group || (kind === 'pluck' || kind === 'bell' ? 'melody' : kind);
    this._fadeVoices(0.065, voiceGroup);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.buffers[kind];
    source.playbackRate.value = rate;
    const duration = Math.max(0.04, Math.min(gate, source.buffer.duration / rate));
    const fade = Math.min(0.16, duration * 0.3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.003);
    gain.gain.setValueAtTime(level, now + Math.max(0.004, duration - fade));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain, group: voiceGroup, fading: false };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    source.start();
    source.stop(now + duration + 0.02);
    this.kind = kind;
    this.lastNoteTime = now;
    this.lastNoteLevel = clamp(level / 0.8);
    if (midi !== null) this.pitch = clamp((midi - 48) / 36);
    this.noteId += 1;
    return true;
  }

  _advanceNote() {
    if (!this._canPlay()) return false;
    const cursor = this.phraseCursors[this.scene];
    const phrases = this.score.scenes[this.scene].phrases;
    const events = [...phrases[cursor.phrase]].sort((a, b) => a[0] - b[0]);
    const [, kind, midi, velocity, gateBeats] = events[cursor.event];
    const level = clamp(velocity * (1 + this.motion * 0.18), 0, 0.96);
    if (!this._play(kind, level, midi, gateBeats * 60 / this.score.bpm)) return false;
    cursor.progress = (cursor.event + 1) / events.length;
    cursor.event += 1;
    if (cursor.event >= events.length) {
      cursor.event = 0;
      cursor.phrase = (cursor.phrase + 1) % phrases.length;
    }
    return true;
  }

  _startAir() {
    if (this.airSource || !this.buffers.air) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.air;
    source.loop = true;
    source.playbackRate.value = 0.85;
    source.connect(this.airFilter);
    source.start();
    this.airSource = source;
  }

  _stopAir() {
    if (!this.airSource) return;
    try { this.airSource.stop(); } catch {}
    this.airSource.disconnect();
    this.airSource = null;
  }

  _mute() {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.airGain.gain.cancelScheduledValues(now);
    this.airGain.gain.setValueAtTime(0, now);
  }

  _fadeVoices(seconds, group = null) {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      if (voice.fading || (group && voice.group !== group)) continue;
      voice.fading = true;
      if (voice.gain.gain.cancelAndHoldAtTime) voice.gain.gain.cancelAndHoldAtTime(now);
      else {
        const value = voice.gain.gain.value;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(value, now);
      }
      voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
      try { voice.source.stop(now + seconds + 0.01); } catch {}
    }
  }

  _stopVoices() {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch {}
    }
    this.voices.clear();
  }

  _holdParam(param, now) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else {
      const value = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
  }

  _decayAir(seconds) {
    if (!this.context || !this.airGain) return;
    const now = this.context.currentTime;
    this._holdParam(this.airGain.gain, now);
    this.airGain.gain.linearRampToValueAtTime(0, now + seconds);
  }

  _cancelGesture() {
    this.gestureActive = false;
    this.travel = 0;
    this.motion = 0;
  }
}
