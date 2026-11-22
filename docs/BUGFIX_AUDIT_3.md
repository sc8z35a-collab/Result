# Result 追加不具合修正 38件（第3次監査）

`main`（`f4d1c33`：NV 2.4 Manusia・DF40 II 統合後）の全モジュールを対象に再監査を実施し、重大度順（P0〜P3）に 38 件の不具合（A01〜A38）を特定・修正しました。各 ID は `tools/audit3-regressions.test.mjs` の自動回帰テストと 1 対 1 で対応します。

## P0 致命的 — 移動不能フリーズ・描画クラッシュ（3件）

| ID | 対象 | 症状 | 修正 |
| --- | --- | --- | --- |
| A01 | `dist/js/yard.js` | `floorAt()` の接地半径（0.24m）と `walkable()` / `moveActor()` の衝突半径（0.40m）の差により、コンテナ屋根や段差から `0.24 < dist < 0.40` の縁へ落下すると障害物内部へめり込み、以降の 360Hz 移動が X/Z 両軸で拒否されて永続的に動けなくなる | `penetrationDepth()` と `depenetrate()` を実装し、めり込み状態では最大 3 パスで障害物外へ単調に押し出し、さらにめり込み量を厳密に減らす軸移動を許可（通常歩行時の仕様は維持） |
| A02 | `dist/js/renderer.js` `dist/js/software.js` `dist/js/shadowflame.js` | NPC メッシュ配列が `npcWeapons` のみ事前生成されるため、`RD40`・`DF40 II`・`DF1 OUT` 等を装備した NPC（例：`benchGuns` 指定）を描画・影生成すると `undefined` 参照で `TypeError` クラッシュする | `Renderer` と `SoftwareRenderer` に遅延生成・キャッシュ付きの `actorMesh(a, lite)` を実装し、`ShadowFlame.drawActorsShadow()` にも `SW T` フォールバックを追加 |
| A03 | `dist/js/software.js` `dist/js/app.js` | `SoftwareRenderer` がコンストラクタで `this.tone` を初期化せず、再生成時に `#software-surface` を重複生成する。また `app.js` の `recoverRenderer()` に再入防止がなく、`setGraphics()` / `resize` が既にソフトウェア描画中のエラーでも復旧処理を再起動する | `SoftwareRenderer` で `this.tone` を初期値設定し既存 `#software-surface` を再利用・`render()` 前にバッファ未確保を保護。`app.js` に `recovering` ガードを追加し、`!renderer.native` 時の例外は `rendererError()` へ送るよう修正 |

## P1 重大 — 物理・公平性（ウォールハック遮断）・AI コア・セーブ・音響（17件）

