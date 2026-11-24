import {money, PilotWallet} from './wallet.js';
import {ThermalOptic} from './optic.js';
import {targetPoint, bodyCenter, torso} from './posture.js';
import {clamp} from './geometry.js';
import {clearOpticalPath} from './yard.js';
const $ = s => document.getElementById(s);
const setSvgHidden = (el, hide) => {
  if (!el) return;
  const h = !!hide;
  if (el._hdHid === h) return;
  el._hdHid = h;
  el.toggleAttribute('hidden', h);
};
const setHid = (el, hide) => {
  if (!el) return;
  const h = !!hide;
  if (el.hidden !== h) el.hidden = h;
};
const setTxt = (el, txt) => {
  if (!el) return;
  const s = String(txt);
  if (el._hdTxt === s) return;
  el._hdTxt = s;
  el.textContent = s;
};
const setSty = (el, prop, val) => {
  if (!el) return;
  const k = '_s_' + prop;
  if (el[k] === val) return;
  el[k] = val;
  el.style[prop] = val;
};
const setVar = (el, prop, val) => {
  if (!el) return;
  const k = '_v_' + prop;
  if (el[k] === val) return;
  el[k] = val;
  el.style.setProperty(prop, val);
};
const setAttr = (el, attr, val) => {
  if (!el) return;
  const k = '_a_' + attr;
  if (el[k] === val) return;
  el[k] = val;
  el.setAttribute(attr, val);
};
const setCls = (el, cls, on) => {
  if (!el) return;
  const b = !!on, k = '_c_' + cls;
  if (el[k] === b) return;
  el[k] = b;
  el.classList.toggle(cls, b);
};
const OH_SHIELD_MAX = 25;
const OH_BAIZER_MAX = 100;
const _EMPTY_ARCS = Object.freeze([]);
export class PilotEquipment {
  constructor(getMatch, notice) {
    this.getMatch = getMatch;
    this.notice = notice;
    this.thermal = new ThermalOptic($('thermal'));
    this.wallet = new PilotWallet(() => this.accountView());
    this.buying = false;
    this.pendingAwards = new Map(this.wallet.stagedAwards().map(receipt => [receipt, receipt.split('/')[0]]));
    this.failedAwards = new Set();
    this.savingAwards = false;
    $('retryCredits').onclick = () => this.saveAwards();
    for (const id of ['buyLobby', 'buyPause'])$(id).onclick = () => this.buy();
    for (const [id, code] of [['mobileADS', 'ads'], ['mobilePattern', 'pattern'], ['mobileBoost', 'boost'], ['mobileOptic', 'scope'], ['mobileAA14', 'aa14']]) {
      const el = $(id);
      if (el) el.onclick = () => this.action(code);
    }
    this.wasThermal = false;
    this._ohPool = [];
    this._ohLosCache = new Map();
    this._ohPt = [0, 0, 0];
    this._el = {
      echoCompass: $('echoCompass'),
      dfHud: $('dfHud'),
      rdHud: $('rdHud'),
      aa14HeatWrap: $('aa14HeatWrap'),
      aa14HeatBar: $('aa14HeatBar'),
      touchDF: $('touchDF'),
      touchDF40: $('touchDF40'),
      mobileAA14: $('mobileAA14'),
      optics: $('optics'),
      thermal: $('thermal'),
      reticle: $('reticle'),
      lockDot: $('lockDot'),
      lockTag: $('lockTag'),
      rdOverlay: $('rdOverlay'),
      rdTether: $('rdTether'),
      rdTetherGlow: $('rdTetherGlow'),
      rdFocusText: $('rdFocusText'),
      rdSensorText: $('rdSensorText'),
      d01Bar: $('d01Bar'),
      focusText: $('focusText'),
      dfMode: $('dfMode'),
      p1Text: $('p1Text'),
      heatBar: $('heatBar'),
      dfKeys: $('dfKeys'),
      fermatOverlay: $('fermatOverlay'),
      fermatNode: $('fermatNode'),
      fermatNode2: $('fermatNode2'),
      fermatTag: $('fermatTag'),
      fermatLeg1: $('fermatLeg1'),
      fermatLeg2: $('fermatLeg2'),
      fermatLeg3: $('fermatLeg3'),
      overheadLayer: $('overheadLayer')
    };
    this._fermatP1 = [0, 0];
    this._fermatP2 = [0, 0];
    this._fermatP3 = [0, 0];
    this._centerPt = [50, 50];
    if (this.pendingAwards.size) this.saveAwards();
  }
  accountView() {
    if (!this.wallet)return;
    const s = this.wallet.state;
    $('lobbyCredit').textContent = money(s.units) + ' CR';
    $('pauseWallet').textContent = '所持 ' + money(s.units) + ' CR';
    $('opticName').textContent = s.evr ? 'EVR1  /  プラスチック照準' : 'プラスチックスコープ';
    for (const id of ['buyLobby', 'buyPause']) {
      const b = $(id);
      b.disabled = s.evr || s.units < 5 || this.buying;
      b.textContent = s.evr ? 'EVR1 購入済み' : 'EVR1 を購入 · 0.05 CR';
      b.title = s.evr ? '両方のレンズを使用できます' : s.units < 5 ? '撃破で 0.10 CR 獲得' : ''
    }
    const m = this.getMatch();
    if (m?.ended) this.result(m);
    if ($('retryCredits')) {
      $('retryCredits').hidden = this.failedAwards.size === 0;
      $('retryCredits').disabled = this.savingAwards;
    }
  }
  async buy() {
    if (this.buying)return;
    this.buying = true;
    this.accountView();
    try {
      const ok = await this.wallet.change();
      if (ok) {
        const a = this.getMatch()?.player;
        if (a?.df)a.df.scope = 'thermal';
        this.notice('EVR1 を装着 · V で照準切替')
      } else this.notice(this.wallet.state.evr ? 'EVR1 は購入済み' : 'EVR1 には 0.05 CR 必要です')
    } catch {
      this.notice('購入を保存できませんでした')
    } finally {
      this.buying = false;
      this.accountView()
    }
  }
  award(e) {
    if (!e.actor.human)return;
    this.wallet.stageAward(e.receipt);
    this.pendingAwards.set(e.receipt, this.getMatch()?.receiptId);
    this.notice('＋1 POINT　/　＋0.10 CR');
    this.saveAwards(e.receipt);
  }

