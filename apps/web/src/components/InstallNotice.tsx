import { useState } from 'react';
import { ja } from '../i18n/ja';
import {
  isIos,
  isStandalone,
  readInstallNoticeClosed,
  shouldShowInstallNotice,
  writeInstallNoticeClosed,
} from '../pwa/installNotice';

/**
 * 初回の案内（要件 5 章 11、段階⑦）：「ホーム画面に追加」と「JSON で控えを取る」を促す。
 * ホーム画面から開いていないときに、どのタブでも上に出し、「閉じる」で端末に覚えて出さない（2026-10-13、開発者の決定）
 */
export function InstallNotice() {
  const [closed, setClosed] = useState(readInstallNoticeClosed);
  if (!shouldShowInstallNotice(isStandalone(window), closed)) return null;
  const ios = isIos(navigator.userAgent, navigator.maxTouchPoints);
  const close = () => {
    writeInstallNoticeClosed();
    setClosed(true);
  };
  return (
    <div className="notice" data-testid="install-notice" data-ios={ios}>
      <strong>{ja.pwa.installTitle}</strong>
      <p className="small">{ios ? ja.pwa.installBodyIos : ja.pwa.installBodyOther}</p>
      {ios && <p className="small">{ja.pwa.installStorageIos}</p>}
      <p className="small">{ja.pwa.backupNote}</p>
      <div className="row">
        <button data-testid="install-notice-close" onClick={close}>
          {ja.pwa.close}
        </button>
      </div>
    </div>
  );
}
