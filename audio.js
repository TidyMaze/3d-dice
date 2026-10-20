const MAX_VOICES = 12;

// Per kind: noise filter freq, tone freq, tone decay (s), noise decay (s), gain.
const VOICES = {
  die: { noise: 5500, tone: 2400, tdec: 0.05, ndec: 0.025, gain: 0.9 },
  table: { noise: 900, tone: 180, tdec: 0.09, ndec: 0.06, gain: 0.8 },
  wall: { noise: 1800, tone: 520, tdec: 0.07, ndec: 0.04, gain: 0.8 },
};

export function createAudio() {
  let ctx = null;
  let noise = null;
  let voices = 0;

  function unlock() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function impact(speed, kind) {
    if (!ctx || ctx.state !== 'running' || voices >= MAX_VOICES) return;
    const v = VOICES[kind] ?? VOICES.table;
    const t = ctx.currentTime;
    const pitch = 1 + (Math.random() - 0.5) * 0.25;
    const level = Math.min(speed / 15, 1) ** 0.8 * v.gain;

    const master = ctx.createGain();
    master.gain.value = level;
    master.connect(ctx.destination);

    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = v.noise * pitch;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + v.ndec);
    src.connect(bp).connect(ng).connect(master);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = v.tone * pitch;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + v.tdec);
    osc.connect(og).connect(master);

    voices++;
    src.start(t);
    src.stop(t + v.ndec * 3);
    osc.start(t);
    osc.stop(t + v.tdec * 3);
    osc.onended = () => {
      voices--;
      master.disconnect();
    };
  }

  return { unlock, impact };
}