  async saveAwards(newReceipt) {
    if (!newReceipt) this.retryAllAwards = true;
    if (this.savingAwards) {
      this.rescanAwards = true;
      return;
    }
    this.savingAwards = true;
    this.accountView();
    try {
      do {
        this.rescanAwards = false;
        const retryFailed = !!this.retryAllAwards || !newReceipt;
        this.retryAllAwards = false;
        for (const receipt of [...this.pendingAwards.keys()]) {
          if (!retryFailed && this.failedAwards.has(receipt)) continue;
          try {
            await this.wallet.change(receipt);
            this.pendingAwards.delete(receipt);
            this.failedAwards.delete(receipt);
            this.accountView();
          } catch {
            this.failedAwards.add(receipt);
          }
        }
        newReceipt = null;
      } while (this.rescanAwards || this.retryAllAwards);
    } finally {
      this.savingAwards = false;
    }
    if (this.failedAwards.size) this.notice('未保存のクレジットがあります。試合結果から保存を再試行できます');
    this.accountView();
  }
  result(match) {
    const pending = [...this.pendingAwards.values()].filter(id => id === match.receiptId).length;
    const status = pending ? ` · 保存待ち ${money(pending * 10)} CR` : '';
    $('creditResult').innerHTML = `<span>今回の獲得 <strong>＋${money(match.player.earned)} CR</strong>${status}</span><span>所持 ${money(this.wallet.state.units)} CR</span>`
  }
  action(code) {
    const m = this.getMatch(), a = m?.player;
    if (!a?.alive || m.ended) return;
    if ((code === 'boost' || code === 'aa14') && a.df40) {
      const res = m.toggleAA14(a);
      if (res.state === 'on') this.notice('AA1.4 起動');
      else if (res.state === 'off') this.notice('AA1.4 解除');
      else if (res.reason === 'autoaim_off') this.notice('AA OFF');
      else if (res.reason === 'overheated') this.notice(`過熱冷却 ${res.cooldown.toFixed(1)}s`);
      else if (res.reason === 'hot') this.notice(`高温待機 ${Math.round(res.heat)}%`);
      return;
    }
    const d = a.df;
    if (!d) return;
    if (code === 'ads')d.ads = !d.ads;
    if (code === 'pattern') {
      d.pattern = d.pattern === 'central' ? 'spread' : 'central';
      this.notice(d.pattern === 'central' ? '中央集中' : '散弾')
    }
    if (code === 'boost') {
      if (d.cooling > 0)this.notice('P1 冷却中'); else {
        d.boost = !d.boost;
        this.notice(d.boost ? 'P1 ブースト起動' : 'P1 ブースト解除')
      }
    }
    if (code === 'scope') {
      if (!this.wallet.state.evr) {
        this.notice('EVR1 未購入 · B で 0.05 CR');
        return
      }
      d.scope = d.scope === 'plastic' ? 'thermal' : 'plastic';
      d.ads = true;
      this.notice(d.scope === 'thermal' ? 'EVR1 · 35 mm' : 'プラスチックスコープ')
    }
    if (code === 'buy')this.buy()
  }
  lobby(loadout) {
    $('dfSetup').hidden = loadout !== 'DF1 OUT';
    const rdEl = $('rdSetup');
    if (rdEl) {
      const isRD = loadout === 'RD20' || loadout === 'RD30' || loadout === 'RD40' || loadout === 'DF40 II';
      rdEl.hidden = !isRD;
      rdEl.classList.toggle('is-rd20', loadout === 'RD20');
      rdEl.classList.toggle('is-rd30', loadout === 'RD30');
      rdEl.classList.toggle('is-rd40', loadout === 'RD40');
      rdEl.classList.toggle('is-df40ii', loadout === 'DF40 II');
      if (isRD) {
        const specs = {
          RD20: ['ARV1.1', 'AA 1.1 · 1.76×誘導', 'CLASS', '20発 フルオート'],
          RD30: ['ARV1.1 mini', 'AA 1.1 mini', 'CLASS', '80発 2発同時'],
          RD40: ['ARV1.2', 'AA 1.2 · 1.92× · 1.4×広域', 'D01', '壁裏 4.0s 追従'],
          'DF40 II': ['ARV1.3 · AA1.3', '2.08× · 2発同時 · 上限1200 (2/s)', 'AA1.4', 'X / E 一時強化 (過熱 6s)']
        }[loadout];
        if ($('rdSpec1Title')) $('rdSpec1Title').textContent = specs[0];
        if ($('rdSpec1Desc')) $('rdSpec1Desc').textContent = specs[1];
        if ($('rdSpec2Title')) $('rdSpec2Title').textContent = specs[2];
        if ($('rdSpec2Desc')) $('rdSpec2Desc').textContent = specs[3];
      }
    }
    this.accountView()
  }
  prepare(a) {
    this._ohLosCache?.clear();
    if (!a.df) return;
    if (this.wallet.state.evr) a.df.scope = 'thermal';
    else this.wallet.ready.then(() => {
      if (this.getMatch()?.player === a && a.df && this.wallet.state.evr) a.df.scope = 'thermal';
    });
  }
  pause(a) {
    $('pauseCredits').hidden = !a?.df;
    this.accountView()
  }
  draw(renderer, match, cam, t, play, echoOn = true, fermatOn = true, viewActor = null, showOverheads = play) {
    const E = this._el;
    const a = viewActor || match?.player,
      d = a?.df,
      rd = a?.rd,
      df40 = a?.df40,
      uaa = a?.aa,
      uaaLevel = uaa?.level || 'off',
      uaaOn = !!(play && a?.alive && uaa && uaaLevel !== 'off' && (match?.autoAim !== false || !a.human)),
      isScherp = !!(uaaOn && uaaLevel === '1.5'),
      on = !!(play && d && a.alive),
      rdOn = !!(play && !uaaOn && rd && a.alive),
      df40On = !!(play && !uaaOn && df40 && a.alive),
      isRD40 = rdOn && a.gun === 'RD40',
      isRD30 = rdOn && a.gun === 'RD30',
      isRD20 = rdOn && a.gun === 'RD20',
      aa14On = !!(df40On && df40.aa14Active && !df40.aa14Overheated),
      aa14Hot = !!(df40On && df40.aa14Overheated),
      autoAimOn = match?.autoAim !== false,
      ads = !!(on && d.ads),
      thermal = ads && d.scope === 'thermal' && this.wallet.state.evr;

    // Precompute scalar camera basis ONCE for Overheads, Fermat, and Lock projection!
    let fx = 0, fy = 0, fz = -1, rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0, tanHalf = 0.365, asp = 1.777;
    if (cam) {
      const cp = cam.pos, ct = cam.target;
      fx = ct[0] - cp[0]; fy = ct[1] - cp[1]; fz = ct[2] - cp[2];
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      rx = -fz; ry = 0; rz = fx;
      const rl = Math.sqrt(rx * rx + rz * rz) || 1;
      rx /= rl; rz /= rl;
      ux = ry * fz - rz * fy; uy = rz * fx - rx * fz; uz = rx * fy - ry * fx;
      tanHalf = Math.tan(cam.fov * Math.PI / 360);
      asp = renderer?.aspect || (innerWidth / Math.max(1, innerHeight));
    }

    // Overhead Enemy/Ally Identification Tags (100% Fair-Play LOS + Smoke + Shaffer gated + 30Hz LOS cache)
    this._drawOverheads(match, cam, t, !!(showOverheads && match && !thermal), a, play, fx, fy, fz, rx, ry, rz, ux, uy, uz, tanHalf, asp);

    // FermatCore 1.0: Ultra-Light Smartphone-Safe 2D Vector Projection
    this._drawFermat(match, cam, play && !ads && !match?.spectating, fermatOn, fx, fy, fz, rx, ry, rz, ux, uy, uz, tanHalf, asp);

    // EchoPulse 1.0 Peripheral Sound-to-Sight Tactical Acoustic Compass (HUD-Diff guarded!)
    const compass = E.echoCompass;
    if (compass) {
      const arcs = (play && echoOn && a?.alive && !ads && match?.echoPulse)
        ? match.echoPulse.getCompassArcs(a, match.time, 6)
        : _EMPTY_ARCS;
      const nodes = compass.children;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const arc = arcs[i];
        if (!arc) {
          setSty(el, 'opacity', '0');
          continue;
        }
        const cls = 'ep-' + arc.kind + (arc.occluded ? ' ep-occ' : '');
        if (el._hdCN !== cls) { el._hdCN = cls; el.className = cls; }
        setVar(el, '--ep-ang', arc.deg.toFixed(1) + 'deg');
        setSty(el, 'opacity', (arc.alpha * (arc.occluded ? .62 : .88)).toFixed(3));
      }
    }

