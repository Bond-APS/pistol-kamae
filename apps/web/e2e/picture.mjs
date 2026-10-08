// 自動テストで「画面に実際に出ている動画の絵」を撮って比べるための部品。
// フレーム番号だけでなく絵そのものを確かめるために使う（savetest・comparetest で共用）。

/** page に結び付けた、絵の撮影と比較の関数を返す */
export function pictureTools(page) {
  /**
   * 骨格の線（SVG）を隠して、枠（stage）に出ている動画の絵だけを撮る。
   * hideSelectors に、ほかに隠したい部品（重ねたもう 1 本の動画など）の CSS セレクタを渡せる
   */
  const pictureOf = async (stageId, hideSelectors = []) => {
    const selectors = ['.stage-svg', ...hideSelectors];
    const tag = await page.addStyleTag({
      content: `${selectors.join(', ')} { visibility: hidden !important; }`,
    });
    try {
      return await page.locator(`[data-testid=${stageId}]`).screenshot();
    } finally {
      await tag.evaluate((el) => el.remove());
    }
  };
  /** 撮った絵（PNG）を size×size に縮めた画素の並び。ブラウザの canvas で読む（Node に画像の部品を足さないため） */
  const pixelsOf = (png, size = 64) =>
    page.evaluate(
      async ([b64, n]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = n;
        canvas.height = n;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, n, n);
        return Array.from(ctx.getImageData(0, 0, n, n).data);
      },
      [png.toString('base64'), size],
    );
  /** 絵の明るさの平均（0〜255） */
  const brightness = (px) => {
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
    return sum / (px.length / 4);
  };
  /** 2 枚の違い（画素の差の平均、0〜255） */
  const difference = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4)
      sum +=
        (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    return sum / (a.length / 4);
  };
  return { pictureOf, pixelsOf, brightness, difference };
}
