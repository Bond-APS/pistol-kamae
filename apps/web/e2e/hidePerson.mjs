// HIDE_PERSON=1 を付けて自動テストを回すと、全画面の撮影（page.screenshot）から人物を隠す。
// 画面の撮影を外部（他の人や外部のサービス）に見せるとき、動画に写っている人の姿を出さないため。
// 隠すのは動画と静止画だけで、骨格の線やボタンはそのまま写る。動画の絵を確かめる検査（プレイヤーだけの撮影）には影響しない。

export function hidePersonInScreenshots(page) {
  if (process.env.HIDE_PERSON !== '1') return;
  const original = page.screenshot.bind(page);
  page.screenshot = async (options) => {
    const tag = await page.addStyleTag({
      // 動画、一覧の小さい写真（img）、詳細の写真（SVG の image）
      content: 'video, img, image { visibility: hidden !important; }',
    });
    try {
      return await original(options);
    } finally {
      await tag.evaluate((el) => el.remove());
    }
  };
}