    setHid(E.dfHud, !on || uaaOn);
    setCls(E.dfHud, 'is-aa-off', !autoAimOn);
    const rdHud = E.rdHud;
    if (rdHud) {
      setHid(rdHud, !(uaaOn || rdOn || df40On));
      setCls(rdHud, 'is-scherp', isScherp);
      setCls(rdHud, 'is-rd20', isRD20);
      setCls(rdHud, 'is-rd30', isRD30);
      setCls(rdHud, 'is-rd40', isRD40);
      setCls(rdHud, 'is-df40ii', df40On || (uaaOn && !isScherp));
      setCls(rdHud, 'is-aa14', aa14On || (uaaOn && uaaLevel === '1.4'));
      setCls(rdHud, 'is-overheat', aa14Hot);
      setCls(rdHud, 'is-aa-off', !autoAimOn && !uaaOn);
      setCls(rdHud, 'is-locked', (uaaOn && !!uaa.locked) || (autoAimOn && (!!(rdOn && rd.locked) || !!(df40On && df40.locked))));
    }
    setHid(E.aa14HeatWrap, !df40On);
    setHid(E.touchDF, !on || !!match?.spectating);
    if (E.touchDF40) {
      setHid(E.touchDF40, !df40On || !!match?.spectating);
      const btn = E.mobileAA14;
      if (btn && df40On) {
        setCls(btn, 'is-active', autoAimOn && aa14On);
        setCls(btn, 'is-overheat', aa14Hot);
        setCls(btn, 'is-disabled', !autoAimOn);
        setTxt(btn, !autoAimOn
          ? 'AA OFF'
          : aa14Hot
            ? `過熱 ${Math.ceil(df40.aa14Cooldown)}s`
            : aa14On
              ? `AA1.4 ${Math.round(df40.aa14Heat)}%`
              : df40.aa14Heat > 1
                ? `AA1.4 · ${Math.round(df40.aa14Heat)}%`
                : 'AA1.4');
      }
    }
    setHid(E.optics, !ads);
    setCls(E.optics, 'thermal-on', thermal);
    setHid(E.thermal, !thermal);

    const reticle = E.reticle;
    if (reticle) {
      const smartObj = uaaOn ? uaa : autoAimOn ? (isRD40 ? rd : df40On ? df40 : null) : null;
      setCls(reticle, 'is-aa-off', !autoAimOn && !uaaOn);
      setCls(reticle, 'is-scherp', isScherp);
      setCls(reticle, 'is-rd-locked', !!(smartObj && smartObj.locked));
      setCls(reticle, 'is-rd-d01', !!(smartObj && (smartObj.d01Active || smartObj.wallActive)));
      setCls(reticle, 'is-rd-fire', !!(smartObj && (smartObj.firePulse || 0) > .18));
      setCls(reticle, 'is-aa14', (autoAimOn && aa14On) || (uaaOn && uaaLevel === '1.4'));
      setCls(reticle, 'is-overheat', aa14Hot);
      setHid(reticle, !!(play && (!a?.alive || ads)));
    }

