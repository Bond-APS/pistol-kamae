// 画面の文言はすべてここに集める（v1 は日本語のみ）。
// ソースコードに文言を直書きしない。

import type { LocalDateTime } from '@pistol-kamae/engine';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const two = (n: number): string => String(n).padStart(2, '0');

/** 例：9/30（水）14:05 */
const dateTime = (d: LocalDateTime): string =>
  `${d.month}/${d.day}（${WEEKDAYS[d.weekday]}）${two(d.hour)}:${two(d.minute)}`;

const handednessName = { right: '右利き', left: '左利き' } as const;

export const ja = {
  app: {
    title: 'Pistol Kamae',
    subtitle: 'AP 射撃姿勢解析',
    stageNote: '開発中の検証用画面（段階③を確認中）',
    dbUnavailable:
      'このブラウザでは保存の機能を使えません。プライベートブラウズを切るか、別のブラウザで開いてください。',
  },
  devErrors: {
    title: '開発サーバ限定：画面内エラー表示',
    clear: '消す',
  },
  tabs: {
    load: '読込',
    mark: 'マーク',
    library: 'ライブラリ',
    noise: 'ノイズ測定',
    unsavedAria: '保存していないマークがあります',
  },
  common: {
    cancel: 'キャンセル',
    goLoad: '動画を読み込む',
  },
  handedness: handednessName,
  load: {
    pickVideo: '手順 1：下のボタンを押して動画を選ぶ',
    loadingVideo: '動画を読み込んでいます…（フレームレートの推定に数秒かかります）',
    trimHint:
      '動画は事前に短くトリミングすることを推奨します（全長に姿勢推定をかけるため、長いほど時間がかかります）。',
    formatHint:
      '読める形式：MP4（H.264）、MOV（H.264）、WebM。iPhone の HEVC 形式は Windows の Chrome などで再生できないことがあります。',
    formatHintIphone: 'iPhone は「設定 → カメラ → フォーマット → 互換性優先」で撮影してください。',
    unsupportedTitle: '！ この動画は再生できません',
    unsupported:
      'この動画はこのブラウザで再生できません。iPhone なら「設定 → カメラ → フォーマット → 互換性優先」で撮り直すか、別のブラウザで開いてください。',
    videoInfo: (w: number, h: number, sec: number, fps: number | null) =>
      `${w}×${h}、${sec.toFixed(1)} 秒${fps ? `、推定 ${fps.toFixed(0)} fps` : ''}`,
    run: '手順 2：姿勢推定を実行',
    cancel: '中断',
    progress: (done: number, total: number) => `処理中… ${done} / 約 ${total} フレーム`,
    preparing: 'モデルを読み込んでいます…',
    cancelled: '中断しました',
    errorTitle: '！ 姿勢推定でエラーが起きました',
    error: (msg: string) => `エラー：${msg}`,
    gpuFallback: 'GPU が使えなかったため CPU で実行しました',
    doneTitle: '✓ 完了',
    done: (frames: number, sec: number) => `${frames} フレームを ${sec.toFixed(1)} 秒で処理`,
    goMark: 'マーク付けへ進む',
    discardTitle: '保存していないマークがあります',
    discardBody:
      '別の動画を選ぶと、今のマークは消えます。残したいときは「マーク」タブで保存してください。',
    discardConfirm: '保存せずに進む',
  },
  shooter: {
    label: '射手',
    option: (name: string, handedness: 'right' | 'left') =>
      `${name}（${handednessName[handedness]}）`,
    chip: (name: string, handedness: 'right' | 'left') =>
      `${name}（${handedness === 'right' ? '右' : '左'}）`,
    addOption: '＋ 新しい射手を登録',
    addChip: '＋ 新しい射手',
    registerFirst: '＋ 射手を登録',
    requiredHint: '射手を登録すると、姿勢推定を実行できます。',
    edit: '編集',
    registerTitle: '射手を登録',
    editTitle: '射手を編集',
    name: '名前',
    handedness: '利き手（銃を持つ手）',
    right: '右',
    left: '左',
    handednessHint: '射手ごとに 1 回決めれば、動画のたびに選び直す必要はありません。',
    editHint: '名前や利き手を直すと、この射手の保存済みの記録すべてに反映されます。',
    register: '登録する',
    saveEdit: '変更を保存',
    saving: '保存中…',
    nameDuplicate: '！ 同じ名前の射手がすでにいます。別の名前にしてください。',
    failed: '！ 保存できませんでした。もう一度押してください。',
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
    noResult: 'まだ処理済みの動画がありません。「読込」タブで姿勢推定を実行してください。',
    setShot: '撃発マークを付ける',
    resetShot: '撃発マークをここに付け直す',
    customTitle: '任意マーク（振り上げ開始など）',
    customLabel: '表示中のフレームに付ける名前',
    customPlaceholder: '例：振り上げ開始',
    addCustom: '任意マークを追加',
    customDuplicate:
      '！ 同じ名前のマークがすでにあります。別の名前にするか、一覧から先に削除してください。',
    listTitle: 'マーク一覧（押すとそのフレームへ移動）',
    listEmpty: 'マークはまだありません。',
    shotName: '撃発',
    position: (index: number, sec: number) => `${index + 1} フレーム目（${sec.toFixed(3)} 秒）`,
    remove: '削除',
    removeAria: (name: string) => `マーク「${name}」を削除`,
    tableTitle: '撃発の瞬間の角度',
    tableNoShot: '撃発マークを付けると、その瞬間の角度がここに表示されます。',
    tableFrame: (index: number, sec: number) =>
      `撃発フレーム：${index + 1} フレーム目（${sec.toFixed(3)} 秒）`,
  },
  save: {
    save: 'ライブラリに保存',
    needShot: '撃発マークを付けると保存できます。',
    unsaved: (index: number) => `未保存（撃発：${index + 1} フレーム目）`,
    overwrite: '上書き保存',
    changed: '保存後に変更があります',
    saving: '保存中…',
    savedTitle: '✓ ライブラリに保存しました',
    nextVideo: '次の動画を読み込む',
    viewLibrary: 'ライブラリで見る',
    failedTitle: '！ 保存できませんでした',
    failedBody: '端末の空き容量を確認して、もう一度押してください。',
  },
  record: {
    formSaveTitle: 'ライブラリに保存',
    formEditTitle: '記録の内容を編集',
    score: '点数（0〜10.9、空欄でもよい）',
    scoreUnit: '点',
    scoreOutOfRange: '！ 点数は 0〜10.9 で入力してください。',
    scoreNotNumber: '！ 点数は数字で入力してください（小数は 1 桁まで。例：10.3）。',
    scoreNone: '点数なし',
    favorite: 'お気に入り',
    shotAt: '撮影日時',
    shotAtHintSave: '動画ファイルの日時です。違っていたら直してください。',
    shotAtInvalid: '！ 撮影日時を入力してください。',
    memo: 'メモ',
    submitSave: '保存する',
    submitEdit: '変更を保存',
    dateTime,
    /** 例：9/30（水）14:05・山田・10.3 点 */
    summary: (d: LocalDateTime | null, shooterName: string, score: string | null) =>
      [d ? dateTime(d) : '', shooterName, score === null ? '' : `${score} 点`]
        .filter((s) => s !== '')
        .join('・'),
  },
  library: {
    title: 'ライブラリ',
    loading: '読み込んでいます…',
    loadFailed: '！ ライブラリを読み込めませんでした。ページを開き直してください。',
    filterShooter: '射手で絞り込む',
    allShooters: (count: number) => `射手：すべて（${count}）`,
    shooterOption: (name: string, count: number) => `${name}（${count}）`,
    favoritesOnly: 'お気に入りのみ',
    count: (shown: number, total: number) =>
      shown === total ? `${total} 件` : `${total} 件中 ${shown} 件`,
    month: (year: number, month: number, count: number) => `${year}年${month}月（${count} 件）`,
    addFavorite: 'お気に入りに追加',
    removeFavorite: 'お気に入りから外す',
    empty:
      'まだ保存した記録がありません。動画を読み込み、撃発マークを付けて「ライブラリに保存」を押すと、ここに並びます。',
    noMatch: '条件に合う記録がありません。',
    clearFilter: '絞り込みを解除',
    back: '‹ ライブラリ',
    shooterLine: (name: string, handedness: 'right' | 'left') =>
      `${name}・${handednessName[handedness]}`,
    memo: (text: string) => `メモ：${text}`,
    fitPerson: '人物に寄せる',
    fitWhole: '全体',
    stillAlt: '撃発の瞬間の静止画と骨格',
    edit: '編集',
    info: (w: number, h: number, fps: number, frames: number, backendId: string) =>
      `${w}×${h}・${fps.toFixed(0)} fps・${frames} フレーム・${backendId}`,
    remove: 'この記録を削除',
    removeTitle: 'この記録を削除しますか？',
    removeBody: '元に戻せません。動画ファイルは消えません。',
    removeConfirm: '削除する',
    removeFailed: '！ 削除できませんでした。もう一度押してください。',
    notFound: '！ この記録を開けませんでした。',
  },
  noise: {
    title: '静止ノイズ測定',
    intro:
      '三脚固定・射手が静止した動画（10 秒以上を推奨）を「読込」タブで処理してから、ここで各項目のばらつき（標準偏差）を確認します。',
    noResult: 'まだ処理済みの動画がありません。「読込」タブで姿勢推定を実行してください。',
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
  /** 角度表（2 行表示）の 1 行目：名称 */
  metricNames: {
    shoulderTilt: '肩線の傾き',
    hipTilt: '腰線の傾き',
    trunkTilt: '体軸の傾き',
    neckTilt: '首の傾き',
    armElevation: '腕の挙上角',
    armShoulderAngle: '腕と肩線のなす角',
    hipLateralOffset: '腰中心の横ずれ',
    stanceWidth: 'スタンス幅',
    wristFaceDistance: '手首と顔の水平距離',
  },
  /** 角度表（2 行表示）の 2 行目：基準と記号 */
  metricBasis: {
    shoulderTilt: '水平基準 (a)',
    hipTilt: '水平基準 (b)',
    trunkTilt: '鉛直基準 (c)',
    neckTilt: '鉛直基準 (d)',
    armElevation: '水平基準 (f)',
    armShoulderAngle: '身体基準 (g)',
    hipLateralOffset: '体幹長比 (h)',
    stanceWidth: '体幹長比 (i)',
    wristFaceDistance: '体幹長比 (j)',
  },
  metricTable: {
    groupDeg: '角度',
    groupRatio: '体幹長に対する比',
    signNote: '＋ は銃側へ傾く・上がる向き',
    noPerson: '！ このフレームでは人物を検出できなかったため、計測できません。',
    legend:
      '「—」は関節が十分に見えない、または画面の外にあって計測できなかった項目。水平・鉛直はカメラの向きが基準（水平校正は段階④）。',
    na: '—',
  },
  units: {
    deg: '°',
    ratio: '比',
  },
} as const;
