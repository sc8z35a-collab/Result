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
      on = !!(play && d && a.alive),
      ads = !!(on && d.ads),
      thermal = ads && d.scope === 'thermal' && this.wallet.state.evr;
    $('dfHud').hidden = !on;
    $('touchDF').hidden = !on;
    $('optics').hidden = !ads;
    $('optics').classList.toggle('thermal-on', thermal);
    $('thermal').hidden = !thermal;
    $('lockDot').hidden = true;
    if (!on)return;
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
    if (!d.locked || thermal)return;
    const e = match.actors[d.focusId];
    if (!e?.alive)return;
    const f = unit(sub(cam.target, cam.pos)),
      r = unit(cross(f, [0, 1, 0])),
      u = cross(r, f),
      rel = sub(targetPoint(e), cam.pos),
      z = dot(rel, f);
    if (z < .01)return;
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const lock = $('lockDot');
    lock.hidden = false;
    lock.style.left = (50 + 50 * dot(rel, r) / (z * tan * renderer.aspect)) + '%';
    lock.style.top = (50 - 50 * dot(rel, u) / (z * tan)) + '%'
  }
}
