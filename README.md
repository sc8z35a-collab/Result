# Result

添付テクスチャを使用した、50 × 200 m の貨物埠頭を舞台にするブラウザ用3D対戦ゲームです。ゲーム本体は `dist/` にあり、ビルドせずに起動できます。

## ローカル起動

リポジトリ直下で次のコマンドを実行し、ブラウザで http://localhost:8000 を開いてください。

```sh
python -m http.server 8000 --directory dist
```

## 開発用ツール

`tools/` に素材の生成、港の3Dシーンの書き出し、Blenderでのタイトル背景のレンダリング、ゲームと描画の検証に使ったコードがあります。配布用のテクスチャと背景画像は `dist/assets/` に、元のPNGテクスチャアトラス15枚は `upload/` に収録しています。

ゲームロジックと熱映像の検証は、リポジトリ直下で次を実行します。

```sh
npm install --prefix tools
node tools/verify.mjs
```

ブラウザでの購入・保存の検証には、リポジトリ直下を `python -m http.server 8000` で配信し、http://localhost:8000/tools/verify-browser.html を開きます。テストは専用の一時データベースを使用します。

## 回帰テスト

Node.js 24 を使用して、`npm install --prefix tools` の後に `npm test --prefix tools` を実行します。Linux で OpenGL ES 3 の環境があれば、`python tools/test_gpu.py` でシェーダーも検証できます。

[重大度順の不具合修正一覧](docs/BUGFIX_AUDIT.md)

[追加20件の重大度順の修正一覧](docs/CRITICAL_BUGFIX_AUDIT.md)

## RNV1 高速強化学習スタジオ (Google Colab Pro A100)

Harbor Range の 3D 物理環境を A100 GPU 上で並列化し、NPC AI **`RNV1`** をランダム初期化から一から高速学習・強化できます。Colab を開いて **「ランタイム → すべて実行」** を押すだけで学習から `rnv1-weights.json` の自動ダウンロードまで完了します。

- ノートブック: [`training/RNV1_Colab_A100_Studio.ipynb`](training/RNV1_Colab_A100_Studio.ipynb)
- [Google Colab (A100) で RNV1 スタジオを開く](https://colab.research.google.com/github/sc8z35a-collab/Result/blob/main/training/RNV1_Colab_A100_Studio.ipynb)
- 詳細設計・導入手順: [`docs/RNV1_STUDIO.md`](docs/RNV1_STUDIO.md)

