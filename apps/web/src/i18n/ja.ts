// 画面の文言はすべてここに集める（v1 は日本語のみ）。
// ソースコードに文言を直書きしない。

export const ja = {
  app: {
    title: 'Pistol Kamae',
    subtitle: 'AP 射撃姿勢解析',
    stageNote: '開発中の検証用画面（段階②を確認中）',
  },
  devErrors: {
    title: '開発サーバ限定：画面内エラー表示',
    clear: '消す',
  },
  tabs: {
    load: '画面 1：動画を読み込む',
    mark: '画面 2：マークを付ける',
    noise: '画面 3：ノイズ測定の結果',
  },
  load: {
    pickVideo: '手順 1：下のボタンを押して動画を選ぶ',
    loadingVideo: '動画を読み込んでいます…（フレームレートの推定に数秒かかります）',
    trimHint:
      '動画は事前に短くトリミングすることを推奨します（全長に姿勢推定をかけるため、長いほど時間がかかります）。',
    formatHint:
      '読める形式：MP4（H.264）、MOV（H.264）、WebM。iPhone の HEVC 形式は Windows の Chrome などで再生できないことがあります。',
    formatHintIphone: 'iPhone は「設定 → カメラ → フォーマット → 互換性優先」で撮影してください。',
    unsupported:
      'この動画はこのブラウザで再生できません。iPhone なら「設定 → カメラ → フォーマット → 互換性優先」で撮り直すか、別のブラウザで開いてください。',
    videoInfo: (w: number, h: number, sec: number, fps: number | null) =>
      `${w}×${h}、${sec.toFixed(1)} 秒${fps ? `、推定 ${fps.toFixed(0)} fps` : ''}`,
    handedness: '利き手',
    right: '右',
    left: '左',
    run: '手順 2：姿勢推定を実行',
    cancel: '中断',
    progress: (done: number, total: number) => `処理中… ${done} / 約 ${total} フレーム`,
    preparing: 'モデルを読み込んでいます…',
    cancelled: '中断しました',
    error: (msg: string) => `エラー：${msg}`,
    gpuFallback: 'GPU が使えなかったため CPU で実行しました',
    done: (frames: number, sec: number) => `完了：${frames} フレームを ${sec.toFixed(1)} 秒で処理`,
  },
  player: {
    play: '再生',
    pause: '一時停止',
    prevFrame: '◀ 1 コマ',
    nextFrame: '1 コマ ▶',
    slider: '表示するフレーム（つまみを動かして選ぶ）',
    frameLabel: (index: number, total: number, sec: number) =>
      `${index + 1} / ${total} フレーム（${sec.toFixed(3)} 秒）`,
    noPerson: '人物を検出できませんでした',
    legend: '緑：見えている点、灰：よく見えない点・画面の外にある点（計測から除外）',
  },
  mark: {
    title: 'マーク付け',
    intro:
      '上の動画を撃発の瞬間まで動かし、「撃発マークを付ける」を押します。撃発の瞬間の角度が下の表に出ます。',
    noResult:
      'まだ処理済みの動画がありません。「画面 1：動画を読み込む」で姿勢推定を実行してください。',
    addTitle: '表示中のフレームにマークを付ける',
    setShot: '撃発マークを付ける',
    resetShot: '撃発マークをここに付け直す',
    customLabel: '任意マークの名前',
    customPlaceholder: '例：振り上げ開始',
    addCustom: '任意マークを追加',
    customDuplicate:
      '同じ名前のマークがすでにあります。別の名前にするか、一覧から先に削除してください。',
    listTitle: 'マーク一覧（押すとそのフレームへ移動）',
    listEmpty: 'マークはまだありません。',
    shotRequired: '撃発マークがまだ付いていません（必須）。',
    shotName: '撃発',
    position: (index: number, sec: number) => `${index + 1} フレーム目（${sec.toFixed(3)} 秒）`,
    remove: '削除',
    removeAria: (name: string) => `マーク「${name}」を削除`,
    tableTitle: '撃発フレームの角度',
    tableNoShot: '撃発マークを付けると、その瞬間の角度がここに表示されます。',
    tableFrame: (index: number, sec: number) =>
      `撃発フレーム：${index + 1} フレーム目（${sec.toFixed(3)} 秒）`,
    tableNoPerson: 'このフレームでは人物を検出できなかったため、計測できません。',
    tableLegend:
      '符号：銃側へ傾く・上がる＝正（+）。「—」は関節が十分に見えない、または画面の外にあって計測できなかった項目。水平・鉛直はカメラの向きが基準（水平校正は段階④）。',
    columns: {
      metric: '項目（基準）',
      value: '値',
      unit: '単位',
    },
    na: '—',
    notSaved: '※ マークはまだ保存されません。ページを閉じる・再読込すると消えます（保存は段階③）。',
  },
  noise: {
    title: '静止ノイズ測定',
    intro:
      '三脚固定・射手が静止した動画（10 秒以上を推奨）を「画面 1：動画を読み込む」で処理してから、ここで各項目のばらつき（標準偏差）を確認します。',
    noResult:
      'まだ処理済みの動画がありません。「画面 1：動画を読み込む」で姿勢推定を実行してください。',
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
