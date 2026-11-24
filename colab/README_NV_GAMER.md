# 🧠 NV Gamer — 他のゲームへ15行で埋め込める超汎用・30×人間味AI SDK

`dist/js/nvgamer-core.js` と `dist/js/nvgamer-weights.js` は **Result 本体に一切依存しないゼロ依存モジュール** です。
この2ファイルを **レースゲーム・2D/3Dアクション・弾幕シューティング・プラットフォーマー・MOBA・サバイバル・サンドボックス** など任意の JavaScript / TypeScript ゲームにコピーするだけで、人間同然の操作を行う AI ゲーマーとして即座に埋め込めます。

## 15行の埋め込み例（あらゆるゲーム共通）

```js
import {NVGamerCore} from './nvgamer-core.js';
import {loadNVGamerWeights} from './nvgamer-weights.js';

// (任意) Google Colab Pro で学習した nvgamer-weights.json を読み込む
// loadNVGamerWeights(colabWeightsJson);

const gamer = new NVGamerCore({seed: 42});

function updateAI(game, dt) {
  const input = gamer.step({
    time: game.time,
    dt,
    self: {
      vital: player.hp / player.maxHp,
      speed: Math.hypot(player.vx, player.vz) / 10,
      vx: player.vx / 10,
      vz: player.vz / 10,
      danger: game.isUnderAttack ? 1 : 0,
      goalDx: nextCheckpoint.x - player.x,
      goalDz: nextCheckpoint.z - player.z,
      visibility: game.fogVisibility // 0.1..1.0
    },
    entities: game.visibleObjects.map(o => ({
      id: o.id,
      dx: o.x - player.x, dy: o.y - player.y, dz: o.z - player.z,
      vx: o.vx, vz: o.vz,
      hostility: o.isEnemy ? 1 : 0,
      hazard: o.isBulletOrObstacle ? 1 : 0,
      goalValue: o.isCheckpoint ? 1 : 0,
      pickup: o.isItem ? 1 : 0
    })),
    // どんなゲームのボタン・スキルでも8次元記述子だけでゼロショット操作可能
    actions: [
      {id: 'boost', ready: player.nitro > 0, descriptor: [0.6, 0.2, 0.95, 0, 0, 0.7, 0, 0.1]},
      {id: 'dodge', ready: player.dashCd <= 0, descriptor: [0.1, 0.9, 0.95, 0, 0, 0.85, 0, 0.1]}
    ],
    reward: game.consumeLastReward()
  });

  // 仮想人間コントローラー出力をそのままゲーム操作に流し込む！
  player.applyStick(input.moveX, input.moveY);
  player.applyMouse(input.lookDeltaYaw, input.lookDeltaPitch);
  if (input.buttons.get('boost')) player.activateBoost();
  if (input.buttons.get('dodge')) player.activateDodge();
}
```

## Google Colab Pro GPU でのワンクリック強化学習
- ノートブック: `colab/NV_Gamer_Colab_Pro.ipynb`（NVSSとは完全分離）
- 5ジャンル同時並列（FPS / レーシング / 弾幕プラットフォーマー / MOBAサバイバル / 未知のルール反転ゲーム）で Recurrent-PPO + 順方向ワールドモデルを学習し、`nvgamer-weights.json` を書き出します。
