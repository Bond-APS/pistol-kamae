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
    stageNote: '開発中の検証用画面（段階⑤を実装中）',
    dbUnavailable:
      'このブラウザでは保存の機能を使えません。プライベートブラウズを切るか、別のブラウザで開いてください。',
  },
  devErrors: {
    title: '開発サーバ限定：画面内エラー表示',
    clear: '消す',
  },
  tabs: {
    save: '動画の保存',
    library: 'ライブラリ',
    noise: 'ノイズ',
    unsavedAria: '保存していない動画があります',
  },
  common: {
    cancel: 'キャンセル',
    goLoad: '動画を読み込む',
    decide: '決定',
    back: '← 戻る',
  },
  /** 保存の流れの 5 段階。short は帯に並べる短い名前、title は今の段階として帯の下に出す正式な名前 */
  steps: {
    aria: '手順',
    short: {
      shooter: '1 射手',
      video: '2 動画',
      clip: '3 切り抜き',
      shot: '4 撃発',
      form: '5 保存',
    },
    title: {
      shooter: '1 射手の選択',
      video: '2 動画の指定',
      clip: '3 切り抜き',
      shot: '4 撃発ポイントの特定',
      form: '5 保存',
    },
  },
  handedness: handednessName,
  load: {
    shooterLine: (shooter: string) => `射手：${shooter}`,
    backToShooter: '← 射手を選び直す',
    pickVideo: '下のボタンを押して動画を選ぶ',
    pickButton: 'ファイルを選択',
    notPicked: 'ファイル未選択',
    picked: '選択済み',
    repickHint: '動画を選び直すときは「ファイルを選択」を押してください。',
    pleaseWait: 'しばらくお待ちください',
    formatHint:
      '読める形式：MP4（H.264）、MOV（H.264）、WebM。iPhone の HEVC 形式は Windows の Chrome などで再生できないことがあります。',
    formatHintIphone: 'iPhone は「設定 → カメラ → フォーマット → 互換性優先」で撮影してください。',
    unsupportedTitle: '！ この動画は再生できません',
    unsupported:
      'この動画はこのブラウザで再生できません。iPhone なら「設定 → カメラ → フォーマット → 互換性優先」で撮り直すか、別のブラウザで開いてください。',
    videoInfo: (w: number, h: number, sec: number, fps: number | null) =>
      `${w}×${h}、${sec.toFixed(1)} 秒${fps ? `、推定 ${fps.toFixed(0)} fps` : ''}`,
    run: '姿勢推定を実行',
    cancel: '中断',
    progress: (done: number, total: number) => `処理中… ${done} / 約 ${total} フレーム`,
    preparing: 'モデルを読み込んでいます…',
    cancelled: '中断しました',
    errorTitle: '！ 姿勢推定でエラーが起きました',
    error: (msg: string) => `エラー：${msg}`,
    discardTitle: '保存していない動画があります',
    discardBody: '別の動画を選ぶと、今の切り抜きと撃発ポイントは消えます。',
    discardConfirm: '保存せずに進む',
  },
  clip: {
    intro:
      '前後の余計な部分を外します。取っ手を引くか、動画を動かして「ここを開始に」「ここを終了に」を押してください。',
    handleStart: '切り抜きの開始',
    handleEnd: '切り抜きの終了',
    startAt: (sec: number) => `開始 ${sec.toFixed(1)} s`,
    endAt: (sec: number) => `終了 ${sec.toFixed(1)} s`,
    setStart: 'ここを開始に',
    setEnd: 'ここを終了に',
    length: (clipSec: number, totalSec: number) =>
      `切り抜いた長さ：${clipSec.toFixed(1)} 秒（元の動画 ${totalSec.toFixed(1)} 秒）`,
    keepNote:
      '元の動画は丸ごと保存され、範囲はあとから変えられます（端末の保存容量は減りません）。',
    confirm: '範囲を確定 → 撃発ポイントの特定へ',
    fixTitle: '切り抜き範囲の修正',
    shotOutside: '！ 撃発ポイントが範囲の外になります。撃発ポイントを含む範囲にしてください。',
    invalid: '！ この範囲は使えません（短すぎる、または動画の外に出ています）。',
  },
  shot: {
    intro: '撃発の発射音に合わせてあります。修正が必要な場合は指定しなおしてください。',
    introNoAudio:
      'この動画からは音を取り出せないため、音のグラフは出ません。動画を動かして、銃が跳ね上がる直前のコマで押してください。',
    set: '撃発ポイントを確定',
    loudest: '音の最大',
    marker: '撃発',
    setAt: (sec: number, index: number) =>
      `撃発ポイント：${sec.toFixed(2)} 秒（${index + 1} コマ目）`,
    backToClip: '← 切り抜きに戻る',
    fixTitle: '撃発ポイントの修正',
    capturing: '静止画を作っています…',
    captureFailed: '！ 静止画を作れませんでした。もう一度押してください。',
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
    requiredHint: '射手を登録すると、次へ進めます。',
    stepIntro: 'この動画の射手を選んでください。',
    next: '次へ（動画を選ぶ）',
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
    play: '▶ 再生',
    pause: '一時停止',
    prevFrame: '◀ 1 コマ',
    nextFrame: '1 コマ ▶',
    slider: '表示する時点（つまみを動かして選ぶ）',
    stageAlt: '動画と骨格',
    secLabel: (sec: number) => `${sec.toFixed(1)} s`,
    rate: (rate: number) => (rate === 1 ? '1 倍' : rate === 0.5 ? '1/2' : '1/4'),
    loop: '↻ 繰り返し',
    noAudio: '音声なし',
    /** 例：3.40 秒（102 / 156 コマ） */
    timeLabel: (sec: number, index: number, total: number) =>
      `${sec.toFixed(2)} 秒（${index + 1} / ${total} コマ）`,
    angleTitle: 'このコマの角度（止めているとき）',
    anglePlaying: '止めると、そのコマの角度が出ます。',
    noPerson: '人物を検出できませんでした',
  },
  save: {
    saving: '保存中…',
    savedTitle: '✓ ライブラリに保存しました',
    nextVideo: '次の動画を保存する',
    viewLibrary: 'ライブラリで見る',
    failedTitle: '！ 保存できませんでした',
    failedBody: '端末の空き容量を確認して、もう一度押してください。',
    videoFailed:
      '！ 動画本体は保存できませんでした（端末の空き容量が足りない可能性があります）。この動画は、撃発の瞬間の写真と骨格だけになります。空きを作ってから、ライブラリでこの動画を開くと、あとから動画を付けられます。',
    videoTooLarge:
      '！ 動画が 200 MB を超えているため、動画本体は保存しませんでした。この動画は、撃発の瞬間の写真と骨格だけになります。動画を短く切るか、画質を下げて撮ると保存できます。',
    summaryClip: (startSec: number, endSec: number) =>
      `切り抜き ${startSec.toFixed(1)}〜${endSec.toFixed(1)} 秒（${(endSec - startSec).toFixed(1)} 秒）`,
  },
  record: {
    formEditTitle: 'タイトル・メモなどを編集',
    title: 'タイトル',
    titleHint: '初期値は撮影日時です。自由に変えられます。',
    titleInvalid: '！ タイトルを入力してください（60 字まで）。',
    favorite: 'お気に入り',
    shotAt: '撮影日時',
    shotAtHintSave: '動画ファイルの日時です。違っていたら直してください。',
    shotAtInvalid: '！ 撮影日時を入力してください。',
    memo: (max: number) => `メモ（${max} 字まで）`,
    memoPlaceholder: '例：据銃が安定していた。肩が上がり気味',
    memoTooLong: (max: number) => `！ メモは ${max} 字までです。`,
    submitSave: '保存する',
    submitEdit: '変更を保存',
    dateTime,
    /** 一覧の 2 行目。例：つよし・5.2 秒・肩が上がり気味 */
    subLine: (shooterName: string, clipSec: number, memo: string) =>
      [shooterName, `${clipSec.toFixed(1)} 秒`, memo].filter((s) => s !== '').join('・'),
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
      'まだ保存した動画がありません。「動画の保存」で動画を読み込み、切り抜きと撃発ポイントを決めて保存すると、ここに並びます。',
    noMatch: '条件に合う動画がありません。',
    clearFilter: '絞り込みを解除',
    back: '← 一覧へ',
    backToDetail: '← 詳細へ',
    selectHint:
      '最初に右の◯を押した動画が基準。次に◯を押した動画が基準動画と比較する動画。タイトルを押すと動画の詳細が確認できます。',
    pick: (title: string) => `「${title}」を比較に選ぶ`,
    unpick: (title: string) => `「${title}」を比較から外す`,
    pairLine: (base: string, current: string) => `①基準：${base}\u3000②比較：${current}`,
    pairOneLine: (base: string) => `①基準：${base}\u3000②比較：（もう 1 件選ぶ）`,
    swap: '⇄',
    swapAria: '基準と比較を入れ替える',
    compareBoth: 'この 2 件を比較する',
    shooterLine: (name: string, handedness: 'right' | 'left') =>
      `${name}・${handednessName[handedness]}`,
    detailShooter: '射手',
    detailShotAt: '撮影日時',
    detailLength: '長さ',
    detailLengthValue: (clipSec: number, totalSec: number, startSec: number, endSec: number) =>
      clipSec === totalSec
        ? `${clipSec.toFixed(1)} 秒`
        : `${clipSec.toFixed(1)} 秒（元 ${totalSec.toFixed(1)} 秒、${startSec.toFixed(1)}〜${endSec.toFixed(1)} 秒）`,
    detailShot: '撃発',
    detailShotValue: (sec: number) => `${sec.toFixed(2)} 秒`,
    detailMemo: 'メモ',
    stillAlt: '撃発の瞬間の静止画と骨格',
    play: '動画を再生（角度などの情報を表示）',
    edit: 'タイトル・メモなどを編集',
    fixShot: '撃発ポイントの修正',
    fixClip: '切り抜き範囲の修正',
    info: (w: number, h: number, fps: number, frames: number, backendId: string) =>
      `${w}×${h}・${fps.toFixed(0)} fps・${frames} フレーム・${backendId}`,
    remove: 'この動画を削除',
    removeTitle: 'この動画を削除しますか？',
    removeBody: '元に戻せません。端末の写真アプリなどにある元の動画ファイルは消えません。',
    removeConfirm: '削除する',
    removeFailed: '！ 削除できませんでした。もう一度押してください。',
    notFound: '！ この動画を開けませんでした。',
    notFoundBody:
      '保存した内容が壊れているか、古すぎる形式です。削除して、動画を保存し直してください。',
    needVideo: 'この動画は本体を保存していないため、再生と修正はできません。',
    fixSaved: '✓ 保存しました',
    fixFailed: '！ 保存できませんでした。もう一度押してください。',
  },
  numbers: {
    hintHidden: '（数値を表示）',
    hintShown: '（数値を隠す）',
  },
  video: {
    attach: '動画を付ける（ファイルを選ぶ）',
    attaching: '動画を確かめています…',
    mismatch:
      '！ この記録の動画ではないようです（画面の大きさか長さが違います）。記録を作ったときと同じ動画を選んでください。',
    mismatchDetail: (w: number, h: number, sec: number, pw: number, ph: number, psec: number) =>
      `記録：${w}×${h}・${sec.toFixed(2)} 秒／選んだ動画：${pw}×${ph}・${psec.toFixed(2)} 秒`,
    failed: '！ 動画を保存できませんでした。端末の空き容量を確認してください。',
    rowSaved: '動画：保存済み',
    rowNone: '動画：なし',
    rowNoneHint: '再生と修正ができず、比較画面では撃発の瞬間以外の絵が出ません',
    usage: (mb: number) => `この端末で使っている保存容量：約 ${mb} MB（動画を含む）`,
  },
  // 水平の線を引く画面（components/LevelEditor.tsx）の文言。水平校正は初期バージョンから外したので、
  // 今はどの画面からも使っていない（2026-10-03）
  level: {
    title: '水平の線を引く',
    intro:
      '射手のすぐ近くにある、本当は鉛直なもの（柱・ドア枠など）か、本当は水平なもの（床と壁の境目など）に、線を合わせてください。両端の ● を指で動かします。線は長いほど正確です。',
    imageAlt: '撃発の瞬間の静止画と、水平の線',
    handle: (n: 1 | 2) => `線の端 ${n}（矢印キーでも動かせます）`,
    /** 線の向きごとの、写り方の説明。例：水平なものが右下がりに 1.0° 傾いて写っています */
    readout: (kind: 'horizontal' | 'vertical', deg: number) => {
      const abs = Math.abs(deg).toFixed(1);
      if (abs === '0.0') return 'カメラの傾き：0.0°（傾きなし）';
      return kind === 'horizontal'
        ? `水平なものが${deg > 0 ? '右下がり' : '右上がり'}に ${abs}° 傾いて写っています`
        : `鉛直なものの上が${deg > 0 ? '右' : '左'}に ${abs}° 倒れて写っています`;
    },
    kindHorizontal: '水平なものに合わせた線として扱います。',
    kindVertical: '鉛直なもの（柱・ドア枠など）に合わせた線として扱います。',
    saveNote: '決めると、この記録の角度を、この傾きの分だけ補正して計算します。',
    tooShortTitle: '！ 線が短すぎます',
    tooShortBody:
      '画面の長い辺の 2 割以上の長さにしてください。短い線は、少しのずれで角度が大きく変わります。',
    tooTiltedTitle: (deg: number) => `！ 傾きが大きすぎます（${Math.abs(deg).toFixed(1)}°）`,
    tooTiltedBody:
      '奥へ向かって延びる線（射台の前の縁など）は、水平でも斜めに写ります。カメラから見て左右に延びる線か、鉛直な線を選んでください。',
    farTitle: '線が射手から離れています',
    farBody:
      'カメラが少しでも上や下を向いていると、鉛直なものは画面の端に近いほど斜めに写ります。射手のすぐ近くにある線を選ぶと正確です（このままでも決められます）。',
    submit: 'この線で決める',
    saving: '保存中…',
    remove: '線を消す（補正をやめる）',
    failed: '！ 保存できませんでした。もう一度押してください。',
  },
  compare: {
    loading: '読み込んでいます…',
    base: '基準',
    current: '比較',
    backToLibrary: '← ライブラリへ',
    backToCompare: '← 比較へ',
    pairLine: (base: string, current: string) => `①${base} ／ ②${current}`,
    notChosen:
      '比較する 2 件を選んでいません。ライブラリで、2 件の◯を押して「この 2 件を比較する」を押してください。',
    goLibrary: 'ライブラリを開く',
    holdNote: '絵を押している間は基準だけを表示します。離すと比較に戻ります。',
    baseOpacity: '基準の濃さ',
    showSkeleton: '骨格を表示',
    timeSlider: '時点（つまみを動かして選ぶ。0 ＝ 撃発）',
    atShot: '撃発の瞬間',
    beforeShot: (sec: number) => `撃発の ${sec.toFixed(2)} 秒前`,
    afterShot: (sec: number) => `撃発の ${sec.toFixed(2)} 秒後`,
    relLabel: (sec: number) => `${sec >= 0 ? '+' : '−'}${Math.abs(sec).toFixed(1)} s`,
    shotMarker: '撃発',
    playNeedsSide: 'この 2 件は重ねられないので、「横に並べる」を入れると再生できます。',
    playUnavailable: '再生は、両方の動画に本体が保存されているときに使えます。',
    noVideoBoth: 'どちらの動画にも本体がありません',
    noVideoOne: (role: string) => `「${role}」の動画に本体がありません`,
    noVideoBody:
      '本体のない動画は、撃発の瞬間の写真と骨格だけが出ます（バーを動かすと、骨格と数値は変わります）。保存したときと同じ動画ファイルを選ぶと、本体を付けられます。',
    attachFor: (role: string) => `「${role}」の動画`,
    overlayAlt: '比較の動画に、基準の動画と骨格を重ねた図',
    layoutSide: '横に並べる',
    alignNormalized: '位置と大きさを揃える',
    alignRaw: '撮ったまま',
    normalizedNote:
      '腰の中心を重ね、体幹の長さ（腰の中心→肩の中心）が同じになるよう基準を拡大・縮小しています。',
    rawNote:
      '画面の中の位置と大きさをそのまま重ねます。カメラを動かさずに続けて撮った 2 本で、立ち位置のずれを見るときに使います。',
    sideNote: 'それぞれの写真に、それぞれの骨格。人物が同じ大きさに見えるよう寄せて表示。',
    rawUnavailable: '画面の縦横比が違う 2 件は、「撮ったまま」では重ねられません。',
    normalizedUnavailable:
      '肩か腰がよく見えない動画があるため、位置と大きさを揃えられません。「撮ったまま」で重ねています。',
    cannotOverlayTitle: 'この 2 件は重ねられません',
    cannotOverlayBody:
      '肩か腰がよく見えない動画があるため位置と大きさを揃えられず、画面の縦横比も違うため撮ったままでも重ねられません。「角度情報の表示」で数値で比べてください。',
    cameraMovedTitle: 'カメラの位置が違うようです',
    cameraMovedBody: (percent: number) =>
      `人物の大きさが ${percent}% 違います。「位置と大きさを揃える」で比べてください。`,
    fixShot: '撃発ポイントの修正',
    fixClip: '切り抜き範囲の修正',
    clipEditTitle: '切り抜き範囲の修正（①②の両方）',
    clipEditBody:
      '撃発を 0 とした開始と終了を決めます。取っ手を引くか、バーを動かして「ここを開始に」「ここを終了に」。決定すると、①②の両方の動画がこの範囲に切り抜かれます。',
    clipEditRange: (startT: number, endT: number) =>
      `範囲：撃発の ${Math.abs(startT).toFixed(1)} 秒${startT < 0 ? '前' : '後'}〜${Math.abs(endT).toFixed(1)} 秒${endT < 0 ? '前' : '後'}（${(endT - startT).toFixed(1)} 秒）`,
    fixWhich: 'どちらの動画を直しますか',
    fixRole: (n: 1 | 2, role: string, title: string) => `${n === 1 ? '①' : '②'}${role}：${title}`,
    handednessTitle: '利き手が違う 2 人です',
    handednessBody: (name: string, handedness: 'right' | 'left') =>
      `「位置と大きさを揃える」では、基準（${name}・${handednessName[handedness]}）の骨格を左右反転して重ねます。角度は、どちらも銃側を＋として比べています。`,
    backendTitle: '姿勢推定のモデルが違う 2 件です',
    backendBody: 'モデルが違うと角度が系統的にずれるため、差は参考になりません。',
    numbersTitle: '角度情報の表示',
    tableTimes: (sec: string) => `時点：${sec}`,
    signNote:
      '差＝比較 − 基準。角度の＋は比較のほうが銃側へ傾く・上がる向き、比の＋は比較のほうが大きい',
    colBase: '基準',
    colCurrent: '比較',
    colDiff: '差',
    markNotable: '◇',
    markLarge: '◆',
    ariaNotable: 'やや差がある',
    ariaLarge: '差がある',
    legend: (notable: number, large: number) =>
      `◇ 測定の揺れの ${notable} 倍以上の差、◆ ${large} 倍以上の差`,
    cameraNote:
      '水平基準・鉛直基準の差には、撮ったときのカメラの傾きの違いも含まれます（身体基準と体幹長比の項目は影響を受けません）。',
    legendNone:
      '測定の揺れ＝同じ姿勢でも 1 コマごとに値がばらつく幅。印のない差は、その揺れと区別できません。「—」は計測できなかった項目。',
    notFound: '！ 選んでいた動画が見つかりません。ライブラリで選び直してください。',
  },
  noise: {
    title: '静止ノイズ測定',
    intro:
      '三脚固定・射手が静止した動画（10 秒以上を推奨）を「動画の保存」で処理してから、ここで各項目のばらつき（標準偏差）を確認します。',
    noResult: 'まだ処理済みの動画がありません。「動画の保存」で姿勢推定を実行してください。',
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
      '「—」は関節が十分に見えない、または画面の外にあって計測できなかった項目。水平・鉛直はカメラの向きが基準（カメラの傾きは補正しない）。',
    na: '—',
  },
  units: {
    deg: '°',
    ratio: '比',
  },
} as const;
