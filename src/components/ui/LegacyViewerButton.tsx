import React, { useState } from 'react';
import { HelpCircle, X, Smartphone, ExternalLink } from 'lucide-react';
import { getRmsConfig, getAccessStoreHeader } from '../../services/rmsService';
import '../../css/legacy_viewer_button.css';

const handleLegacyClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
  e.preventDefault();

  const config = getRmsConfig();
  if (!config) {
    console.warn('[LegacyViewerButton] config 없음 — apiBase 또는 bookCd를 찾을 수 없습니다.');
    return;
  }

  // iOS Safari는 async 이후 window.open을 팝업으로 차단하므로
  // 사용자 이벤트 컨텍스트가 유지되는 지금 미리 창을 열어둠
  const newWindow = window.open('', '_blank');

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
      newWindow?.close();
      return;
    }

    console.log('[LegacyViewerButton] window.open:', previewUrl);
    if (newWindow) {
      newWindow.location.href = previewUrl;
    } else {
      window.open(previewUrl, '_blank', '');
    }
  } catch (err) {
    console.error('[LegacyViewerButton] 요청 실패:', err);
    newWindow?.close();
  }
};

export const LegacyViewerButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="legacy-viewer-wrap">
      {isOpen ? (
        <div className="legacy-viewer-card">
          {/* 헤더 */}
          <div className="legacy-viewer-card-header">
            <div className="legacy-viewer-header-left">
              <span className="legacy-viewer-live-dot" />
              <span className="legacy-viewer-badge">실시간 웹뷰어</span>
            </div>
            <button
              className="legacy-viewer-header-close"
              onClick={() => setIsOpen(false)}
              aria-label="닫기"
            >
              <X size={14} />
            </button>
          </div>

          {/* 바디 */}
          <div className="legacy-viewer-card-body">
            {/* 서비스 안내 */}
            <div className="legacy-viewer-section">
              <div className="legacy-viewer-section-title">
                <Smartphone size={14} className="legacy-viewer-section-icon" />
                <span>앱 설치 없는 뷰어</span>
              </div>
              <p className="legacy-viewer-section-desc">
                CampusBook은 별도의 앱 설치 없이<br />
                <span className="legacy-viewer-em">웹 브라우저에서 즉시 이용</span>하는 서비스입니다.
              </p>
            </div>

            {/* 권장 사양 */}
            <div className="legacy-viewer-specs">
              <span className="legacy-viewer-specs-label">권장 사양</span>
              <div className="legacy-viewer-specs-items">
                <div className="legacy-viewer-specs-item">
                  <span className="legacy-viewer-specs-os">iOS</span>
                  <span className="legacy-viewer-specs-ver">17+</span>
                </div>
                <div className="legacy-viewer-specs-divider" />
                <div className="legacy-viewer-specs-item">
                  <span className="legacy-viewer-specs-os">AOS</span>
                  <span className="legacy-viewer-specs-ver">13+</span>
                </div>
              </div>
            </div>

            <div className="legacy-viewer-hr" />

            {/* 안내 문구 + 접속 버튼 */}
            <div className="legacy-viewer-action-section">
              <p className="legacy-viewer-note">
                화면 로딩이 원활하지 않을 경우에만<br />
                기존 뷰어(호환 모드)를 이용해 주세요.
              </p>
              <button
                className="legacy-viewer-action-btn"
                onClick={handleLegacyClick}
              >
                <ExternalLink size={14} />
                <span>기존 뷰어로 접속하기</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="legacy-viewer-trigger-btn"
          onClick={() => setIsOpen(true)}
        >
          <span className="legacy-viewer-trigger-icon-wrap">
            <HelpCircle size={18} />
            <span className="legacy-viewer-trigger-dot" />
          </span>
          <span>접속 안내</span>
        </button>
      )}
    </div>
  );
};
