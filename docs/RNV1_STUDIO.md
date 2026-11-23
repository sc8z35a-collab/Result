# RNV1 — Harbor Range A100 高速強化学習スタジオ & ブラウザ推論エンジン

**`RNV1`**（Result Reinforcement Neural V1）は、`Result` の貨物埠頭（50 × 200 m）を舞台に、**Google Colab Pro（NVIDIA A100 GPU）上でランダム初期化から一から高速自己対戦学習**し、そのままブラウザの 360Hz ゲームエンジン（`dist/js/rnv1.js`）へゼロ依存で搭載できる次世代 NPC AI です。

---

## 1. Google Colab Pro (A100) でのワンクリック学習

Colab ノートブック [`training/RNV1_Colab_A100_Studio.ipynb`](../training/RNV1_Colab_A100_Studio.ipynb) は **A100 High-RAM GPU** メタデータ設定済みです。

1. Colab でノートブックを開く
2. **「ランタイム」→「すべて実行」(Ctrl+F9 / ⌘+F9)** を押すだけ
3. 自動で以下を完遂します：
   - A100（BF16 + TF32 + Fused AdamW）の最適化と `Result` リポジトリ取得
   - Python ↔ JS 間の物理マップ（全80障害物）およびニューラル推論の数値一致検証
   - 最大 **2,048 並列アリーナ（12,288 NPC 同時稼働）** での 3 段階カリキュラム + PFSP 自己対戦強化学習
   - 学習曲線ダッシュボード（`training_dashboard.png`）生成
   - 実機 JS エンジン（`dist/js/match.js`）上での `RNV1` vs `NV1` / `NV1.3 Pro` / `NV2` / `NV2.1 SPY` / `NV2.5` / `NV2.6 Force` 直接ベンチマーク
   - ブラウザ用 Int8 量子化済み重みファイル **`rnv1-weights.json`**（約 385 KB）の自動ダウンロード

### プリセット目安（A100 GPU）
| プリセット | 学習ステップ数 | 目安時間 (A100) | 用途 |
|---|---:|---:|---|
| `a100_quick_test` | 15,000,000 | 約 3 分 | 動作確認・短時間テスト |
| `a100_pro_fast`（既定） | 100,000,000 | 約 15 分 | 高速・強力 RNV1（おすすめ） |
| `a100_pro_max` | 250,000,000 | 約 35 分 | 頂点リーグ最強 RNV1 |

---

## 2. アーキテクチャ設計

### 2.1 100% GPU 常駐ベクトル化物理スタジオ（`training/rnv1_studio/`）
- **`harbor_map.py`**: `dist/js/yard.js` と **誤差 0.0000 m** で完全一致する全 80 障害物（コンテナ40、プロップ18、タンカー3、クレーン脚8、ボラード11）、6 BAIZER、3 タンカー、12 チームスポーン、2m 空間ハッシュ（1セル最大5障害物）、O(1) 静的 Lidar LUT。
- **`env_gpu.py` (`HarborStudioGPU`)**: 20Hz 推論 / 60Hz 物理サブステップ、全7種 NPC 武器、BallisticCore-X 木箱貫通・鋼鉄跳弾、QuantumTick 移動カプセル判定、BAIZER 100 積層、煙幕 LOS 遮断、シャッファー/回復スキルを完全 GPU テンソル化。

### 2.2 100% フェアプレイ 144 次元観測 & ハイブリッド行動空間
- **ウォールハック完全禁止**: 遮蔽裏の敵・煙幕裏の敵・シャッファー透明化中の敵は一切観測に入りません。
- **観測 (144 dims)**: 自己運動・姿勢・HP/シールド/BAIZER・武器仕様 (35) + 全方位/低遮蔽/材質 Lidar (24) + 視認中の敵 Top-3 (42) + 記憶/音響/味方ラジオ Top-2 (18) + 味方 Top-2・BAIZER・タンカー・飛来弾回避・スコア差 (25)。
- **行動**: 連続移動/残差エイム/リーン (5) + ターゲット注視ポインタ (6) + 射撃/ダッシュ/しゃがみ/ジャンプ/リロード (5) + 煙幕/スキル (3)。

### 2.3 モデル構造（CTDE MAPPO + Recurrent GRU）
- **Actor（ブラウザへエクスポート）**: `Linear(144→192) + LN + SiLU` → `ResBlock(192)` → `GRUCell(192)` → 4 ポリシーヘッド（291,667 パラメータ、Int8 量子化で約 385 KB）。
- **Centralized Critic + 補助タスクヘッド（学習時のみ）**: 特権グローバル状態 64 次元を入力とする非対称 Critic と戦術補助予測により、分隊クロスファイアや裏取り学習を高速化。
- **数値一致保証**: `python3 -m training.rnv1_studio.test_parity` により、PyTorch とブラウザ JS (`dist/js/rnv1.js`) 間で FP32 最大誤差 `< 1e-5`（実測 `1.79e-7`）を保証。

---

## 3. ゲームへの反映方法
- **方法A（最速・ブラウザ1クリック）**: ゲームを開き **対戦設定 → 実験場 → `重み読込 (.json)`** から `rnv1-weights.json` を読み込む（`localStorage` に自動保存され、通常戦RNV1も自動ONになります）。
- **方法B（リポジトリへ永久組込）**: `rnv1-weights.json` を `dist/assets/rnv1-weights.json` として配置すると、ゲーム起動時に自動ロードされます。