| ID | 対象 | 症状 | 修正 |
| --- | --- | --- | --- |
| A04 | `dist/js/thermoflux.js` | コンストラクタで `teamTag` と `stampTime` が TypedArray 初期値 0 のまま（Team 0 / 時刻 0s）になり、試合開始 11.5 秒間はタンカーや着弾の中立熱源が Team 0 の足跡として Team 1 AI / スパイに誤追跡される | コンストラクタで `teamTag.fill(-1)`・`stampTime.fill(-100)` を適用 |
| A05 | `dist/js/aerovortex.js` | `injectSmoke()` / `injectBurst()` / `deploySmokeVent()` / `injectProjectileWake()` が `stats.totalSmoke` を更新せず、次の 24Hz 流体ステップ（最大 42ms / 15 tick）まで `clearOpticalPath()` や煙幕描画に反映されない | 各注入・切裂メソッドで `stats.totalSmoke` を即時差分更新 |
| A06 | `dist/js/ballistics.js` | 接地木箱を上方から貫通射撃すると底面（`y = 0`）を突き抜けて `exitPos.y < 0` となり、コンクリート埠頭床の地下へ弾丸が貫通射出される | `exitPos[1] <= 0.01` かつ埠頭デッキ範囲内の場合は `{action: 'stop'}` で貫通を停止 |
| A07 | `dist/js/nv24-manusia.js` `dist/js/nv23-human.js` | Meyer 第 2 相の補正サブムーブ（`motorPhase === 'SUBMOVE'`）で計算した `a.yaw` / `a.pitch` が、直後の `super.step()` 内 OFC 追従分岐で毎フレーム上書きされていた | `HumanOFC_AimV23.step()` に `SUBMOVE` 専用分岐を追加し、知覚整合やリコイル更新を維持しつつ Meyer 補正角を保持 |
| A08 | `dist/js/nv2.js` `dist/js/nv23-human.js` | 背後・煙幕越し・壁貫通・跳弾で視認不能なまま撃破された際も、`MAN_DOWN` 通話と `mind.traumaAngles` に攻撃者の正確な座標（`killer.x, killer.z`）が漏洩する | 撃破時の視認・視線判定を行い、未視認時は `MAN_DOWN` に味方ダウン地点（`enemyId: -1`）を、`onDeath()` の `traumaAngles` には被弾ベクトル `-hitDir` 方向のみを記録 |
| A09 | `dist/js/nv2.js` `dist/js/match.js` | `nv2.onHit()` が `shieldFlash > 0.9` 等からシールド破壊を推測するため、同時多弾武器（`RD40`・`DF40 II`・`RD30`）で 2〜3 発目が二重発火し、またシールド 0・HP100 への初弾でも誤判定する | `match.damage()` の確定値 `shieldBreak` を `nv.onHit(..., shieldBreak)` へ直接渡して判定 |
| A10 | `dist/js/df-hud.js` | 新規報酬の保存中にユーザーが `#retryCredits` を押すと `if (this.savingAwards) return` で手動再試行が握りつぶされる | `retryAllAwards` / `rescanAwards` キューを導入し、保存完了まで連続ループで全保留・再試行を処理 |
| A11 | `dist/js/wallet.js` | `readBackup()` が `awardPrefix` の空・不正レシートを検証せず取り込む。また IndexedDB 切断後の `read()` が再接続を試みず、購入時の `InvalidStateError` 後も壊れた `db` ハンドルを保持し続ける | `validReceipt()` 検証を追加し、`ensureConnected()` を `read()`（起動後）と購入時 `InvalidStateError` 復旧で共通利用 |
| A12 | `dist/js/sound-engin2.js` | 閉じた `AudioContext` を再生成すると `currentTime` が 0 に戻る一方、`lastWhizAt` など 8 個のレート制限時刻と `lastFootstepAt` が旧時刻を保持し、追いつくまで効果音が無音になる | 新規 `AudioContext` 生成時に全 8 個の `last*At` を `-Infinity` へ、`lastFootstepAt` をクリア |
| A13 | `dist/js/sound-engin2.js` | 煙幕展開音と NPC 姿勢変更フォーリーが `computeMultiBandAcousticPath()` を使わず固定音量・遅延ゼロで再生され、150m 遠方の NPC 煙幕が至近距離音量で鳴る | 煙幕（最大 62m）と NPC 姿勢フォーリー（最大 14m）に多帯域距離減衰・遮蔽 LPF・音速遅延（`d / 343`）を適用 |
| A14 | `dist/js/nv2.js` | リロード音響到着時、チーム共有の重複排除 `if (pr.lastReloadCue === rep.emittedAt) return` が個別 `b.tom.onObservedEnemyReload()` より先に走り、2 人目以降の味方 AI の残弾推測がリセットされない | `b?.tom?.onObservedEnemyReload(source.id, t)` をチーム重複排除より前に実行 |
| A15 | `dist/js/nv2.js` `dist/js/nv24-manusia.js` `dist/js/echopulse.js` | 視覚 `perceive()`（発砲フラッシュ中 2 tick 連続）と音響 `onEchoArrival()` が同一発砲を 2〜3 重カウントし、さらにリロード後に `countedRead` がリセットされない | `shotCount` を `shotSeq` として音響報告へ伝搬し `(enemyId, shotSeq)` で重複排除。斉射段数を実射仕様に統一し、リロード時に `countedRead` と `lastShotSeq` を初期化 |
| A16 | `dist/js/synapse.js` | `tankerAffinity` と `reloadGreed` が増加一方で永続保存されるため、通算 2 回のタンカー取得で永久に `TANKER_HUNTER` に固定される。また `matchesLearned` の破損値検証が不足 | 通常観測 `observe()` で緩やかな減衰（`0.986` / `0.990`）を導入してプレイスタイル変化へ追従させ、`matchesLearned` を有限非負整数に正規化 |
| A17 | `dist/js/nv21-spy.js` | `computeSpyDodge()` の `walkable()` 呼び出しが標高 `a.y` を省略しておりコンテナ屋根上で全方向失敗する。さらに全方向不通過でも `found` 判定なしで壁方向へ回避を確定してしまう | `walkable(..., .41, a.y)` へ修正し、有効な回避方向がない場合は `return` で中断 |
| A18 | `dist/js/spectrafield.js` | 屋根上の高所観測者から `collapseSightCone()` が水平レイを飛ばすため、2.62m コンテナを越えて背後に隠れた地上セルの敵存在確率を誤消去してしまう | `eye[1] > 2.0` の高所観測時は各地上セル `[wx, 1.15, wz]` への直接視線遮蔽を確認してから確率収縮を実行 |
| A19 | `dist/js/schlieren.js` | 新しい `Match` で `seq` が 0 に戻る際、`SchlierenOptics.step()` 単体では `seenEffects` が引き継がれて第 2 試合以降の衝撃波が欠落する。また `DF40 II` の超音速マズル衝撃波が抜けていた | `step(match, dt)` で `match` 切替を検出して自動クリアし、`DF40 II` のマズル衝撃波を追加 |
| A20 | `dist/js/nv2.js` `dist/js/match.js` | 遠距離発砲後に敵が撃破された場合、遅れて到着した死前の音響エコーが Cowan ワーキングメモリや `SpectraField` に死亡済み敵のゴースト位置を再登録する | `nv2.onEchoArrival()` および `match.step()` の `SpectraField` 観測で音源アクターの生存・`spawnId` 一致を検証 |

