import {money, PilotWallet} from './wallet.js';
import {ThermalOptic} from './optic.js';
import {targetPoint, bodyCenter, torso} from './posture.js';
import {unit, sub, cross, dot, clamp} from './geometry.js';
import {clearOpticalPath} from './yard.js';
const $ = s => document.getElementById(s);
const setSvgHidden = (el, hide) => { if (el) el.toggleAttribute('hidden', !!hide); };
const OH_SHIELD_MAX = 25;
const OH_BAIZER_MAX = 100;
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
          'DF40 II': ['ARV1.3 · AA1.3', '2.08× · 4発同時 · 上限500 (2/s)', 'AA1.4', 'X / E 一時強化 (過熱 6s)']
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

    // Overhead Enemy/Ally Identification Tags (100% Fair-Play LOS + Smoke + Shaffer gated)
    this._drawOverheads(renderer, match, cam, !!(showOverheads && match && !thermal), a, play);

    // FermatCore 1.0: Ultra-Light Smartphone-Safe 2D Vector Projection (0 GPU passes, 0 textures, works in Lightweight Mode!)
    this._drawFermat(renderer, match, cam, play && !ads && !match?.spectating, fermatOn);

    // EchoPulse 1.0 Peripheral Sound-to-Sight Tactical Acoustic Compass (works even when muted!)
    const compass = $('echoCompass');
    if (compass) {
      const arcs = (play && echoOn && a?.alive && !ads && match?.echoPulse)
        ? match.echoPulse.getCompassArcs(a, match.time, 6)
        : [];
      const nodes = compass.children;
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        const arc = arcs[i];
        if (!arc) {
          el.style.opacity = '0';
          continue;
        }
        el.className = 'ep-' + arc.kind + (arc.occluded ? ' ep-occ' : '');
        el.style.setProperty('--ep-ang', arc.deg.toFixed(1) + 'deg');
        el.style.opacity = (arc.alpha * (arc.occluded ? .62 : .88)).toFixed(3);
      }
    }

    $('dfHud').hidden = !on || uaaOn;
    $('dfHud').classList.toggle('is-aa-off', !autoAimOn);
    const rdHud = $('rdHud');
    const heatWrap = $('aa14HeatWrap');
    if (rdHud) {
      rdHud.hidden = !(uaaOn || rdOn || df40On);
      rdHud.classList.toggle('is-scherp', isScherp);
      rdHud.classList.toggle('is-rd20', isRD20);
      rdHud.classList.toggle('is-rd30', isRD30);
      rdHud.classList.toggle('is-rd40', isRD40);
      rdHud.classList.toggle('is-df40ii', df40On || (uaaOn && !isScherp));
      rdHud.classList.toggle('is-aa14', aa14On || (uaaOn && uaaLevel === '1.4'));
      rdHud.classList.toggle('is-overheat', aa14Hot);
      rdHud.classList.toggle('is-aa-off', !autoAimOn && !uaaOn);
      rdHud.classList.toggle('is-locked', (uaaOn && !!uaa.locked) || (autoAimOn && (!!(rdOn && rd.locked) || !!(df40On && df40.locked))));
    }
    if (heatWrap) heatWrap.hidden = !df40On;
    $('touchDF').hidden = !on || !!match?.spectating;
    const touchDF40 = $('touchDF40');
    if (touchDF40) {
      touchDF40.hidden = !df40On || !!match?.spectating;
      const btn = $('mobileAA14');
      if (btn && df40On) {
        btn.classList.toggle('is-active', autoAimOn && aa14On);
        btn.classList.toggle('is-overheat', aa14Hot);
        btn.classList.toggle('is-disabled', !autoAimOn);
        btn.textContent = !autoAimOn
          ? 'AA OFF'
          : aa14Hot
            ? `過熱 ${Math.ceil(df40.aa14Cooldown)}s`
            : aa14On
              ? `AA1.4 ${Math.round(df40.aa14Heat)}%`
              : df40.aa14Heat > 1
                ? `AA1.4 · ${Math.round(df40.aa14Heat)}%`
                : 'AA1.4';
      }
    }
    $('optics').hidden = !ads;
    $('optics').classList.toggle('thermal-on', thermal);
    $('thermal').hidden = !thermal;

    const reticle = $('reticle');
    if (reticle) {
      const smartObj = uaaOn ? uaa : autoAimOn ? (isRD40 ? rd : df40On ? df40 : null) : null;
      reticle.classList.toggle('is-aa-off', !autoAimOn && !uaaOn);
      reticle.classList.toggle('is-scherp', isScherp);
      reticle.classList.toggle('is-rd-locked', !!(smartObj && smartObj.locked));
      reticle.classList.toggle('is-rd-d01', !!(smartObj && (smartObj.d01Active || smartObj.wallActive)));
      reticle.classList.toggle('is-rd-fire', !!(smartObj && (smartObj.firePulse || 0) > .18));
      reticle.classList.toggle('is-aa14', (autoAimOn && aa14On) || (uaaOn && uaaLevel === '1.4'));
      reticle.classList.toggle('is-overheat', aa14Hot);
    }

    const lock = $('lockDot');
    const lockTag = $('lockTag');
    const rdOverlay = $('rdOverlay');
    const rdTether = $('rdTether');
    const rdTetherGlow = $('rdTetherGlow');
    lock.hidden = true;
    lock.classList.remove('is-scherp', 'is-rd40', 'is-rd30', 'is-rd20', 'is-df40ii', 'is-aa14', 'is-d01', 'is-acquiring', 'is-firing');
    if (lockTag) lockTag.hidden = true;
    if (rdOverlay) {
      setSvgHidden(rdOverlay, true);
      rdOverlay.classList.remove('is-scherp', 'is-df40ii', 'is-aa14', 'is-d01', 'is-fire', 'is-acquiring');
    }

    let lockTargetId = -1, lockStyle = 'df', isD01 = false, isAcquiring = false;
    if (reticle) reticle.hidden = !!(play && (!a?.alive || ads));
    if (uaaOn && rdHud) {
      const pct = Math.round((uaa.focus || 0) * 100);
      const tierLabel = isScherp ? '1.5 SCHERP' : `AA ${uaaLevel}`;
      const modeTag = uaa.solveMode === 'bank' ? 'BANK' : uaa.solveMode === 'pen' ? 'PEN' : uaa.wallActive ? `WALL ${uaa.wallTimer.toFixed(1)}s` : 'LOCK';
      $('rdFocusText').textContent = uaa.locked
        ? `${tierLabel} · ${modeTag}`
        : uaa.focus > 0 ? `${tierLabel} · ${pct}%` : `${tierLabel} · SCAN`;
      $('rdSensorText').hidden = false;
      $('rdSensorText').textContent = isScherp
        ? (uaa.locked ? `ZEM-APN · ${Math.max(1, Math.round(uaa.targetDist || 0))}m` : 'ZEM-APN · BANK/PEN')
        : (uaa.wallActive ? `WALL ${uaa.wallTimer.toFixed(1)}s` : `${a.gun}`);
      rdHud.classList.toggle('is-d01', !!uaa.wallActive);
      const barPct = uaa.wallActive ? (uaa.wallTimer / (uaa.wallMax || 4)) * 100 : uaa.locked ? 100 : (uaa.focus || 0) * 100;
      $('d01Bar').style.width = Math.max(0, Math.min(100, barPct)).toFixed(1) + '%';
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
      $('focusText').textContent = !autoAimOn
        ? 'ARV1.1  ·  オートエイム OFF'
        : d.locked ? 'ARV1.1  •  弾道誘導 1.76× LOCK' : d.focus ? 'ARV1.1  ·  焦点 ' + Math.round(d.focus * 100) + '%' : 'ARV1.1  ·  待機';
      $('dfMode').textContent = (d.pattern === 'central' ? '中央集中' : '散弾') + '  /  ' + (d.scope === 'thermal' ? 'EVR1' : 'プラスチック');
      $('p1Text').textContent = `P1 ${d.p1} / 20　${d.cooling>0?'冷却 '+d.cooling.toFixed(1)+' s':d.boost?'BOOST':'待機'}　${Math.round(d.heat)}%`;
      $('heatBar').style.width = d.heat + '%';
      $('dfKeys').textContent = 'Q 範囲 · X ブースト · 右クリック 照準 · V レンズ';
      if (autoAimOn && d.locked && !thermal) {
        lockTargetId = d.focusId;
        lockStyle = 'df';
      }
    } else if (df40On && rdHud) {
      const pct = Math.round((df40.focus || 0) * 100);
      const heatPct = Math.round(df40.aa14Heat || 0);
      if (!autoAimOn) {
        $('rdFocusText').textContent = 'ARV1.3  ·  オートエイム OFF';
        $('rdSensorText').hidden = false;
        $('rdSensorText').textContent = aa14Hot
          ? `AA1.4 冷却中 ${df40.aa14Cooldown.toFixed(1)}s · 手動エイム`
          : '手動エイム中 · O / AAでON';
        rdHud.classList.remove('is-d01');
        $('d01Bar').style.width = '0%';
      } else {
        if (aa14On) {
          $('rdFocusText').textContent = df40.locked
            ? (df40.d01Active ? `ARV1.3 · AA1.4  •  壁裏超LOCK ${df40.d01Timer.toFixed(1)}s` : 'ARV1.3 · AA1.4  •  超LOCK (2.80×収束)')
            : df40.focus > 0 ? `ARV1.3 · AA1.4  ·  即焦点 ${pct}%` : 'ARV1.3 · AA1.4 OVERDRIVE  ·  超広域';
        } else {
          $('rdFocusText').textContent = df40.locked
            ? (df40.d01Active ? `ARV1.3 · AA1.3  •  壁裏LOCK ${df40.d01Timer.toFixed(1)}s` : 'ARV1.3 · AA1.3  •  LOCK (2.08×収束)')
            : df40.focus > 0 ? `ARV1.3 · AA1.3  ·  焦点 ${pct}%` : 'ARV1.3 · AA1.3  ·  待機 (1.65×広域)';
        }
        $('rdSensorText').hidden = false;
        $('rdSensorText').textContent = aa14Hot
          ? `AA1.4 OVERHEAT  ·  冷却 ${df40.aa14Cooldown.toFixed(1)}s (${heatPct}%)`
          : aa14On
            ? `AA1.4 OVERDRIVE  ·  熱量 ${heatPct}%  [X/E 解除]`
            : heatPct > 0
              ? `AA1.4 放熱中 ${heatPct}%  ·  [X/E 再起動]`
              : 'AA1.4 READY  ·  X / E で一時強化起動';
        rdHud.classList.toggle('is-d01', !!df40.d01Active && !aa14Hot);
        const barPct = df40.d01Active ? (df40.d01Timer / (df40.d01Max || 4.5)) * 100 : df40.locked ? 100 : (df40.focus || 0) * 100;
        $('d01Bar').style.width = Math.max(0, Math.min(100, barPct)).toFixed(1) + '%';
        if (df40.focusId >= 0 && (df40.locked || df40.focus > .04)) {
          lockTargetId = df40.focusId;
          lockStyle = 'df40ii';
          isD01 = !!df40.d01Active;
          isAcquiring = !df40.locked;
        }
      }
      if ($('aa14HeatBar')) $('aa14HeatBar').style.width = Math.max(0, Math.min(100, df40.aa14Heat || 0)).toFixed(1) + '%';
    } else if (rdOn && rdHud) {
      const pct = Math.round((rd.focus || 0) * 100);
      if (!autoAimOn) {
        const label = isRD40 ? 'ARV1.2' : isRD30 ? 'ARV1.1 mini' : 'ARV1.1';
        $('rdFocusText').textContent = `${label}  ·  オートエイム OFF`;
        $('rdSensorText').hidden = false;
        $('rdSensorText').textContent = '手動エイム中 · O / AAでON';
        rdHud.classList.remove('is-d01');
        $('d01Bar').style.width = '0%';
      } else if (isRD40) {
        $('rdFocusText').textContent = rd.locked
          ? (rd.d01Active ? 'ARV1.2  •  D01 壁裏LOCK' : 'ARV1.2  •  LOCK (1.4×広域)')
          : rd.focus > 0 ? `ARV1.2  ·  焦点 ${pct}%` : 'ARV1.2  ·  待機 (1.4×広域)';
        $('rdSensorText').hidden = false;
        $('rdSensorText').textContent = rd.d01Active
          ? `D01 SENSOR  ·  壁裏追従 ${rd.d01Timer.toFixed(1)}s`
          : rd.locked ? 'D01 SENSOR  ·  追従待機 (4.0s)' : 'D01 SENSOR  ·  常時スキャン';
        rdHud.classList.toggle('is-d01', !!rd.d01Active);
        const barPct = rd.d01Active ? (rd.d01Timer / (rd.d01Max || 4)) * 100 : rd.locked ? 100 : (rd.focus || 0) * 100;
        $('d01Bar').style.width = Math.max(0, Math.min(100, barPct)).toFixed(1) + '%';
        if (rd.focusId >= 0 && (rd.locked || rd.focus > .04)) {
          lockTargetId = rd.focusId;
          lockStyle = 'rd40';
          isD01 = !!rd.d01Active;
          isAcquiring = !rd.locked;
        }
      } else {
        const label = isRD30 ? 'ARV1.1 mini' : 'ARV1.1';
        $('rdFocusText').textContent = rd.locked
          ? `${label}  •  弾道誘導 LOCK`
          : rd.focus > 0 ? `${label}  ·  焦点 ${pct}%` : `${label}  ·  待機`;
        $('rdSensorText').hidden = false;
        $('rdSensorText').textContent = isRD30 ? 'RD30  ·  2発同時フルオート' : 'RD20  ·  軽量スマート誘導 1.76×';
        rdHud.classList.remove('is-d01');
        $('d01Bar').style.width = Math.max(0, Math.min(100, (rd.locked ? 1 : rd.focus || 0) * 100)).toFixed(1) + '%';
        if (rd.locked) {
          lockTargetId = rd.focusId;
          lockStyle = isRD30 ? 'rd30' : 'rd20';
        }
      }
    }
    this.wasThermal = thermal;
    if (lockTargetId < 0) return;
    const e = match.actors[lockTargetId];
    if (!e?.alive)return;
    const f = unit(sub(cam.target, cam.pos)),
      r = unit(cross(f, [0, 1, 0])),
      u = cross(r, f),
      rel = sub(targetPoint(e), cam.pos),
      z = dot(rel, f);
    if (z < .01)return;
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const sx = Math.max(4, Math.min(96, 50 + 50 * dot(rel, r) / (z * tan * renderer.aspect)));
    const sy = Math.max(6, Math.min(94, 50 - 50 * dot(rel, u) / (z * tan)));
    lock.hidden = false;
    lock.style.left = sx.toFixed(2) + '%';
    lock.style.top = sy.toFixed(2) + '%';

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

      lock.classList.add(isScherpLock ? 'is-scherp' : isD01 ? 'is-d01' : (isDF40 || isUaaStyle) ? 'is-df40ii' : 'is-rd40');
      lock.classList.toggle('is-aa14', isAA14Lock);
      lock.classList.toggle('is-acquiring', isAcquiring);
      lock.classList.toggle('is-firing', fp > .15 && !isAcquiring);
      lock.style.setProperty('--lock-rot', rotDeg.toFixed(1) + 'deg');
      lock.style.setProperty('--lock-scale', scaleVal.toFixed(3));
      lock.style.setProperty('--ring-scale', ringScale.toFixed(3));
      lock.style.setProperty('--ring-op', ringOp.toFixed(3));

      if (lockTag) {
        lockTag.hidden = false;
        if (isScherpLock) {
          const mTag = src.solveMode === 'bank' ? 'BANK' : src.solveMode === 'pen' ? 'PEN' : isD01 ? `W ${src.wallTimer.toFixed(1)}s` : 'LOCK';
          lockTag.textContent = `1.5 SCHERP · ${mTag} · ${distM}m`;
        } else if (isUaaStyle) {
          lockTag.textContent = `AA ${src.level || uaaLevel} · ${distM}m`;
        } else {
          lockTag.textContent = isD01
            ? `${isDF40 ? 'D01-II' : 'D01'} ${src.d01Timer.toFixed(1)}s · ${distM}m`
            : isAcquiring
              ? `${isAA14Lock ? 'AA1.4' : isDF40 ? 'ARV1.3' : 'SCAN'} ${Math.round(foc * 100)}%`
              : isAA14Lock
                ? `AA1.4 · ${distM}m`
                : isDF40
                  ? `ARV1.3 · ${distM}m`
                  : `ARV1.2 · ${distM}m`;
        }
      }

      // Live vector tracking tether laser from reticle center (50, 50) to tracked target (sx, sy)
      if (rdOverlay && rdTether && (src.locked || foc > .32)) {
        const sxs = sx.toFixed(2), sys = sy.toFixed(2);
        setSvgHidden(rdOverlay, false);
        rdOverlay.classList.toggle('is-scherp', isScherpLock);
        rdOverlay.classList.toggle('is-df40ii', isDF40 || (isUaaStyle && !isScherpLock));
        rdOverlay.classList.toggle('is-aa14', isAA14Lock);
        rdOverlay.classList.toggle('is-d01', isD01 && !isScherpLock);
        rdOverlay.classList.toggle('is-fire', fp > .15 && !isAcquiring);
        rdOverlay.classList.toggle('is-acquiring', isAcquiring);
        rdTether.setAttribute('x2', sxs);
        rdTether.setAttribute('y2', sys);
        if (rdTetherGlow) {
          rdTetherGlow.setAttribute('x2', sxs);
          rdTetherGlow.setAttribute('y2', sys);
        }
      }
    } else {
      lock.classList.toggle('is-rd30', lockStyle === 'rd30');
      lock.classList.toggle('is-rd20', lockStyle === 'rd20');
      lock.style.setProperty('--lock-rot', '0deg');
      lock.style.setProperty('--lock-scale', '1');
      lock.style.setProperty('--ring-op', '0');
    }
  }

  /**
   * FermatCore 1.0 Ultra-Light Vector Optics Overlay (0 GPU passes, 0 textures, 0 3D vertices!).
   * Runs identically in full WebGL2, Lightweight Mode, and SoftwareRenderer with < 0.05 ms CPU cost.
   */
  _drawFermat(renderer, match, cam, active, enabled) {
    const ov = $('fermatOverlay'), node = $('fermatNode'), node2 = $('fermatNode2'), tag = $('fermatTag');
    const l1 = $('fermatLeg1'), l2 = $('fermatLeg2'), l3 = $('fermatLeg3');
    if (!ov || !node) return;
    if (!active || !enabled || !match?.fermat || !match?.player?.alive || !cam) {
      setSvgHidden(ov, true);
      node.hidden = true;
      if (node2) node2.hidden = true;
      match?.fermat?.updatePlayerOracle(match, match.time, false);
      return;
    }

    const {forward: fwd, bank} = match.fermat.updatePlayerOracle(match, match.time, true);
    if (!bank && !fwd) {
      setSvgHidden(ov, true);
      node.hidden = true;
      if (node2) node2.hidden = true;
      return;
    }

    const f = unit(sub(cam.target, cam.pos));
    const r = unit(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const asp = renderer?.aspect || (innerWidth / Math.max(1, innerHeight));
    const proj = pt => {
      if (!pt) return null;
      const rel = sub(pt, cam.pos);
      const z = dot(rel, f);
      if (z < 0.18) return null;
      const sx = 50 + 50 * dot(rel, r) / (z * tan * asp);
      const sy = 50 - 50 * dot(rel, u) / (z * tan);
      if (sx < -45 || sx > 145 || sy < -45 || sy > 145) return null;
      return [sx, sy];
    };
    const setSeg = (el, a, b) => {
      if (!el) return;
      if (!a || !b) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.setAttribute('x1', a[0].toFixed(2));
      el.setAttribute('y1', a[1].toFixed(2));
      el.setAttribute('x2', b[0].toFixed(2));
      el.setAttribute('y2', b[1].toFixed(2));
    };

    ov.classList.remove('is-locked', 'is-preview', 'is-pen');
    node.classList.remove('is-locked', 'is-preview', 'is-pen');
    if (node2) node2.hidden = true;

    // Priority 1: Solved Closed-Form Fair-Play Bank-Shot Sweet-Spot (1-Bounce or 2-Bounce Double Bank!)
    if (bank) {
      const p1 = proj(bank.bounce1);
      if (p1 && p1[0] >= 4 && p1[0] <= 96 && p1[1] >= 6 && p1[1] <= 94) {
        node.hidden = false;
        node.style.left = p1[0].toFixed(2) + '%';
        node.style.top = p1[1].toFixed(2) + '%';
        node.classList.toggle('is-locked', !!bank.aligned);
        if (tag) {
          const srcTag = bank.intelSource === 'knock' ? 'ノック' : bank.intelSource === 'd01' ? 'D01' : bank.intelSource === 'echo' ? '音響' : bank.enemyName;
          tag.textContent = bank.aligned
            ? (bank.bounces === 2 ? `◆◆ 2段跳弾 LOCK · 撃て!` : `◆ FERMAT LOCK · ${bank.angleDeg}°`)
            : (bank.bounces === 2 ? `◆◆ 2-BANK ${bank.angleDeg}°/${bank.angle2Deg}° · ${srcTag}` : `◆ BANK ${bank.angleDeg}° · ${srcTag}`);
        }
        setSvgHidden(ov, false);
        ov.classList.toggle('is-locked', !!bank.aligned);
        // Show hairline guide tether when crosshair approaches the Fermat Sweet-Spot (< 15 deg)
        setSeg(l1, bank.aimErrorDeg <= 15 ? [50, 50] : null, p1);
        if (bank.bounces === 2 && bank.bounce2) {
          const p2 = proj(bank.bounce2);
          const pT = proj(bank.target);
          setSeg(l2, p1, p2);
          setSeg(l3, p2, pT);
          if (node2 && p2 && p2[0] >= 3 && p2[0] <= 97 && p2[1] >= 5 && p2[1] <= 95) {
            node2.hidden = false;
            node2.style.left = p2[0].toFixed(2) + '%';
            node2.style.top = p2[1].toFixed(2) + '%';
          }
        } else {
          const pT = proj(bank.target);
          setSeg(l2, p1, pT);
          setSeg(l3, null, null);
        }
        return;
      }
    }

    // Priority 2: Always-Legal Live Crosshair Grazing Ricochet / Wood Crate Wallbang Preview
    if (fwd) {
      const p1 = proj(fwd.p1);
      const p2 = proj(fwd.p2);
      if (p1 && p1[0] >= 4 && p1[0] <= 96 && p1[1] >= 6 && p1[1] <= 94) {
        const isPen = fwd.kind === 'penetrate';
        node.hidden = false;
        node.style.left = p1[0].toFixed(2) + '%';
        node.style.top = p1[1].toFixed(2) + '%';
        node.classList.add(isPen ? 'is-pen' : 'is-preview');
        if (tag) {
          tag.textContent = isPen
            ? `貫通 ${fwd.thickness.toFixed(1)}m`
            : fwd.bounces === 2
              ? `2段跳弾 ${fwd.angle1}°/${fwd.angle2}°`
              : `跳弾 ${fwd.angle1}°`;
        }
        setSvgHidden(ov, false);
        ov.classList.add(isPen ? 'is-pen' : 'is-preview');
        setSeg(l1, null, null);
        setSeg(l2, p1, p2);
        const p3 = proj(isPen ? fwd.end : fwd.p3);
        setSeg(l3, p2, p3);
        if (!isPen && node2 && p2 && p3 && p2[0] >= 3 && p2[0] <= 97 && p2[1] >= 5 && p2[1] <= 95) {
          node2.hidden = false;
          node2.style.left = p2[0].toFixed(2) + '%';
          node2.style.top = p2[1].toFixed(2) + '%';
        }
        return;
      }
    }

    setSvgHidden(ov, true);
    node.hidden = true;
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
        bzFill: el.querySelector('.oh-bz > i'),
        lastSide: '',
        lastName: '',
        lastGun: '',
        lastDist: ''
      });
    }
    return this._ohPool[index];
  }

  /**
   * Projects at-a-glance Enemy / Ally overhead identification tags above each actor's head.
   * Strictly Fair-Play: enemies require clear optical LOS (obstruction + AeroVortex smoke)
   * and are completely hidden while Shaffer cloak is active.
   */
  _drawOverheads(renderer, match, cam, active, viewActor, isFirstPerson) {
    const layer = $('overheadLayer');
    if (!layer) return;
    if (!active || !match?.actors?.length || !cam) {
      for (let i = 0; i < this._ohPool.length; i++) this._ohPool[i].el.hidden = true;
      return;
    }
    const f = unit(sub(cam.target, cam.pos));
    const r = unit(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const asp = renderer?.aspect || (innerWidth / Math.max(1, innerHeight));
    const spec = !!match.spectating;
    const myTeam = spec ? 0 : (viewActor?.team ?? match.player?.team ?? 0);

    let used = 0;
    for (const e of match.actors) {
      if (!e?.alive) continue;
      if (!spec && e === match.player) continue;
      if (spec && isFirstPerson && e === viewActor) continue;

      const isAlly = e.team === myTeam;
      const isEnemy = !isAlly;
      const [cx, cz] = bodyCenter(e);
      const tScale = torso(e);
      const anchor = [cx, e.y + 1.98 * tScale + (e.crouch > 0.3 ? 0.08 : 0.14), cz];
      const rel = sub(anchor, cam.pos);
      const z = dot(rel, f);
      if (z < 0.72 || z > 140) continue;

      const sx = 50 + 50 * dot(rel, r) / (z * tan * asp);
      const sy = 50 - 50 * dot(rel, u) / (z * tan);
      if (sx < -4 || sx > 104 || sy < -4 || sy > 102) continue;

      const chest = [cx, e.y + 1.24 * tScale, cz];
      const head = [cx, e.y + 1.66 * tScale, cz];
      const clearLos = clearOpticalPath(cam.pos, chest, match.aeroVortex) ||
        clearOpticalPath(cam.pos, head, match.aeroVortex);

      if (!spec && isEnemy) {
        if ((e.shafferTimer || 0) > 0) continue;
        if (!clearLos) continue;
      }

      const slot = this._ensureOverheadNode(layer, used++);
      const el = slot.el;
      el.hidden = false;
      el.classList.toggle('is-ally', isAlly);
      el.classList.toggle('is-enemy', isEnemy);
      el.classList.toggle('is-occluded', !clearLos && !spec);
      el.classList.toggle('is-cloak', (e.shafferTimer || 0) > 0);
      el.classList.toggle('is-hit', (e.hitFlash || 0) > 0.15);

      const scale = clamp(1.10 - z * 0.0075, 0.72, 1.06);
      el.style.left = sx.toFixed(2) + '%';
      el.style.top = sy.toFixed(2) + '%';
      el.style.transform = `translate(-50%, -100%) scale(${scale.toFixed(3)})`;
      el.style.zIndex = String(Math.max(1, 200 - Math.round(z)));

      const sideText = spec
        ? (e.team === 0 ? 'A' : 'B')
        : (isAlly ? '味方' : '敵');
      if (slot.lastSide !== sideText) {
        slot.lastSide = sideText;
        slot.side.textContent = sideText;
      }

      const nameText = e.name || '';
      if (slot.lastName !== nameText) {
        slot.lastName = nameText;
        slot.name.textContent = nameText;
      }

      const aaTag = e.aa?.level === '1.5' ? ' · 1.5' : '';
      const relTag = e.reload > 0 ? ' 装填' : '';
      const gunText = `${e.gun}${aaTag}${relTag}`;
      if (slot.lastGun !== gunText) {
        slot.lastGun = gunText;
        slot.gun.textContent = gunText;
      }

      const distText = `${Math.max(1, Math.round(z))}m`;
      if (slot.lastDist !== distText) {
        slot.lastDist = distText;
        slot.dist.textContent = distText;
      }

      const maxHp = e.maxHp || 100;
      const hpPct = clamp((e.hp / maxHp) * 100, 0, 100);
      const shPct = clamp((e.shield / OH_SHIELD_MAX) * 100, 0, 100);
      const bzVal = Math.max(0, e.baizerShield || 0);
      slot.hpFill.style.width = hpPct.toFixed(1) + '%';
      slot.shFill.style.width = shPct.toFixed(1) + '%';
      slot.bzRow.hidden = bzVal <= 0;
      if (bzVal > 0) slot.bzFill.style.width = clamp((bzVal / OH_BAIZER_MAX) * 100, 0, 100).toFixed(1) + '%';
    }
    for (let i = used; i < this._ohPool.length; i++) {
      this._ohPool[i].el.hidden = true;
    }
  }
}