    const lock = E.lockDot;
    const lockTag = E.lockTag;
    const rdOverlay = E.rdOverlay;
    const rdTether = E.rdTether;
    const rdTetherGlow = E.rdTetherGlow;

    let lockTargetId = -1, lockStyle = 'df', isD01 = false, isAcquiring = false;
    if (uaaOn && rdHud) {
      const pct = Math.round((uaa.focus || 0) * 100);
      const tierLabel = isScherp ? '1.5 SCHERP' : `AA ${uaaLevel}`;
      const modeTag = uaa.solveMode === 'bank' ? 'BANK' : uaa.solveMode === 'pen' ? 'PEN' : uaa.wallActive ? `WALL ${uaa.wallTimer.toFixed(1)}s` : 'LOCK';
      setTxt(E.rdFocusText, uaa.locked
        ? `${tierLabel} · ${modeTag}`
        : uaa.focus > 0 ? `${tierLabel} · ${pct}%` : `${tierLabel} · SCAN`);
      setHid(E.rdSensorText, false);
      setTxt(E.rdSensorText, isScherp
        ? (uaa.locked ? `ZEM-APN · ${Math.max(1, Math.round(uaa.targetDist || 0))}m` : 'ZEM-APN · BANK/PEN')
        : (uaa.wallActive ? `WALL ${uaa.wallTimer.toFixed(1)}s` : `${a.gun}`));
      setCls(rdHud, 'is-d01', !!uaa.wallActive);
      const barPct = uaa.wallActive ? (uaa.wallTimer / (uaa.wallMax || 4)) * 100 : uaa.locked ? 100 : (uaa.focus || 0) * 100;
      setSty(E.d01Bar, 'width', Math.max(0, Math.min(100, barPct)).toFixed(1) + '%');
      if (uaa.focusId >= 0 && (uaa.locked || uaa.focus > .04)) {
        lockTargetId = uaa.focusId;
        lockStyle = isScherp ? 'scherp' : 'uaa';
        isD01 = !!uaa.wallActive;
        isAcquiring = !uaa.locked;
      }
    } else if (on) {
      if (thermal) {
        if (!this.wasThermal) this.thermal.reset();
        this.thermal.draw(renderer, match, cam, t);
      }
      setTxt(E.focusText, !autoAimOn
        ? 'ARV1.1  ·  オートエイム OFF'
        : d.locked ? 'ARV1.1  •  弾道誘導 1.76× LOCK' : d.focus ? 'ARV1.1  ·  焦点 ' + Math.round(d.focus * 100) + '%' : 'ARV1.1  ·  待機');
      setTxt(E.dfMode, (d.pattern === 'central' ? '中央集中' : '散弾') + '  /  ' + (d.scope === 'thermal' ? 'EVR1' : 'プラスチック'));
      setTxt(E.p1Text, `P1 ${d.p1} / 20　${d.cooling>0?'冷却 '+d.cooling.toFixed(1)+' s':d.boost?'BOOST':'待機'}　${Math.round(d.heat)}%`);
      setSty(E.heatBar, 'width', d.heat.toFixed(1) + '%');
      setTxt(E.dfKeys, 'Q 範囲 · X ブースト · 右クリック 照準 · V レンズ');
      if (autoAimOn && d.locked && !thermal) {
        lockTargetId = d.focusId;
        lockStyle = 'df';
      }
    } else if (df40On && rdHud) {
      const pct = Math.round((df40.focus || 0) * 100);
      const heatPct = Math.round(df40.aa14Heat || 0);
      if (!autoAimOn) {
        setTxt(E.rdFocusText, 'ARV1.3  ·  オートエイム OFF');
        setHid(E.rdSensorText, false);
        setTxt(E.rdSensorText, aa14Hot
          ? `AA1.4 冷却中 ${df40.aa14Cooldown.toFixed(1)}s · 手動エイム`
          : '手動エイム中（対戦設定で変更）');
        setCls(rdHud, 'is-d01', false);
        setSty(E.d01Bar, 'width', '0%');
      } else {
        if (aa14On) {
          setTxt(E.rdFocusText, df40.locked
            ? (df40.d01Active ? `ARV1.3 · AA1.4  •  壁裏超LOCK ${df40.d01Timer.toFixed(1)}s` : 'ARV1.3 · AA1.4  •  超LOCK (2.80×収束)')
            : df40.focus > 0 ? `ARV1.3 · AA1.4  ·  即焦点 ${pct}%` : 'ARV1.3 · AA1.4 OVERDRIVE  ·  超広域');
        } else {
          setTxt(E.rdFocusText, df40.locked
            ? (df40.d01Active ? `ARV1.3 · AA1.3  •  壁裏LOCK ${df40.d01Timer.toFixed(1)}s` : 'ARV1.3 · AA1.3  •  LOCK (2.08×収束)')
            : df40.focus > 0 ? `ARV1.3 · AA1.3  ·  焦点 ${pct}%` : 'ARV1.3 · AA1.3  ·  待機 (1.65×広域)');
        }
        setHid(E.rdSensorText, false);
        setTxt(E.rdSensorText, aa14Hot
          ? `AA1.4 OVERHEAT  ·  冷却 ${df40.aa14Cooldown.toFixed(1)}s (${heatPct}%)`
          : aa14On
            ? `AA1.4 OVERDRIVE  ·  熱量 ${heatPct}%  [X/E 解除]`
            : heatPct > 0
              ? `AA1.4 放熱中 ${heatPct}%  ·  [X/E 再起動]`
              : 'AA1.4 READY  ·  X / E で一時強化起動');
        setCls(rdHud, 'is-d01', !!df40.d01Active && !aa14Hot);
        const barPct = df40.d01Active ? (df40.d01Timer / (df40.d01Max || 4.5)) * 100 : df40.locked ? 100 : (df40.focus || 0) * 100;
        setSty(E.d01Bar, 'width', Math.max(0, Math.min(100, barPct)).toFixed(1) + '%');
        if (df40.focusId >= 0 && (df40.locked || df40.focus > .04)) {
          lockTargetId = df40.focusId;
          lockStyle = 'df40ii';
          isD01 = !!df40.d01Active;
          isAcquiring = !df40.locked;
        }
      }
      setSty(E.aa14HeatBar, 'width', Math.max(0, Math.min(100, df40.aa14Heat || 0)).toFixed(1) + '%');
    } else if (rdOn && rdHud) {
      const pct = Math.round((rd.focus || 0) * 100);
      if (!autoAimOn) {
        const label = isRD40 ? 'ARV1.2' : isRD30 ? 'ARV1.1 mini' : 'ARV1.1';
        setTxt(E.rdFocusText, `${label}  ·  オートエイム OFF`);
        setHid(E.rdSensorText, false);
        setTxt(E.rdSensorText, '手動エイム中（対戦設定で変更）');
        setCls(rdHud, 'is-d01', false);
        setSty(E.d01Bar, 'width', '0%');
      } else if (isRD40) {
        setTxt(E.rdFocusText, rd.locked
          ? (rd.d01Active ? 'ARV1.2  •  D01 壁裏LOCK' : 'ARV1.2  •  LOCK (1.4×広域)')
          : rd.focus > 0 ? `ARV1.2  ·  焦点 ${pct}%` : 'ARV1.2  ·  待機 (1.4×広域)');
        setHid(E.rdSensorText, false);
        setTxt(E.rdSensorText, rd.d01Active
          ? `D01 SENSOR  ·  壁裏追従 ${rd.d01Timer.toFixed(1)}s`
          : rd.locked ? 'D01 SENSOR  ·  追従待機 (4.0s)' : 'D01 SENSOR  ·  常時スキャン');
        setCls(rdHud, 'is-d01', !!rd.d01Active);
        const barPct = rd.d01Active ? (rd.d01Timer / (rd.d01Max || 4)) * 100 : rd.locked ? 100 : (rd.focus || 0) * 100;
        setSty(E.d01Bar, 'width', Math.max(0, Math.min(100, barPct)).toFixed(1) + '%');
        if (rd.focusId >= 0 && (rd.locked || rd.focus > .04)) {
          lockTargetId = rd.focusId;
          lockStyle = 'rd40';
          isD01 = !!rd.d01Active;
          isAcquiring = !rd.locked;
        }
      } else {
        const label = isRD30 ? 'ARV1.1 mini' : 'ARV1.1';
        setTxt(E.rdFocusText, rd.locked
          ? `${label}  •  弾道誘導 LOCK`
          : rd.focus > 0 ? `${label}  ·  焦点 ${pct}%` : `${label}  ·  待機`);
        setHid(E.rdSensorText, false);
        setTxt(E.rdSensorText, isRD30 ? 'RD30  ·  2発同時フルオート' : 'RD20  ·  軽量スマート誘導 1.76×');
        setCls(rdHud, 'is-d01', false);
        setSty(E.d01Bar, 'width', Math.max(0, Math.min(100, (rd.locked ? 1 : rd.focus || 0) * 100)).toFixed(1) + '%');
        if (rd.locked) {
          lockTargetId = rd.focusId;
          lockStyle = isRD30 ? 'rd30' : 'rd20';
        }
      }
    }
    this.wasThermal = thermal;

