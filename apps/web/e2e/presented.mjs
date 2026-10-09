// 自動テストで、再生中に実際に画面へ出たコマの媒体時刻を記録する部品。
// requestVideoFrameCallback（表示されたコマの時刻を教えてくれる機能）で受け取り、
// 「止めた瞬間に見えていたコマ」が、止めたあとに選ばれるコマと同じかを確かめるために使う。

/** page に結び付けた、記録の開始と読み出しの関数を返す */
export function presentedTools(page) {
  /**
   * selector の video について記録を始める。「止めたときに見えていたコマ」は、止めたあとにアプリが
   * 行うシーク（seeking）が始まる直前に表示されていたコマとする（止める操作の直後に届く通知も含める。
   * アプリ側の記録と同じ定義）。再生を始める（play）と記録を取り直す。
   * 前提：記録する video は再生の主（比較画面なら②）で、止めるまでアプリがその video をシークしないこと
   * （繰り返し再生の先頭へ戻すシークが入ると、その時点のコマで固定されてしまう）。
   * requestVideoFrameCallback が使えなければ false
   */
  const record = (selector) =>
    page.evaluate((sel) => {
      const video = document.querySelector(sel);
      if (!video || typeof video.requestVideoFrameCallback !== 'function') return false;
      const state = { last: null, frozen: null };
      window.__presented = state;
      video.addEventListener('play', () => {
        state.frozen = null;
      });
      video.addEventListener('seeking', () => {
        // 止まっている間のシーク（＝止めたあとにアプリが行うシーク）だけで固定する。再生を始めるときの
        // シークは、WebKit では play の通知のあとに届くことがあるので、再生中のシークは無視する
        if (video.paused && state.frozen === null) state.frozen = state.last;
      });
      const onFrame = (_now, meta) => {
        state.last = meta.mediaTime;
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      return true;
    }, selector);
  /** 止めたときに見えていたコマの媒体時刻（秒）。シークがなければ最後に表示されたコマ。記録がなければ null */
  const whilePlaying = () =>
    page.evaluate(() => {
      const state = window.__presented;
      if (!state) return null;
      return state.frozen ?? state.last;
    });
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
  /**
   * 止めたあとに選ばれたコマ（chosenSec）が、見えていたコマ（seenSec）と同じか、その 1 つ前なら true。
   * 1 つ前も許すのは、止める操作のあとアプリのシークまでの間に次のコマが 1 枚表示されることがあり、
   * アプリは止めた時点で知っていたコマへ戻すため（絵と骨格は一致する）。修正前の不具合は「1 つ後」が
   * 選ばれるものなので、それは不合格のまま
   */
  const keptFrame = (seenSec, chosenSec, frameSec = 1 / 30) =>
    seenSec !== null && chosenSec - seenSec < frameSec / 2 && seenSec - chosenSec < frameSec * 1.5;
  return { record, whilePlaying, waitPlaying, keptFrame };
}
