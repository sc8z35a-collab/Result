export class PortAudio {
  constructor() {
    this.volume = .55;
    this.on = false
  }
  async enable(on) {
    this.on = on;
    if (!on) {
      if (this.master)this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .08);
      return
    }
    try {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C)return;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 4, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
        let p = 0;
        for (let i = 0; i < len; i++) {
          p = (p + .045 * (Math.random() * 2 - 1)) / 1.041;
          d[i] = p * 2.1
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 570;
        const amp = this.ctx.createGain();
        amp.gain.value = .22;
        src.connect(filter).connect(amp).connect(this.master);
        src.start()
      }
      await this.ctx.resume();
      this.set(this.volume)
    } catch {
      this.on = false
    }
  }
  set(v) {
    this.volume = v;
    if (this.master)this.master.gain.setTargetAtTime(this.on ? v : 0, this.ctx.currentTime, .04)
  }
  tone(f, to, t, volume, type = 'sine', pan = 0, delay = 0) {
    if (!this.ctx || !this.on || !this.volume)return;
    const ctx = this.ctx, start = ctx.currentTime + delay, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + t);
    g.gain.setValueAtTime(.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + .005);
    g.gain.exponentialRampToValueAtTime(.0001, start + t);
    osc.connect(g);
    if (ctx.createStereoPanner) {
      const ps = ctx.createStereoPanner();
      ps.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(ps).connect(this.master)
    } else g.connect(this.master);
    osc.start(start);
    osc.stop(start + t + .02)
  }
  event(e, player) {
    if (!this.on || !player)return;
    const a = e.actor;
    const d = a ? Math.hypot(a.x - player.x, a.z - player.z) : 0,
      v = 1 / (1 + d * .09),
      pan = a ? Math.max(-1, Math.min(1, ((a.x - player.x) * Math.cos(player.yaw) + (a.z - player.z) * Math.sin(player.yaw)) / (d + 1))) : 0;
    if (e.type === 'fire') {
      const hz = a.gun === 'D1' ? 520 : a.gun === 'SRA' ? 420 : 310;
      this.tone(hz, 80, .115, .17 * v, 'triangle', pan);
      this.tone(113, 42, .12, .11 * v, 'sine', pan)
    }
    if (e.type === 'hit' && a === player)this.tone(e.shield ? 980 : 710, 510, .06, .12);
    if (e.type === 'hit' && e.victim === player)this.tone(205, 88, .14, .14);
    if (e.type === 'loaded' && a === player)this.tone(410, 780, .09, .11, 'triangle');
    if (e.type === 'dry' && a === player)this.tone(135, 100, .04, .08, 'square');
    if (e.type === 'point' && a === player) {
      this.tone(500, 665, .1, .14);
      this.tone(670, 940, .14, .12, 'sine', 0, .09)
    }
  }
}
