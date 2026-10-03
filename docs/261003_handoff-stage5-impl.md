# 引き継ぎ：段階⑤の実装（2026-10-03 作成）

次のセッションの Claude と、開発者（つよし）のための引き継ぎ。
まず `CLAUDE.md` と `docs/260928_pistol-kamae-requirements.md` を読み、そのうえでこの文書を読むこと。
段階⑤の内容を決めるまでの経緯は `docs/261003_handoff-stage5.md`（着手前の状態）にある。**現在の状態はこの文書が正**。

---

## 1. 段階⑤で決めたこと（2026-10-03、開発者が承認）

- 角度の時系列グラフは初期バージョンでは作らない（要件 14 章の将来候補に記録）
- 入口は「動画の保存」「ライブラリ」の 2 つ。比較はライブラリで 2 件を選んで入る
- 動画の保存：開く → 切り抜く → 撃発ポイント（必須） → タイトル・メモ。任意マークの画面は廃止（保存形式には残す）。点数は画面から外す
- 切り抜きは「範囲の記録」方式（ファイルは丸ごと保存、推定は全長。範囲はあとから直せる）
- 撃発ポイントは音のグラフで見つけやすくし、音の最大に自動で当たりを付ける
- 比較は 1 本のバー（0 ＝ 撃発）。範囲は撃発の前後それぞれ 2 本の短い方。速さ 1 倍・1/2・1/4、繰り返しは共通区間の全体
- 「動画を再生」画面：止めているときだけ角度表
- 画面の文言とモックアップ：`docs/261003_mockup-stage5.html`（改訂 2 を承認）。入口のタブは青を使わない（青は「次に押すボタン」専用）

## 2. 作ったもの

| 部品 | 場所 |
|---|---|
| 保存形式の版 3（切り抜きの範囲 `clip`、`meta.title`）、範囲の検査、共通区間の計算、タイトル・メモの整形 | `packages/engine/src/record/clip.ts`、`title.ts`、`types.ts`、`validate.ts`（版 1・2 → 3 の移し替え） |
| Dexie 版 4（記録に `title`・`clipSec`、中身に `clip`） | `apps/web/src/db/schema.ts`、`library.ts`（`updateRecordClip` を追加、`RecordFields` から点数を外す） |
| 音声の取り出し（MP4/MOV → AAC/ADTS）と音の大きさのグラフ | `apps/web/src/audio/mp4audio.ts`（単体テスト付き。ffmpeg の出力とバイト一致）、`envelope.ts`、`useAudioEnvelope.ts` |
| 1 本または 2 本の再生（区間・速さ・繰り返し・ずれ補正） | `apps/web/src/video/usePlayback.ts` |
| バー（音のグラフ・印・切り抜きの取っ手） | `apps/web/src/components/WaveBar.tsx` |
| 1 本のプレイヤー | `apps/web/src/components/SinglePlayer.tsx`（CompareStage を 1 枚で使う）、`TransportControls.tsx` |
| 動画の保存の流れ | `apps/web/src/screens/SaveScreen.tsx`（`LoadScreen.tsx` は「開く」の段階として残る）、`components/StepBar.tsx` |
| ライブラリ | `LibraryScreen.tsx`（2 件の選択）、`RecordDetail.tsx`、`RecordPlayer.tsx`（動画を再生／撃発ポイントの修正／切り抜き範囲の修正） |
| 比較 | `CompareScreen.tsx`、`CompareView.tsx` |
| 入口 | `App.tsx`（2 タブ。`?noise=1` でノイズ測定） |

## 3. 確認結果（2026-10-03）

| 確認 | 結果 |
|---|---|
| 単体テスト `npm test` | 183 件合格（切り抜き・タイトル・移し替え・音声の取り出しを追加） |
| `savetest.mjs`（保存の流れ、詳細、動画を再生、修正） | WebKit・Chrome とも 42 / 42 合格。動画の絵が黒くなく時点で変わることも確認 |
| `librarytest.mjs`（射手、未保存の印、一覧、編集、削除、版 1 の移し替え） | 両ブラウザとも 29 / 29 合格 |
| `comparetest.mjs`（2 件の選択、1 本のバー、再生・速さ・繰り返し、修正の入口） | 両ブラウザとも 26 / 26 合格 |
| 音の最大の自動の当たり | テスト動画 shot.mp4（friend-good-1 の撃発付近 5 秒）で 2.47 秒。ffmpeg で測った音の最大 2.5 秒と一致 |
| Safari の音声取り出し | 本物の Safari で、MOV のままは不可、ADTS なら可（Chrome も可）を確認したうえで実装 |
| 別エージェントのコードレビュー | 高 3・中 6・低 8 の指摘。高と中はすべて直し、低は文言キーの整理・取っ手のキー操作・時点の丸めを反映（下の 4 章） |
| iPhone（Safari） | **未確認。開発者に頼む（最後の 1 回）** |

