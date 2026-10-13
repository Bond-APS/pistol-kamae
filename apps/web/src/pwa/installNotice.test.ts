import { describe, expect, it } from 'vitest';
import { isIos, isStandalone, shouldShowInstallNotice } from './installNotice';

describe('初回の案内', () => {
  it('ホーム画面から開いているか', () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
    expect(
      isStandalone({ navigator: {}, matchMedia: (q) => ({ matches: q.includes('standalone') }) }),
    ).toBe(true);
    expect(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandalone({ navigator: {} })).toBe(false);
  });
  it('iPhone・iPad の見分け', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isIos('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
  });
  it('出すのは、ホーム画面から開いておらず、閉じていないときだけ', () => {
    expect(shouldShowInstallNotice(false, false)).toBe(true);
    expect(shouldShowInstallNotice(true, false)).toBe(false);
    expect(shouldShowInstallNotice(false, true)).toBe(false);
  });
});
