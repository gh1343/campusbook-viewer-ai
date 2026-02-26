import React, { useState } from 'react';
import { HelpCircle, ArrowRight, X } from 'lucide-react';
import { getRmsConfig, getAccessStoreHeader } from '../../services/rmsService';
import '../../css/legacy_viewer_button.css';

const handleLegacyClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
  e.preventDefault();

  const config = getRmsConfig();
  if (!config) {
    console.warn('[LegacyViewerButton] config 없음 — apiBase 또는 bookCd를 찾을 수 없습니다.');
    return;
  }

  const { apiBase, bookCd } = config;
  const url = `${apiBase}/v2/book/info/${bookCd}`;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-ealice-store": getAccessStoreHeader(),
  };
  console.log('[LegacyViewerButton] 요청 URL:', url);
  console.log('[LegacyViewerButton] 요청 헤더:', headers);

  try {
    const res = await fetch(url, { headers });
    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    console.log('[LegacyViewerButton] 응답 status:', res.status, parsed);

    const previewUrl = parsed?.result?.bookInfo?.previewUrl;
    if (!previewUrl) {
      console.error('[LegacyViewerButton] previewUrl을 찾을 수 없습니다.', parsed);
      return;
    }

    console.log('[LegacyViewerButton] window.open:', previewUrl);
    window.open(previewUrl, '_blank', '');
  } catch (err) {
    console.error('[LegacyViewerButton] 요청 실패:', err);
  }
};

export const LegacyViewerButton: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="legacy-viewer-btn-wrap">
      <div className="legacy-viewer-tooltip">
        <p className="legacy-viewer-tooltip-text">
          화면이 멈추거나 로딩이 안 되나요?
        </p>
      </div>

      <a
        href="#"
        className="legacy-viewer-link"
        onClick={handleLegacyClick}
      >
        <div className="legacy-viewer-icon-wrap">
          <HelpCircle size={20} />
        </div>
        <div className="legacy-viewer-text-wrap">
          <span className="legacy-viewer-label">기기 호환성 모드</span>
          <div className="legacy-viewer-title-row">
            <span className="legacy-viewer-title">기존 뷰어로 접속하기</span>
            <ArrowRight size={14} className="legacy-viewer-arrow" />
          </div>
        </div>

        <button
          className="legacy-viewer-close-btn"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissed(true); }}
          aria-label="닫기"
        >
          <X size={14} />
        </button>
      </a>
    </div>
  );
};
