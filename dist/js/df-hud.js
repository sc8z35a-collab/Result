import {money, PilotWallet} from './wallet.js';
import {ThermalOptic} from './optic.js';
import {targetPoint} from './posture.js';
import {unit, sub, cross, dot} from './geometry.js';
const $ = s => document.getElementById(s);
export class PilotEquipment {
  constructor(getMatch, notice) {
    this.getMatch = getMatch;
    this.notice = notice;
    this.thermal = new ThermalOptic($('thermal'));
    this.wallet = new PilotWallet(() => this.accountView());
    this.buying = false;
    for (const id of ['buyLobby', 'buyPause'])$(id).onclick = () => this.buy();
    for (const [id, code] of [['mobileADS', 'ads'], ['mobilePattern', 'pattern'], ['mobileBoost', 'boost'], ['mobileOptic', 'scope']])$(id).onpointerdown = e => {
      e.preventDefault();
      this.action(code)
    };
    this.camera = null
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
    if (m?.ended)this.result(m)
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
    this.wallet.change(e.receipt).catch (() => this.notice('クレジットを保存できませんでした'));
    this.notice('＋1 POINT　/　＋0.10 CR')
  }
  result(match) {
    $('creditResult').innerHTML = `<span>今回の獲得 <strong>＋${money(match.player.earned)} CR</strong></span><span>所持 ${money(this.wallet.state.units)} CR</span>`
  }
  action(code) {
    const m = this.getMatch(), a = m?.player, d = a?.df;
    if (!d || !a.alive || m.ended)return;
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
      const isRD = loadout === 'RD20' || loadout === 'RD30' || loadout === 'RD40';
      rdEl.hidden = !isRD;
      rdEl.classList.toggle('is-rd20', loadout === 'RD20');
      rdEl.classList.toggle('is-rd30', loadout === 'RD30');
      rdEl.classList.toggle('is-rd40', loadout === 'RD40');
      if (isRD) {
        const specs = {
          RD20: ['ARV1.1', 'オートエイム 1.1（1.76×弾道誘導＋予測射撃） · 20発 1発同時フルオート', 'CLASS', '軽量スマートカービン · プレイヤー / NPC 開放'],
          RD30: ['ARV1.1 mini', '軽量オートエイム 1.1 mini 搭載 · 80発 2発同時フルオート', 'CLASS', '標準ツインバレル · プレイヤー / NPC 開放'],
          RD40: ['ARV1.2', '強化オートエイム 1.2（1.92×） · ロック範囲 1.4倍 · 広域追従＆立体モーション', 'D01 SENSOR', '壁裏に隠れた敵にも最大 4.0秒間ロック＆エイムを追従']
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
    if (a.df && this.wallet.state.evr)a.df.scope = 'thermal'
  }
  pause(a) {
    $('pauseCredits').hidden = !a?.df;
    this.accountView()
  }
  draw(renderer, match, cam, t, play, lite = false) {
    const a = match?.player,
      d = a?.df,
      rd = a?.rd,
      on = !!(play && d && a.alive),
      rdOn = !!(play && rd && a.alive),
      isRD40 = rdOn && a.gun === 'RD40',
      isRD30 = rdOn && a.gun === 'RD30',
      isRD20 = rdOn && a.gun === 'RD20',
      ads = !!(on && d.ads),
      thermal = ads && d.scope === 'thermal' && this.wallet.state.evr;
    $('dfHud').hidden = !on;
    const rdHud = $('rdHud');
    if (rdHud) {
      rdHud.hidden = !rdOn;
      rdHud.classList.toggle('is-rd20', isRD20);
      rdHud.classList.toggle('is-rd30', isRD30);
      rdHud.classList.toggle('is-rd40', isRD40);
      rdHud.classList.toggle('is-locked', !!(rdOn && rd.locked));
    }
    $('touchDF').hidden = !on;
    $('optics').hidden = !ads;
    $('optics').classList.toggle('thermal-on', thermal);
    $('thermal').hidden = !thermal;

    const reticle = $('reticle');
    if (reticle) {
      reticle.classList.toggle('is-rd-locked', !!(isRD40 && rd.locked));
      reticle.classList.toggle('is-rd-d01', !!(isRD40 && rd.d01Active));
      reticle.classList.toggle('is-rd-fire', !!(isRD40 && (rd.firePulse || 0) > .18));
    }

    const lock = $('lockDot');
    const lockTag = $('lockTag');
    const rdOverlay = $('rdOverlay');
    const rdTether = $('rdTether');
    const rdTetherGlow = $('rdTetherGlow');
    lock.hidden = true;
    lock.classList.remove('is-rd40', 'is-rd30', 'is-rd20', 'is-d01', 'is-acquiring', 'is-firing');
    if (lockTag) lockTag.hidden = true;
    if (rdOverlay) {
      rdOverlay.hidden = true;
      rdOverlay.classList.remove('is-d01', 'is-fire', 'is-acquiring');
    }

    let lockTargetId = -1, lockStyle = 'df', isD01 = false, isAcquiring = false;
    if (on) {
      $('reticle').hidden = ads;
      if (thermal && (!lite || this.lastThermal === undefined || t - this.lastThermal >= .05 || t < this.lastThermal)) {
        this.lastThermal = t;
        this.thermal.draw(renderer, match, cam, t);
      }
      $('focusText').textContent = d.locked ? 'ARV1.1  •  弾道誘導 1.76× LOCK' : d.focus ? 'ARV1.1  ·  焦点 ' + Math.round(d.focus * 100) + '%' : 'ARV1.1  ·  待機';
      $('dfMode').textContent = (d.pattern === 'central' ? '中央集中' : '散弾') + '  /  ' + (d.scope === 'thermal' ? 'EVR1' : 'プラスチック');
      $('p1Text').textContent = `P1 ${d.p1} / 20　${d.cooling>0?'冷却 '+d.cooling.toFixed(1)+' s':d.boost?'BOOST':'待機'}　${Math.round(d.heat)}%`;
      $('heatBar').style.width = d.heat + '%';
      $('dfKeys').textContent = 'Q 範囲 · X ブースト · 右クリック 照準 · V レンズ';
      if (d.locked && !thermal) {
        lockTargetId = d.focusId;
        lockStyle = 'df';
      }
    } else if (rdOn && rdHud) {
      const pct = Math.round((rd.focus || 0) * 100);
      if (isRD40) {
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
    if (lockTargetId < 0)return;
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

    if (lockStyle === 'rd40') {
      const lp = rd.lockPulse || 0;
      const fp = rd.firePulse || 0;
      const dp = rd.d01Pulse || 0;
      const foc = rd.focus || 0;
      const distM = Math.max(1, Math.round(rd.targetDist || z));
      const rotDeg = isAcquiring
        ? (1 - foc) * 52
        : isD01
          ? 45 + Math.sin(t * 2.8) * 12
          : Math.sin(t * 3.1) * 3.5 + (rd.barrelPhase ? 1 : -1) * fp * 11;
      const scaleVal = isAcquiring
        ? 1.78 - 0.72 * foc
        : 1.0 + fp * 0.24 - lp * 0.16 + (isD01 ? Math.sin(t * 6.0) * 0.045 : 0);
      const wavePulse = isD01 ? Math.max(dp, (t * 0.95) % 1) : lp;
      const ringScale = isD01 ? 0.75 + wavePulse * 1.95 : 0.72 + (1 - lp) * 2.15;
      const ringOp = isD01 ? Math.max(0, (1 - wavePulse) * 0.85) : lp * 0.95;

      lock.classList.add(isD01 ? 'is-d01' : 'is-rd40');
      lock.classList.toggle('is-acquiring', isAcquiring);
      lock.classList.toggle('is-firing', fp > .15 && !isAcquiring);
      lock.style.setProperty('--lock-rot', rotDeg.toFixed(1) + 'deg');
      lock.style.setProperty('--lock-scale', scaleVal.toFixed(3));
      lock.style.setProperty('--ring-scale', ringScale.toFixed(3));
      lock.style.setProperty('--ring-op', ringOp.toFixed(3));

      if (lockTag) {
        lockTag.hidden = false;
        lockTag.textContent = isD01
          ? `D01 ${rd.d01Timer.toFixed(1)}s · ${distM}m`
          : isAcquiring
            ? `SCAN ${Math.round(foc * 100)}%`
            : `ARV1.2 · ${distM}m`;
      }

      // Live vector tracking tether laser from reticle center (50, 50) to tracked target (sx, sy)
      if (rdOverlay && rdTether && (rd.locked || foc > .32)) {
        const sxs = sx.toFixed(2), sys = sy.toFixed(2);
        rdOverlay.hidden = false;
        rdOverlay.classList.toggle('is-d01', isD01);
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
}
