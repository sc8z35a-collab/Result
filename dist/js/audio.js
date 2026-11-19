const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class PortAudio {
  constructor() {
    this.volume = .55;
    this.on = false;
    this.lastWhizAt = 0;
    this.lastImpactAt = 0;
  }

  async enable(on) {
    this.on = on;
    if (!on) {
      if (this.master) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, .08);
      return;
    }
    try {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return;
        this.ctx = new C();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);

        // Ambient harbor wind & distant water rumble loop
        const len = this.ctx.sampleRate * 4;
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        let p = 0;
        for (let i = 0; i < len; i++) {
          p = (p + .045 * (Math.random() * 2 - 1)) / 1.041;
          d[i] = p * 2.1;
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
        src.start();

        // Reusable crisp white-noise buffer for gunshots, bullet whizzes, cracks, and impacts
        const nLen = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, nLen, this.ctx.sampleRate);
        const nd = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
      }
      await this.ctx.resume();
      this.set(this.volume);
    } catch {
      this.on = false;
    }
  }

  set(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.on ? v : 0, this.ctx.currentTime, .04);
  }

  route(node, pan = 0, panEnd = pan, start = 0, dur = .1) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const ps = ctx.createStereoPanner();
      ps.pan.setValueAtTime(clamp(pan, -1, 1), start);
      if (Math.abs(panEnd - pan) > .02) {
        ps.pan.linearRampToValueAtTime(clamp(panEnd, -1, 1), start + Math.max(.02, dur));
      }
      node.connect(ps).connect(this.master);
    } else {
      node.connect(this.master);
    }
  }

  tone(f, to, t, volume, type = 'sine', pan = 0, delay = 0, panEnd = pan) {
    if (!this.ctx || !this.on || !this.volume) return;
    const ctx = this.ctx, start = ctx.currentTime + delay, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(10, f), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, to), start + t);
    g.gain.setValueAtTime(.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + Math.min(.006, t * .25));
    g.gain.exponentialRampToValueAtTime(.0001, start + t);
    osc.connect(g);
    this.route(g, pan, panEnd, start, t);
    osc.start(start);
    osc.stop(start + t + .025);
  }

  noise(f0, f1, dur, volume, filterType = 'bandpass', q = 2.2, pan = 0, delay = 0, panEnd = pan) {
    if (!this.ctx || !this.noiseBuf || !this.on || !this.volume) return;
    const ctx = this.ctx, start = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.Q.setValueAtTime(q, start);
    flt.frequency.setValueAtTime(Math.max(30, f0), start);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(.0002, volume), start + Math.min(.007, dur * .22));
    g.gain.exponentialRampToValueAtTime(.0001, start + dur);
    src.connect(flt).connect(g);
    this.route(g, pan, panEnd, start, dur);
    src.start(start, Math.random() * 1.4, dur + .03);
  }

  playFire(e, v, pan, isPlayer) {
    const gun = e.gun || e.actor?.gun || 'SW T';
    const j = .94 + Math.random() * .12;
    const vol = (isPlayer ? 1.0 : .78) * v;

    if (gun === 'MS10') {
      // Hyper-velocity rail carbine: razor-sharp supersonic snap + electromagnetic discharge + crisp punch
      this.noise(5400 * j, 950 * j, .065, .24 * vol, 'bandpass', 1.4, pan);
      this.tone(1680 * j, 260 * j, .058, .15 * vol, 'sawtooth', pan);
      this.tone(390 * j, 74 * j, .095, .18 * vol, 'triangle', pan);
      this.tone(128 * j, 46, .10, .14 * vol, 'sine', pan);
      if (isPlayer) this.tone(3600 * j, 2100 * j, .038, .055, 'sine', pan + .15, .015);
    } else if (gun === 'DF1 OUT') {
      const p1 = e.source === 'p1';
      this.noise((p1 ? 3400 : 2100) * j, 520 * j, .085, .17 * vol, 'bandpass', 2.4, pan);
      this.tone((p1 ? 940 : 620) * j, 150 * j, .095, .15 * vol, 'triangle', pan);
      this.tone((p1 ? 260 : 145) * j, 52, .11, .11 * vol, 'sine', pan);
      if (p1) this.tone(1480 * j, 2150 * j, .06, .08 * vol, 'sine', pan);
    } else if (gun === 'D1') {
      this.noise(1900 * j, 360 * j, .095, .20 * vol, 'bandpass', 1.2, pan);
      this.tone(540 * j, 92 * j, .105, .17 * vol, 'triangle', pan);
      this.tone(125 * j, 44, .115, .13 * vol, 'sine', pan);
    } else if (gun === 'SRA') {
      this.noise(2700 * j, 540 * j, .082, .20 * vol, 'bandpass', 1.3, pan);
      this.tone(440 * j, 86 * j, .095, .16 * vol, 'triangle', pan);
      this.tone(118 * j, 44, .105, .12 * vol, 'sine', pan);
    } else {
      // SW T: weighty precision rifle crack + deep thump
      this.noise(2400 * j, 420 * j, .115, .23 * vol, 'bandpass', 1.1, pan);
      this.tone(330 * j, 68 * j, .13, .19 * vol, 'triangle', pan);
      this.tone(114 * j, 38, .145, .15 * vol, 'sine', pan);
    }

    // Subtle distant harbor echo tail off steel containers
    if (vol > .18) {
      this.noise(920 * j, 340, .18, .048 * vol, 'lowpass', .8, -pan * .45, .045);
    }
    // Delicate brass/thermal shell clink on concrete dock for player shots
    if (isPlayer) {
      const f = (gun === 'MS10' ? 4900 : 3800) * (.92 + Math.random() * .16);
      const dly = .30 + Math.random() * .12;
      this.tone(f, f * .92, .035, .026, 'sine', .42, dly);
      this.tone(f * 1.18, f * 1.05, .026, .016, 'triangle', .46, dly + .085);
    }
  }

  // Diverse bullet flyby / near-miss spatial soundscape (7+ distinct sonic signatures)
  playWhiz(e) {
    const now = this.ctx?.currentTime || 0;
    if (now - this.lastWhizAt < .032) return;
    this.lastWhizAt = now;

    const d = Math.max(.25, e.dist || 2);
    const closeness = clamp(1 - d / 6.0, .12, 1);
    const vol = (.12 + closeness * closeness * .34) * (e.enemy ? 1.0 : .55);
    const p0 = e.pan ?? 0, p1 = e.panEnd ?? p0;
    const j = .86 + Math.random() * .28;
    const gun = e.gun || 'SW T';
    const speed = e.speed || 360;
    const variant = Math.floor(Math.random() * 5);

    // 1. Supersonic ballistic crack when fast rounds snap close past the player's ears
    if (d < 2.9 && speed >= 310) {
      const crackVol = vol * (gun === 'MS10' ? 1.35 : 1.05);
      this.noise(6800 * j, 1300 * j, .042, crackVol, 'highpass', .9, p0, 0, p1);
      this.tone(2400 * j, 420 * j, .036, crackVol * .55, 'sawtooth', p0, 0, p1);
    }

    // 2. Signature MS10 hyper-velocity rail tear (648 m/s sonic whip)
    if (gun === 'MS10') {
      const dur = .11 + Math.random() * .05;
      this.noise(5600 * j, 820 * j, dur, vol * 1.15, 'bandpass', 4.2, p0, .008, p1);
      this.tone(2850 * j, 520 * j, dur * .85, vol * .52, 'sawtooth', p0, .006, p1);
      this.tone(980 * j, 240 * j, dur, vol * .32, 'triangle', p0, .01, p1);
      return;
    }

    // 3. DF1 OUT energetic plasma/pulse hum pass
    if (gun === 'DF1 OUT') {
      const dur = .15 + Math.random() * .06;
      const hi = (e.source === 'p1' ? 1550 : 1080) * j;
      this.tone(hi, hi * .28, dur, vol * .56, 'sine', p0, 0, p1);
      this.tone(hi * 1.5, hi * .38, dur * .85, vol * .28, 'triangle', p0, .01, p1);
      this.noise(2400 * j, 550 * j, dur, vol * .55, 'bandpass', 5.0, p0, 0, p1);
      return;
    }

    // 4. Five distinct acoustic bullet-flyby archetypes for rich battlefield variety
    if (variant === 0) {
      // Classic sharp Doppler "whiz-zip"
      const dur = .12 + Math.random() * .05;
      this.noise(3400 * j, 520 * j, dur, vol * .95, 'bandpass', 5.5, p0, 0, p1);
      this.tone(1320 * j, 340 * j, dur * .8, vol * .34, 'triangle', p0, .008, p1);
    } else if (variant === 1) {
      // High-pitched tearing air "zzzip!"
      const dur = .09 + Math.random() * .04;
      this.noise(4800 * j, 980 * j, dur, vol * .92, 'bandpass', 3.4, p0, 0, p1);
      this.tone(2150 * j, 620 * j, dur * .75, vol * .28, 'sine', p0, 0, p1);
    } else if (variant === 2) {
      // Tumble / whistle vortex "fweeeoow"
      const dur = .17 + Math.random() * .06;
      this.tone(1750 * j, 490 * j, dur, vol * .36, 'sine', p0, 0, p1);
      this.noise(2200 * j, 460 * j, dur, vol * .72, 'bandpass', 7.2, p0, .006, p1);
    } else if (variant === 3) {
      // Heavy low-end air-whoosh "vwoosh!" (close heavy round)
      const dur = .14 + Math.random() * .05;
      this.noise(1650 * j, 260 * j, dur, vol * 1.05, 'bandpass', 2.3, p0, 0, p1);
      this.tone(540 * j, 155 * j, dur, vol * .38, 'triangle', p0, 0, p1);
    } else {
      // Double-snap graze (crack + trailing whistle)
      const dur = .15 + Math.random() * .04;
      this.noise(4200 * j, 1100 * j, .048, vol * .85, 'highpass', 1.2, p0, 0, p1);
      this.noise(2600 * j, 420 * j, dur, vol * .76, 'bandpass', 6.0, p0, .022, p1);
      this.tone(1520 * j, 390 * j, dur * .9, vol * .26, 'sine', p0, .022, p1);
    }
  }

  // Diverse surface impacts and occasional metallic container ricochets
  playImpact(e, player) {
    const now = this.ctx?.currentTime || 0;
    if (now - this.lastImpactAt < .038) return;
    const p = e.point;
    if (!p) return;
    const d = Math.hypot(p[0] - player.x, p[2] - player.z);
    if (d > 38) return;
    this.lastImpactAt = now;

    const v = 1 / (1 + d * .13);
    const pan = clamp(((p[0] - player.x) * Math.cos(player.yaw) + (p[2] - player.z) * Math.sin(player.yaw)) / (d + 1), -1, 1);
    const j = .85 + Math.random() * .30;

    if (e.metal) {
      // Steel container / crane clang + crisp impact burst
      this.noise(3200 * j, 780 * j, .065, .13 * v, 'bandpass', 2.4, pan);
      this.tone(1280 * j, 640 * j, .075, .085 * v, 'triangle', pan);
      // Chance for cinematic metallic ricochet zing ("kiiiing!" / "pyuun!")
      if (Math.random() < (e.gun === 'MS10' ? .46 : .28)) {
        const ricStyle = Math.floor(Math.random() * 3);
        const fStart = (ricStyle === 0 ? 3100 : ricStyle === 1 ? 2250 : 3900) * j;
        const fEnd = (ricStyle === 0 ? 1180 : ricStyle === 1 ? 3400 : 1650) * j;
        const dur = .18 + Math.random() * .14;
        this.tone(fStart, fEnd, dur, .095 * v, ricStyle === 2 ? 'sawtooth' : 'sine', pan, .012, clamp(pan + (Math.random() - .5) * .6, -1, 1));
        this.tone(fStart * 1.48, fEnd * 1.32, dur * .75, .042 * v, 'triangle', pan, .015);
      }
    } else {
      // Concrete dock / asphalt impact thud + grit scatter
      this.noise(1450 * j, 290 * j, .075, .14 * v, 'lowpass', 1.1, pan);
      this.tone(190 * j, 68 * j, .065, .08 * v, 'sine', pan);
    }
  }

  event(e, player) {
    if (!this.on || !player) return;
    const a = e.actor;
    const d = a ? Math.hypot(a.x - player.x, a.z - player.z) : 0;
    const v = 1 / (1 + d * .082);
    const pan = a ? clamp(((a.x - player.x) * Math.cos(player.yaw) + (a.z - player.z) * Math.sin(player.yaw)) / (d + 1), -1, 1) : 0;

    if (e.type === 'fire') {
      this.playFire(e, v, pan, a === player);
    }
    if (e.type === 'whiz') {
      this.playWhiz(e);
    }
    if (e.type === 'impact') {
      this.playImpact(e, player);
    }
    if (e.type === 'hit' && a === player) {
      if (e.kill) {
        this.tone(860, 1290, .08, .15, 'triangle');
        this.tone(1290, 1720, .14, .12, 'sine', 0, .055);
        this.noise(4200, 1600, .05, .10, 'bandpass', 2.0);
      } else if (e.shieldBreak) {
        // Dramatic crystalline shield shatter confirmation
        this.noise(6400, 1200, .18, .20, 'bandpass', 1.8);
        this.tone(2400, 580, .16, .15, 'sawtooth');
        this.tone(1480, 920, .12, .12, 'triangle', 0, .03);
      } else if (e.shield) {
        this.tone(1120, 680, .065, .13, 'triangle');
        this.noise(4800, 2200, .04, .06, 'highpass', 1.2);
      } else {
        this.tone(760, 520, .055, .13, 'triangle');
        this.noise(2400, 900, .032, .055, 'bandpass', 2.0);
      }
    }
    if (e.type === 'hit' && e.victim === player) {
      const hPan = a ? pan : 0;
      if (e.shieldBreak) {
        this.noise(4200, 480, .24, .24, 'bandpass', 1.4, hPan);
        this.tone(620, 130, .22, .18, 'sawtooth', hPan);
      } else {
        this.tone(220, 82, .14, .16, 'sine', hPan);
        this.noise(1400, 320, .08, .12, 'lowpass', 1.0, hPan);
      }
    }
    if (e.type === 'reload' && a === player) {
      this.tone(320, 185, .06, .085, 'triangle', .18);
      this.noise(2200, 900, .045, .055, 'bandpass', 3.0, .18, .05);
    }
    if (e.type === 'loaded' && a === player) {
      this.tone(420, 760, .075, .11, 'triangle', .14);
      this.tone(760, 1080, .065, .09, 'sine', .14, .065);
      this.noise(3400, 1500, .038, .065, 'bandpass', 2.6, .14, .055);
    }
    if (e.type === 'dry' && a === player) {
      this.tone(155, 105, .038, .085, 'square', .1);
    }
    if (e.type === 'tanker') {
      const tv = a === player ? 1 : .45 * v;
      // Pressurized pneumatic release + rapid ammo feed + 1.5x refinery activation chime
      this.noise(3600, 620, .28, .18 * tv, 'bandpass', 1.6, a === player ? 0 : pan);
      this.tone(360, 540, .09, .12 * tv, 'triangle', a === player ? 0 : pan, .04);
      this.tone(540, 810, .11, .13 * tv, 'sine', a === player ? 0 : pan, .12);
      this.tone(810, 1215, .18, .13 * tv, 'sine', a === player ? 0 : pan, .21);
    }
    if (e.type === 'point' && a === player) {
      this.tone(520, 695, .1, .14);
      this.tone(695, 980, .14, .12, 'sine', 0, .09);
    }
  }
}
