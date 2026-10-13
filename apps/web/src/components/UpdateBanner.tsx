import { useRegisterSW } from 'virtual:pwa-register/react';
import { ja } from '../i18n/ja';

interface Props {
  /** 保存していない解析結果があるか（あるときは「更新」を押せなくする。開き直すと消えるため） */
  unsaved: boolean;
}

/**
 * 新しい版の案内（段階⑦）。サービスワーカーが新しい版を取り置きし終えたら出す。
 * 勝手に再読込はしない（解析の途中を失わないため）。「更新」で開き直す。
 * 新しい版の確認は、ページを開いたときと、別のアプリから戻ってきたとき（iPhone のホーム画面のアプリや
 * Mac のタブは何日も開いたままになるため）
 */
export function UpdateBanner({ unsaved }: Props) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="notice" data-testid="update-banner" role="status">
      <strong>{ja.pwa.updateTitle}</strong>
      <p className="small">{unsaved ? ja.pwa.updateUnsaved : ja.pwa.updateBody}</p>
      <div className="row">
        <button
          data-testid="update-now"
          disabled={unsaved}
          onClick={() => void updateServiceWorker(true)}
        >
          {ja.pwa.update}
        </button>
        <button data-testid="update-later" onClick={() => setNeedRefresh(false)}>
          {ja.pwa.later}
        </button>
      </div>
    </div>
  );
}