## P2 中程度 — 武器・光学・描画・AI 調整・UI/HUD（14件）

| ID | 対象 | 症状 | 修正 |
| --- | --- | --- | --- |
| A21 | `dist/js/shaders.js` `dist/js/renderer.js` | 一人称ビューモデルの反動・ロック演出で不連続な `step()` マスクがポリゴンを裂き、さらに単砲身武器にも複砲身用左右非対称サーボ反動がかかっていた | `renderer.js` から `uAnim2.x` に複砲身フラグを渡し、`shaders.js` のマスクをすべて `smoothstep()` に変更して複砲身のみに限定 |
| A22 | `dist/js/df40ii.js` | AA1.4 解除・オーバーヒート時に `d.d01Max` が 5.5s→4.5s へ縮んでも `d.d01Timer` がクランプされず、壁裏追従時間と HUD バー比率が上限を超過する | `toggleAA14()`・`triggerAA14Overheat()`・`updateDF40II()` で `d.d01Timer` を `d.d01Max` 以下へクランプ |
| A23 | `dist/js/df40ii.js` `dist/js/rd40.js` | ロック角判定は `cos(pitch)` 補正付きなのに磁気追従判定が未補正 `hypot(dyaw, dpitch)` を比較するため、高所から真下を狙う急仰俯角でロック中の追従が停止する。また `rd40.js` の追従ブロックに `spawnId` 確認が欠落 | 両ファイルで `sep = Math.hypot(dyaw * Math.cos(a.pitch), dpitch) < spec.lockHold` を使用し、`rd40.js` に `e.spawnId === d.focusSpawnId` チェックを追加 |
| A24 | `dist/js/nv24-manusia.js` | `getFlowFactor()` が未定義プロパティ `this.persona.clutchPoise` を参照し、14 次元パーソナリティの `clutchComposure` が常に既定値 0.75 に上書きされていた | `this.persona.clutchComposure ?? 0.75` へ修正 |
| A25 | `dist/js/nv24-manusia.js` | `ManusiaPerceptionV24.evaluateSighting()` が視認候補の人数分だけ `tunnelFocus` を増減させ、複数敵視認時にトンネル集中が 2〜3 倍速で変動する | `_tunnelUpdatedAt` で同一タイムスタンプ `t` あたり 1 回のみ更新するよう修正 |
| A26 | `dist/js/match.js` `dist/js/echopulse.js` `dist/style.css` | 煙幕展開が `kind: 'tanker'` として音響放出され、コンパスに偽の補給タンカー警告が表示されたり FermatCore 音響情報へ煙幕座標が混入していた | `kind: 'smoke'` を新設し、専用レンジ・減衰・`.ep-smoke` コンパス表示を実装。FermatCore の敵音響位置登録から煙幕を除外 |
| A27 | `dist/js/echopulse.js` | NPC 音響キューで `actor` が null のリロードイベント時に `actor.reload` で例外が発生し、また `gun` プロパティが欠落していた | `actor?.reload` で null 安全化し、`gun`・`shotSeq` を NPC キューへ引き継ぎ |
| A28 | `dist/js/optic.js` | EVR1 熱光学の地上熱跡サンプリングが `py = H * 0.35` から始まるため俯瞰時に画面上部 35% が欠落し、さらに西側海上の座標が埠頭端セルへクランプされて海面に偽の熱源が描かれる | 走査開始を `py = 0`（水平線以上は `ry >= -0.025` で即時除外）に変更し、埠頭デッキ範囲外 `[-25, 25] × [-100, 100]` をスキップ |
| A29 | `dist/js/chronotrace.js` `dist/js/match.js` | 壁貫通出口ポータルが `exitNormal` ではなく入口法線の反転 `-normal` を使うため、角や上面から別面へ抜ける貫通でリングが斜めに傾く | `recordPenetration()` に `exitNormal` を保存し、`match.js` から `ball.exitNormal` を渡して出口リングを正しく配向 |
| A30 | `dist/js/app.js` `dist/js/sound-engin2.js` | 跳弾命中時に HUD 被弾アークと被弾ステレオパンが着弾方向 `-e.dir` ではなく遮蔽物裏の射撃者 `e.actor` 方向を直接示していた | `e.ricochet && e.dir` 時は `-e.dir` から被弾アーク角とステレオパンを算出 |
| A31 | `dist/js/match.js` `dist/js/app.js` | 撃破後の待機 3 秒間に ADS・ロック・D01・AA1.4 状態が残留し、リスポーン時にタッチ射撃ポインタと `.is-active` が解除されない。また `hud()` が `a.df?.ads` を無視してレティクルを一瞬再表示する | 撃破時に各武器ロック/ADS/AA1.4 状態を即時クリアし、リスポーン時のポインタ・ボタン状態初期化と `hud()` の `|| !!a.df?.ads` 条件を追加 |
| A32 | `dist/js/nv13pro.js` `dist/js/nv23-human.js` | `WEAPON_BAND['DF40 II'].cap` が斉射数（87）ではなく総弾数（260）になっており、`WEAPON_RECOIL_PROFILE` に `DF40 II` の定義が欠落していた | `cap: 87` に修正し、`WEAPON_RECOIL_PROFILE['DF40 II']`（`arvWait: true`）を追加 |
| A33 | `dist/js/nv2.js` | NPC の 1.4m 分離反発ループが壁越しの敵にも働き、薄い遮蔽越しに敵の存在へ反応してしまう | 敵チームとの分離反発前に `obstruction(eyeOf(a), eyeOf(mate)) <= 1` を確認して遮蔽越し反発を排除 |
| A34 | `dist/js/fermat.js` | `refreshTeamVisualIntel()` の D01 壁裏ロック共有判定が `focusSpawnId === e.spawnId` を検証していなかった | `RD40`・`DF40 II` 双方の D01 判定に `focusSpawnId === e.spawnId` を追加 |

