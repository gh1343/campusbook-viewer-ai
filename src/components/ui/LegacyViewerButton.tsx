import React from 'react';
import { HelpCircle, ArrowRight } from 'lucide-react';
import { getRmsConfig } from '../../services/rmsService';
import '../../css/legacy_viewer_button.css';

const handleLegacyClick = async () => {
  const config = getRmsConfig();

  console.log('[LegacyViewerButton] getRmsConfig():', config);

  if (!config) {
    console.warn('[LegacyViewerButton] config 없음 — apiBase 또는 bookCd를 찾을 수 없습니다.');
    return;
  }

  const { apiBase, bookCd } = config;
  const url = `${apiBase}/v2/book/info/${bookCd}`;

  console.log(`[LegacyViewerButton] 요청 URL: ${url}`);

  try {
    const res = await fetch(url);
    const text = await res.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    console.log('[LegacyViewerButton] 응답 status:', res.status);
    console.log('[LegacyViewerButton] 응답 body:', parsed);
  } catch (err) {
    console.error('[LegacyViewerButton] 요청 실패:', err);
  }
};

export const LegacyViewerButton: React.FC = () => {
  return (
    <div className="legacy-viewer-btn-wrap">
      <div className="legacy-viewer-tooltip">
        <p className="legacy-viewer-tooltip-text">
          화면이 멈추거나 로딩이 안 되나요?
        </p>
      </div>

      <a
        href="https://v2.campusbook.co.kr"
        target="_blank"
        rel="noopener noreferrer"
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
      </a>
    </div>
  );
};