    const e = lockTargetId >= 0 ? match.actors[lockTargetId] : null;
    if (!e?.alive || !cam) {
      setHid(lock, true);
      setHid(lockTag, true);
      setSvgHidden(rdOverlay, true);
      return;
    }

    const tp = targetPoint(e);
    const cp = cam.pos;
    const dx = tp[0] - cp[0], dy = tp[1] - cp[1], dz = tp[2] - cp[2];
    const z = dx * fx + dy * fy + dz * fz;
    if (z < .01) {
      setHid(lock, true);
      setHid(lockTag, true);
      setSvgHidden(rdOverlay, true);
      return;
    }
    const sx = clamp(50 + 50 * (dx * rx + dy * ry + dz * rz) / (z * tanHalf * asp), 4, 96);
    const sy = clamp(50 - 50 * (dx * ux + dy * uy + dz * uz) / (z * tanHalf), 6, 94);
    setHid(lock, false);
    setSty(lock, 'left', sx.toFixed(2) + '%');
    setSty(lock, 'top', sy.toFixed(2) + '%');

    if (lockStyle === 'scherp' || lockStyle === 'uaa' || lockStyle === 'rd40' || lockStyle === 'df40ii') {
      const isUaaStyle = lockStyle === 'scherp' || lockStyle === 'uaa';
      const src = isUaaStyle ? uaa : lockStyle === 'df40ii' ? df40 : rd;
      const isDF40 = lockStyle === 'df40ii';
      const isAA14Lock = (isDF40 && aa14On) || (lockStyle === 'uaa' && uaaLevel === '1.4');
      const isScherpLock = lockStyle === 'scherp';
      const lp = src.lockPulse || 0;
      const fp = src.firePulse || 0;
      const dp = src.d01Pulse || 0;
      const foc = src.focus || 0;
      const distM = Math.max(1, Math.round(src.targetDist || z));
      const rotDeg = isAcquiring
        ? (1 - foc) * 52
        : isScherpLock
          ? Math.sin(t * 7.2) * 4.5 + (src.solveMode === 'bank' ? 45 : 0)
          : isD01
            ? 45 + Math.sin(t * 2.8) * 12
            : Math.sin(t * (isAA14Lock ? 5.2 : 3.1)) * (isAA14Lock ? 6.0 : 3.5) + ((src.barrelPhase || 0) - (isDF40 ? 1 : .5)) * fp * 11;
      const scaleVal = isAcquiring
        ? 1.78 - 0.72 * foc
        : (isScherpLock ? 0.90 : isAA14Lock ? 0.94 : 1.0) + fp * 0.22 - lp * 0.16 + (isD01 ? Math.sin(t * 6.0) * 0.045 : 0);
      const wavePulse = isD01 ? Math.max(dp, (t * 0.95) % 1) : lp;
      const ringScale = isD01 ? 0.75 + wavePulse * 1.95 : 0.72 + (1 - lp) * 2.15;
      const ringOp = isD01 ? Math.max(0, (1 - wavePulse) * 0.85) : lp * 0.95;

      setCls(lock, 'is-scherp', isScherpLock);
      setCls(lock, 'is-d01', !isScherpLock && isD01);
      setCls(lock, 'is-df40ii', !isScherpLock && !isD01 && (isDF40 || isUaaStyle));
      setCls(lock, 'is-rd40', !isScherpLock && !isD01 && !(isDF40 || isUaaStyle));
      setCls(lock, 'is-rd30', false);
      setCls(lock, 'is-rd20', false);
      setCls(lock, 'is-aa14', isAA14Lock);
      setCls(lock, 'is-acquiring', isAcquiring);
      setCls(lock, 'is-firing', fp > .15 && !isAcquiring);
      setVar(lock, '--lock-rot', rotDeg.toFixed(1) + 'deg');
      setVar(lock, '--lock-scale', scaleVal.toFixed(3));
      setVar(lock, '--ring-scale', ringScale.toFixed(3));
      setVar(lock, '--ring-op', ringOp.toFixed(3));

      if (lockTag) {
        setHid(lockTag, false);
        if (isScherpLock) {
          const mTag = src.solveMode === 'bank' ? 'BANK' : src.solveMode === 'pen' ? 'PEN' : isD01 ? `W ${src.wallTimer.toFixed(1)}s` : 'LOCK';
          setTxt(lockTag, `1.5 SCHERP · ${mTag} · ${distM}m`);
        } else if (isUaaStyle) {
          setTxt(lockTag, `AA ${src.level || uaaLevel} · ${distM}m`);
        } else {
          setTxt(lockTag, isD01
            ? `${isDF40 ? 'D01-II' : 'D01'} ${src.d01Timer.toFixed(1)}s · ${distM}m`
            : isAcquiring
              ? `${isAA14Lock ? 'AA1.4' : isDF40 ? 'ARV1.3' : 'SCAN'} ${Math.round(foc * 100)}%`
              : isAA14Lock
                ? `AA1.4 · ${distM}m`
                : isDF40
                  ? `ARV1.3 · ${distM}m`
                  : `ARV1.2 · ${distM}m`);
        }
      }

      if (rdOverlay && rdTether && (src.locked || foc > .32)) {
        const sxs = sx.toFixed(2), sys = sy.toFixed(2);
        setSvgHidden(rdOverlay, false);
        setCls(rdOverlay, 'is-scherp', isScherpLock);
        setCls(rdOverlay, 'is-df40ii', isDF40 || (isUaaStyle && !isScherpLock));
        setCls(rdOverlay, 'is-aa14', isAA14Lock);
        setCls(rdOverlay, 'is-d01', isD01 && !isScherpLock);
        setCls(rdOverlay, 'is-fire', fp > .15 && !isAcquiring);
        setCls(rdOverlay, 'is-acquiring', isAcquiring);
        setAttr(rdTether, 'x2', sxs);
        setAttr(rdTether, 'y2', sys);
        if (rdTetherGlow) {
          setAttr(rdTetherGlow, 'x2', sxs);
          setAttr(rdTetherGlow, 'y2', sys);
        }
      } else {
        setSvgHidden(rdOverlay, true);
      }
    } else {
      setCls(lock, 'is-scherp', false);
      setCls(lock, 'is-d01', false);
      setCls(lock, 'is-df40ii', false);
      setCls(lock, 'is-rd40', false);
      setCls(lock, 'is-aa14', false);
      setCls(lock, 'is-acquiring', false);
      setCls(lock, 'is-firing', false);
      setCls(lock, 'is-rd30', lockStyle === 'rd30');
      setCls(lock, 'is-rd20', lockStyle === 'rd20');
      setVar(lock, '--lock-rot', '0deg');
      setVar(lock, '--lock-scale', '1');
      setVar(lock, '--ring-op', '0');
      setHid(lockTag, true);
      setSvgHidden(rdOverlay, true);
    }
  }

  /**
   * FermatCore 1.0 Ultra-Light Vector Optics Overlay (0 GPU passes, 0 textures, 0 3D vertices!).
   * Runs identically in full WebGL2, Lightweight Mode, and SoftwareRenderer with < 0.05 ms CPU cost.
   */
  _drawFermat(match, cam, active, enabled, fx, fy, fz, rx, ry, rz, ux, uy, uz, tanHalf, asp) {
    const E = this._el;
    const ov = E.fermatOverlay, node = E.fermatNode, node2 = E.fermatNode2, tag = E.fermatTag;
    const l1 = E.fermatLeg1, l2 = E.fermatLeg2, l3 = E.fermatLeg3;
    if (!ov || !node) return;
    if (!active || !enabled || !match?.fermat || !match?.player?.alive || !cam) {
      setSvgHidden(ov, true);
      setHid(node, true);
      setHid(node2, true);
      match?.fermat?.updatePlayerOracle(match, match.time, false);
      return;
    }

    const {forward: fwd, bank} = match.fermat.updatePlayerOracle(match, match.time, true);
    if (!bank && !fwd) {
      setSvgHidden(ov, true);
      setHid(node, true);
      setHid(node2, true);
      return;
    }

    const cp = cam.pos, cpx = cp[0], cpy = cp[1], cpz = cp[2];
    const invTanX = 50 / (tanHalf * asp), invTanY = 50 / tanHalf;
    const proj = (pt, out) => {
      if (!pt) return null;
      const dx = pt[0] - cpx, dy = pt[1] - cpy, dz = pt[2] - cpz;
      const z = dx * fx + dy * fy + dz * fz;
      if (z < 0.18) return null;
      const sx = 50 + (dx * rx + dy * ry + dz * rz) * invTanX / z;
      const sy = 50 - (dx * ux + dy * uy + dz * uz) * invTanY / z;
      if (sx < -45 || sx > 145 || sy < -45 || sy > 145) return null;
      out[0] = sx; out[1] = sy;
      return out;
    };
    const setSeg = (el, a, b) => {
      if (!el) return;
      if (!a || !b) { setSty(el, 'display', 'none'); return; }
      setSty(el, 'display', '');
      setAttr(el, 'x1', a[0].toFixed(2));
      setAttr(el, 'y1', a[1].toFixed(2));
      setAttr(el, 'x2', b[0].toFixed(2));
      setAttr(el, 'y2', b[1].toFixed(2));
    };

    // Priority 1: Solved Closed-Form Fair-Play Bank-Shot Sweet-Spot (1-Bounce or 2-Bounce Double Bank!)
    if (bank) {
      const p1 = proj(bank.bounce1, this._fermatP1);
      if (p1 && p1[0] >= 4 && p1[0] <= 96 && p1[1] >= 6 && p1[1] <= 94) {
        setHid(node, false);
        setSty(node, 'left', p1[0].toFixed(2) + '%');
        setSty(node, 'top', p1[1].toFixed(2) + '%');
        setCls(node, 'is-locked', !!bank.aligned);
        setCls(node, 'is-preview', false);
        setCls(node, 'is-pen', false);
        if (tag) {
          const srcTag = bank.intelSource === 'knock' ? 'ノック' : bank.intelSource === 'd01' ? 'D01' : bank.intelSource === 'echo' ? '音響' : bank.enemyName;
          setTxt(tag, bank.aligned
            ? (bank.bounces === 2 ? `◆◆ 2段跳弾 LOCK · 撃て!` : `◆ FERMAT LOCK · ${bank.angleDeg}°`)
            : (bank.bounces === 2 ? `◆◆ 2-BANK ${bank.angleDeg}°/${bank.angle2Deg}° · ${srcTag}` : `◆ BANK ${bank.angleDeg}° · ${srcTag}`));
        }
        setSvgHidden(ov, false);
        setCls(ov, 'is-locked', !!bank.aligned);
        setCls(ov, 'is-preview', false);
        setCls(ov, 'is-pen', false);
        setSeg(l1, bank.aimErrorDeg <= 15 ? this._centerPt : null, p1);
        if (bank.bounces === 2 && bank.bounce2) {
          const p2 = proj(bank.bounce2, this._fermatP2);
          const pT = proj(bank.target, this._fermatP3);
          setSeg(l2, p1, p2);
          setSeg(l3, p2, pT);
          const showN2 = !!(node2 && p2 && p2[0] >= 3 && p2[0] <= 97 && p2[1] >= 5 && p2[1] <= 95);
          setHid(node2, !showN2);
          if (showN2) {
            setSty(node2, 'left', p2[0].toFixed(2) + '%');
            setSty(node2, 'top', p2[1].toFixed(2) + '%');
          }
        } else {
          const pT = proj(bank.target, this._fermatP2);
          setSeg(l2, p1, pT);
          setSeg(l3, null, null);
          setHid(node2, true);
        }
        return;
      }
    }

    // Priority 2: Always-Legal Live Crosshair Grazing Ricochet / Wood Crate Wallbang Preview
    if (fwd) {
      const p1 = proj(fwd.p1, this._fermatP1);
      const p2 = proj(fwd.p2, this._fermatP2);
      if (p1 && p1[0] >= 4 && p1[0] <= 96 && p1[1] >= 6 && p1[1] <= 94) {
        const isPen = fwd.kind === 'penetrate';
        setHid(node, false);
        setSty(node, 'left', p1[0].toFixed(2) + '%');
        setSty(node, 'top', p1[1].toFixed(2) + '%');
        setCls(node, 'is-locked', false);
        setCls(node, 'is-pen', isPen);
        setCls(node, 'is-preview', !isPen);
        if (tag) {
          setTxt(tag, isPen
            ? `貫通 ${fwd.thickness.toFixed(1)}m`
            : fwd.bounces === 2
              ? `2段跳弾 ${fwd.angle1}°/${fwd.angle2}°`
              : `跳弾 ${fwd.angle1}°`);
        }
        setSvgHidden(ov, false);
        setCls(ov, 'is-locked', false);
        setCls(ov, 'is-pen', isPen);
        setCls(ov, 'is-preview', !isPen);
        setSeg(l1, null, null);
        setSeg(l2, p1, p2);
        const p3 = proj(isPen ? fwd.end : fwd.p3, this._fermatP3);
        setSeg(l3, p2, p3);
        const showN2 = !!(!isPen && node2 && p2 && p3 && p2[0] >= 3 && p2[0] <= 97 && p2[1] >= 5 && p2[1] <= 95);
        setHid(node2, !showN2);
        if (showN2) {
          setSty(node2, 'left', p2[0].toFixed(2) + '%');
          setSty(node2, 'top', p2[1].toFixed(2) + '%');
        }
        return;
      }
    }

    setSvgHidden(ov, true);
    setHid(node, true);
    setHid(node2, true);
  }

  _ensureOverheadNode(layer, index) {
    while (this._ohPool.length <= index) {
      const el = document.createElement('div');
      el.className = 'oh-tag';
      el.hidden = true;
      el.innerHTML =
        '<div class="oh-top"><span class="oh-side"></span><b class="oh-name"></b><span class="oh-gun"></span><span class="oh-dist"></span></div>' +
        '<div class="oh-bars">' +
          '<div class="oh-bar oh-hp"><i></i></div>' +
          '<div class="oh-bar oh-sh"><i></i></div>' +
          '<div class="oh-bar oh-bz" hidden><i></i></div>' +
        '</div>' +
        '<div class="oh-pin"></div>';
      layer.appendChild(el);
      this._ohPool.push({
        el,
        side: el.querySelector('.oh-side'),
        name: el.querySelector('.oh-name'),
        gun: el.querySelector('.oh-gun'),
        dist: el.querySelector('.oh-dist'),
        hpFill: el.querySelector('.oh-hp > i'),
        shFill: el.querySelector('.oh-sh > i'),
        bzRow: el.querySelector('.oh-bz'),
        bzFill: el.querySelector('.oh-bz > i')
      });
    }
    return this._ohPool[index];
  }

  /**
   * Projects at-a-glance Enemy / Ally overhead identification tags above each actor's head.
   * Strictly Fair-Play: enemies require clear optical LOS (obstruction + AeroVortex smoke)
   * and are completely hidden while Shaffer cloak is active.
   * Uses 30Hz per-actor LOS cache (auto-invalidated on >0.35m motion) + HUD-Diff DOM guards.
   */
  _drawOverheads(match, cam, t, active, viewActor, isFirstPerson, fx, fy, fz, rx, ry, rz, ux, uy, uz, tanHalf, asp) {
    const layer = this._el.overheadLayer;
    if (!layer) return;
    if (!active || !match?.actors?.length || !cam) {
      for (let i = 0; i < this._ohPool.length; i++) setHid(this._ohPool[i].el, true);
      return;
    }
    const cp = cam.pos, cpx = cp[0], cpy = cp[1], cpz = cp[2];
    const invTanX = 50 / (tanHalf * asp), invTanY = 50 / tanHalf;
    const spec = !!match.spectating;
    const myTeam = spec ? 0 : (viewActor?.team ?? match.player?.team ?? 0);
    const pt = this._ohPt;
    const losCache = this._ohLosCache;
    const actors = match.actors;

    let used = 0;
    for (let ai = 0; ai < actors.length; ai++) {
      const e = actors[ai];
      if (!e?.alive) continue;
      if (!spec && e === match.player) continue;
      if (spec && isFirstPerson && e === viewActor) continue;

      const isAlly = e.team === myTeam;
      const isEnemy = !isAlly;
      if (!spec && isEnemy && (e.shafferTimer || 0) > 0) continue;

      const [cx, cz] = bodyCenter(e);
      const tScale = torso(e);
      const ay = e.y + 1.98 * tScale + (e.crouch > 0.3 ? 0.08 : 0.14);
      const dx = cx - cpx, dy = ay - cpy, dz = cz - cpz;
      const z = dx * fx + dy * fy + dz * fz;
      if (z < 0.72 || z > 140) continue;

      const sx = 50 + (dx * rx + dy * ry + dz * rz) * invTanX / z;
      const sy = 50 - (dx * ux + dy * uy + dz * uz) * invTanY / z;
      if (sx < -4 || sx > 104 || sy < -4 || sy > 102) continue;

      // 30Hz per-actor LOS cache (auto-invalidates immediately on >0.35m camera or actor displacement)
      let ent = losCache.get(e.id);
      let clearLos;
      const needLos = !ent
        || (t - ent.at) >= 0.033
        || (t < ent.at)
        || (cpx - ent.cpx) * (cpx - ent.cpx) + (cpy - ent.cpy) * (cpy - ent.cpy) + (cpz - ent.cpz) * (cpz - ent.cpz) > 0.1225
        || (cx - ent.ex) * (cx - ent.ex) + (e.y - ent.ey) * (e.y - ent.ey) + (cz - ent.ez) * (cz - ent.ez) > 0.1225;
      if (needLos) {
        pt[0] = cx; pt[1] = e.y + 1.24 * tScale; pt[2] = cz;
        clearLos = clearOpticalPath(cp, pt, match.aeroVortex);
        if (!clearLos) {
          pt[1] = e.y + 1.66 * tScale;
          clearLos = clearOpticalPath(cp, pt, match.aeroVortex);
        }
        if (!ent) {
          ent = {at: t, cpx, cpy, cpz, ex: cx, ey: e.y, ez: cz, clear: clearLos};
          losCache.set(e.id, ent);
        } else {
          ent.at = t; ent.cpx = cpx; ent.cpy = cpy; ent.cpz = cpz;
          ent.ex = cx; ent.ey = e.y; ent.ez = cz; ent.clear = clearLos;
        }
      } else {
        clearLos = ent.clear;
      }

      if (!spec && isEnemy && !clearLos) continue;

      const slot = this._ensureOverheadNode(layer, used++);
      const el = slot.el;
      setHid(el, false);
      setCls(el, 'is-ally', isAlly);
      setCls(el, 'is-enemy', isEnemy);
      setCls(el, 'is-occluded', !clearLos && !spec);
      setCls(el, 'is-cloak', (e.shafferTimer || 0) > 0);
      setCls(el, 'is-hit', (e.hitFlash || 0) > 0.15);

      const sc = clamp(1.10 - z * 0.0075, 0.72, 1.06);
      setSty(el, 'left', sx.toFixed(2) + '%');
      setSty(el, 'top', sy.toFixed(2) + '%');
      setSty(el, 'transform', `translate(-50%, -100%) scale(${sc.toFixed(3)})`);
      setSty(el, 'zIndex', String(Math.max(1, 200 - Math.round(z))));

      setTxt(slot.side, spec ? (e.team === 0 ? 'A' : 'B') : (isAlly ? '味方' : '敵'));
      setTxt(slot.name, e.name || '');
      const aaTag = e.aa?.level === '1.5' ? ' · 1.5' : '';
      const relTag = e.reload > 0 ? ' 装填' : '';
      setTxt(slot.gun, `${e.gun}${aaTag}${relTag}`);
      setTxt(slot.dist, `${Math.max(1, Math.round(z))}m`);

      const maxHp = e.maxHp || 100;
      const hpPct = clamp((e.hp / maxHp) * 100, 0, 100);
      const shPct = clamp((e.shield / OH_SHIELD_MAX) * 100, 0, 100);
      const bzVal = Math.max(0, e.baizerShield || 0);
      setSty(slot.hpFill, 'width', hpPct.toFixed(1) + '%');
      setSty(slot.shFill, 'width', shPct.toFixed(1) + '%');
      setHid(slot.bzRow, bzVal <= 0);
      if (bzVal > 0) setSty(slot.bzFill, 'width', clamp((bzVal / OH_BAIZER_MAX) * 100, 0, 100).toFixed(1) + '%');
    }
    for (let i = used; i < this._ohPool.length; i++) {
      setHid(this._ohPool[i].el, true);
    }
  }
}