## P3 軽微 — UI 重なり・残像・演出の仕上げ（4件）

| ID | 対象 | 症状 | 修正 |
| --- | --- | --- | --- |
| A35 | `dist/style.css` | FLIR と ChronoTrace を同時有効化すると `#flirFrame span` と `#chronoBanner` が同じ上端座標で重なり判読不能になる | `#app[data-flir-active="true"] #chronoBanner` でデスクトップ（`+76px`）・タッチ（`+54px`）双方に自動オフセットを追加 |
| A36 | `dist/js/shadowflame.js` | Shadow Flame Pro で試合終了後にタイトル画面へ戻った際、カメラの `snap.key` が一致すると近距離影カスケードが再描画されず NPC の影が残る | `lastHadMatch` を追跡し、試合→タイトル遷移時は必ず近距離カスケードを再生成 |
| A37 | `dist/js/sound-engin2.js` | しゃがみ中や ADS 中に撃破されて立位・腰撃ちでリスポーンすると、死前の姿勢差分で架空の立ち上がり・ADS 解除音が鳴る | リスポーン遷移時に `prevCrouch`・`prevAds`・`prevLean` をスポーン後の実姿勢へ同期 |
| A38 | `dist/js/models.js` | 軽量モード（`detail === 'lite'`）のキャラクターモデルが `RD40`（複砲身）と `DF40 II`（3 連砲身）の専用形状を持たず単砲身へフォールバックしていた | 軽量 LOD に `RD40` 複砲身・`DF40 II` 3 連砲身の専用シルエットと配色を追加 |

## 検証結果

- `npm test --prefix tools`: 既存 119 件 + 新規 38 件（`tools/audit3-regressions.test.mjs`）= **全 157 件 PASS**
- `node tools/verify.mjs`: 360Hz シミュレーション、全 9 武器（`DF40 II` ARV1.3 / AA1.3 / AA1.4 含む）、Sound Engin 2.0、NV 2.4 Manusia 対 Classic 3v3 ベンチマーク（4勝0敗・22-6・0.305ms/tick）、全物理・光学エンジン **PASS**
- `python3 tools/test_gpu.py`: Mesa OpenGL ES 3.2 上で全 11 組の GLSL シェーダープログラムのコンパイル・リンク **PASS**
