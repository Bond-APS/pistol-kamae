// 自動テストで、再生中に実際に画面へ出たコマの媒体時刻を記録する部品。
// requestVideoFrameCallback（表示されたコマの時刻を教えてくれる機能）で受け取り、
// 「止めた瞬間に見えていたコマ」が、止めたあとに選ばれるコマと同じかを確かめるために使う。

/** page に結び付けた、記録の開始と読み出しの関数を返す */
export function presentedTools(page) {
  /**
   * selector の video について記録を始める。止めている間に表示されたコマ（止めたあとのシークで出たコマ）は
   * 「再生中」には数えない。requestVideoFrameCallback が使えなければ false
   */
  const record = (selector) =>
    page.evaluate((sel) => {
      const video = document.querySelector(sel);
      if (!video || typeof video.requestVideoFrameCallback !== 'function') return false;
      window.__presented = { whilePlaying: null, last: null };
      const onFrame = (_now, meta) => {
        window.__presented.last = meta.mediaTime;
        if (!video.paused) window.__presented.whilePlaying = meta.mediaTime;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      return true;
    }, selector);
  /** 再生中に最後に表示されたコマの媒体時刻（秒）。記録がなければ null */
  const whilePlaying = () => page.evaluate(() => window.__presented?.whilePlaying ?? null);
  /** selector の video が再生を始めるまで待つ（止める操作を、再生が始まる前に押してしまわないため） */
  const waitPlaying = (selector) =>
    page.waitForFunction(
      (sel) => {
        const v = document.querySelector(sel);
        return v && !v.paused;
      },
      selector,
      { timeout: 5000 },
    );
  return { record, whilePlaying, waitPlaying };
}
