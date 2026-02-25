/**
 * 미리보기 설정 유틸리티
 *
 * 모드 구분:
 *   미리보기        : isPreview=true,  endOfPages > 0  (페이지 제한 있음)
 *   뉴논문 관련 링크 : isPreview=true,  endOfPages = 0  (페이지 제한 없음)
 *   일반 도서        : isPreview=false
 *
 * ⚠️ 함수 방식으로 구현한 이유:
 *   정적 상수(export const isPreviewMode = ...)로 만들면 ES 모듈 평가 타이밍상
 *   로컬 개발 환경에서 __RMS_CONFIG__가 아직 세팅되지 않은 시점에 읽힐 수 있음.
 *   함수는 실제 호출 시점(컴포넌트 렌더링 / Context 실행)에 읽으므로 항상 안전.
 */
export interface PreviewConfig {
  /** isPreview=true인 경우 (미리보기 + 뉴논문 관련 링크 모두) */
  isPreview: boolean;
  /** 미리보기: isPreview=true && endOfPages > 0 */
  isPreviewMode: boolean;
  /** 뉴논문 관련 링크: isPreview=true && endOfPages = 0 */
  isNewPaperLink: boolean;
  /** 미리보기 시작 페이지 (isPreviewMode=true일 때만 유효) */
  previewStartPage: number;
  /** 미리보기 종료 페이지 (isPreviewMode=true일 때만 유효, Infinity면 제한 없음) */
  previewEndPage: number;
  /** 물리적 최대 페이지 제한 (isPreviewMode=true이면 endOfPages 값, 아니면 undefined) */
  previewMaxPage: number | undefined;
}

export const getPreviewConfig = (): PreviewConfig => {
  const _cfg = (window as any).__RMS_CONFIG__;
  const isPreview = !!_cfg?.isPreview;
  const endOfPages = Number(_cfg?.endOfPages);
  const startOfPages = Number(_cfg?.startOfPages);

  const isPreviewMode = isPreview && Number.isFinite(endOfPages) && endOfPages > 0;
  const isNewPaperLink = isPreview && endOfPages === 0;

  return {
    isPreview,
    isPreviewMode,
    isNewPaperLink,
    previewStartPage: isPreviewMode ? (startOfPages || 1) : 1,
    previewEndPage: isPreviewMode ? endOfPages : Infinity,
    previewMaxPage: isPreviewMode ? endOfPages : undefined,
  };
};