## 4. 実装の要点（はまった点）

- **Safari（WebKit）の `decodeAudioData` は MOV の入れ物を読めない**（null で失敗）。入れ物を自前で読んで AAC のサンプルを取り出し、7 バイトの ADTS ヘッダを付けると読める。iPhone の MOV は `moov` が末尾にあるので、箱を順に辿る
- 音声の時刻のずれ（編集リスト `elst`）は `offsetSec` で持つ。実測では 0.5 秒未満
- 再生の同期は「②比較を主、①基準を合わせる」。1 コマ以上ずれたら `currentTime` を直す。区間の終わりは 0.02 秒手前で判定し、繰り返しでは `seeked` が来るまで終端の判定を止める（戻した直後に再び終端と判定しないため）
- React 19 系の lint（`react-hooks/set-state-in-effect`、`refs`）に合わせ、effect の中で setState しない書き方にした：ファイルの URL は `useImageUrl` と同じ「microtask で set、key で照合」、新しい動画の受け入れは「前回の props を state に覚える」、音の最大への配置は派生値（`shownSec`）
- **撃発ポイントが切り抜きの範囲の外に出ると、その記録は開けなくなる**（`checkClip` が `shotOutsideClip` を返す）。対策は 3 重：範囲の端はコマの時刻に吸着させ動画の中に収める（`snapToFrame`、`setClipSnapped`）、表示するコマは範囲の中から選ぶ（`nearestFrameInRange`）、書き込み前に `assertConsistent` で検査する。それでも開けない記録には削除ボタンを出す
- 音の包絡線は `recordAudio` 表（Dexie 版 5）に保存し、記録ごとに 1 回だけ計算する（動画全体と音声の波形をメモリに載せるため）。動画を付け直すと捨てる
- `usePlayback` の `pause()` は、実際に再生していたときだけ時点を知らせる（止まっているときに呼ぶと、コマ中央の時刻で時点を上書きしてしまうため）。区間の終わりの判定は 1 コマ分。どれか 1 本が末尾に達したら繰り返す。区間が 1 コマ未満なら再生しない
- 別のタブへ移ると再生を止める（`SinglePlayer` の `active`）
- 内蔵ブラウザ（Claude の Browser pane）は非表示扱いで画面の更新が止まるため、見た目の確認は Playwright の撮影（`apps/web/e2e/results/*.png`）で行う
- `apps/web/public/_test/` は gitignore されていない（過去のメモと違う）。テスト動画は `/@fs/…/apps/web/e2e/videos/…` で開発サーバから読める

## 5. 未了・次にやること

1. **開発者の iPhone 確認**（手順は別途渡す）
2. 保存の流れでは、動画ファイルを包絡線用と保存用で 2 回読む（`file.arrayBuffer()`）。大きい動画で気になれば 1 回にまとめる
3. 動画本体のない記録（段階③以前）は、再生・修正ができず、角度表も見られない（比較の差分表だけ）。動画を付け直せば使える
4. 自動の当たりの合格ライン（実際の撃発から 3 コマ以内）を、ユーザー候補の動画 6 本で確かめる（`friendstest.mjs` に足すか、別のテストを作る）
5. 速さ 1/4 が iPhone Safari で効くか、音の最大が実際の発射のコマと合うか（AAC の先読み分 約 44 ms の扱いで 1 コマ前後ずれる可能性。実機で確認）
6. 比較画面の修正から戻ると、並べ方・濃さ・時点が初期化される（許容している）
7. 将来候補：角度の時系列グラフ、再エンコードによる容量削減、共通区間の中でさらに始点・終点を選ぶ繰り返し、音のない動画への「手首の動き」からの当たり
