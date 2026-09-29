// 画面の文言はすべてここに集める（v1 は日本語のみ）。
// ソースコードに文言を直書きしない。

export const ja = {
  app: {
    title: 'Pistol Kamae',
    subtitle: 'AP 射撃姿勢解析',
    stageNote: '段階①：動画読込・姿勢推定・骨格重ね描き・静止ノイズ測定（検証用画面）',
  },
  tabs: {
    load: '動画読込',
    noise: 'ノイズ測定',
  },
  load: {
    pickVideo: '動画ファイルを選ぶ',
    trimHint:
      '動画は事前に短くトリミングすることを推奨します（全長に姿勢推定をかけるため、長いほど時間がかかります）。',
    formatHint:
      '読める形式：MP4（H.264）、MOV（H.264）、WebM。iPhone の HEVC 形式は Windows の Chrome などで再生できないことがあります。',
    formatHintIphone: 'iPhone は「設定 → カメラ → フォーマット → 互換性優先」で撮影してください。',
    unsupported:
      'この動画はこのブラウザで再生できません。iPhone なら「設定 → カメラ → フォーマット → 互換性優先」で撮り直すか、別のブラウザで開いてください。',
    videoInfo: (w: number, h: number, sec: number, fps: number | null) =>
      `${w}×${h}、${sec.toFixed(1)} 秒${fps ? `、推定 ${fps.toFixed(0)} fps` : ''}`,
    backend: '姿勢推定モデル',
    handedness: '利き手',
    right: '右',
    left: '左',
    run: '姿勢推定を実行',
    cancel: '中断',
    progress: (done: number, total: number) => `処理中… ${done} / 約 ${total} フレーム`,
    preparing: 'モデルを読み込んでいます…',
    cancelled: '中断しました',
    error: (msg: string) => `エラー：${msg}`,
    gpuFallback: 'GPU が使えなかったため CPU で実行しました',
    done: (frames: number, sec: number) => `完了：${frames} フレームを ${sec.toFixed(1)} 秒で処理`,
  },
  backends: {
    mediapipeLiteVideo: 'MediaPipe lite（動画モード）',
    mediapipeFullVideo: 'MediaPipe full（動画モード）',
    mediapipeHeavyVideo: 'MediaPipe heavy（動画モード）',
    mediapipeLiteImage: 'MediaPipe lite（画像モード・平滑化なし）',
    mediapipeFullImage: 'MediaPipe full（画像モード・平滑化なし）',
    mediapipeHeavyImage: 'MediaPipe heavy（画像モード・平滑化なし）',
    movenetThunder: 'MoveNet Thunder（平滑化なし）',
  },
  player: {
    play: '再生',
    pause: '一時停止',
    prevFrame: '◀ 1 コマ',
    nextFrame: '1 コマ ▶',
    frameLabel: (index: number, total: number, sec: number) =>
      `${index + 1} / ${total} フレーム（${sec.toFixed(3)} 秒）`,
    noPerson: '人物を検出できませんでした',
    legend: '緑：見えている点、灰：visibility が閾値未満（計測から除外）',
  },
  noise: {
    title: '静止ノイズ測定',
    intro:
      '三脚固定・射手が静止した動画（10 秒以上を推奨）を「動画読込」で処理してから、ここで各項目のばらつき（標準偏差）を確認します。',
    noResult: 'まだ処理済みの動画がありません。「動画読込」で姿勢推定を実行してください。',
    passLine: '合格ライン：肩線の傾き (a) と体軸の傾き (c) の SD が 1° 以内',
    speedTitle: '処理速度',
    speed: (frames: number, totalSec: number, fps: number, inferMs: number, seekMs: number) =>
      `${frames} フレームを ${totalSec.toFixed(1)} 秒で処理（${fps.toFixed(1)} フレーム/秒）。推定 ${inferMs.toFixed(0)} ms/フレーム、フレーム取り出し ${seekMs.toFixed(0)} ms/フレーム`,
    rangeStart: '区間の開始（秒）',
    rangeEnd: '区間の終了（秒）',
    rangeDevNote: '※ 開発サーバ限定の検証用。空欄なら全フレーム',
    rangeLabel: (start: number, end: number) =>
      `集計区間：${start.toFixed(1)} 〜 ${Number.isFinite(end) ? end.toFixed(1) : '末尾'} 秒`,
    detected: (detected: number, total: number) =>
      `人物を検出できたフレーム：${detected} / ${total}`,
    columns: {
      metric: '項目',
      unit: '単位',
      count: '有効数',
      mean: '平均',
      sd: 'SD',
      range: '最小〜最大',
    },
    copy: '結果をテキストでコピー',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした。下のテキストを選択してコピーしてください。',
    na: '—',
  },
  metrics: {
    shoulderTilt: '(a) 肩線の傾き（水平基準）',
    hipTilt: '(b) 腰線の傾き（水平基準）',
    trunkTilt: '(c) 体軸の傾き（鉛直基準）',
    neckTilt: '(d) 首の傾き（鉛直基準）',
    armElevation: '(f) 腕の挙上角（水平基準）',
    armShoulderAngle: '(g) 腕と肩線のなす角（身体基準）',
    hipLateralOffset: '(h) 腰中心の横ずれ（体幹長比）',
    stanceWidth: '(i) スタンス幅（体幹長比）',
    wristFaceDistance: '(j) 手首と顔の水平距離（体幹長比）',
  },
  units: {
    deg: '°',
    ratio: '比',
  },
} as const;
