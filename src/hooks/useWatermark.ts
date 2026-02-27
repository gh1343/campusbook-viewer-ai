import { useEffect, useState } from "react";

/**
 * snap_tag.js (v2) 와 동일한 로직으로 labguardW 워터마크 blob URL을 생성한다.
 * __RMS_CONFIG__ 에 memberIdx / bookIdx / telNum / purchaseType 가 포함돼 있어야 동작한다.
 */
export function useWatermark(): string | null {
  const [watermarkUrl, setWatermarkUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let blobUrl: string | null = null;

    const cfg = (window as any).__RMS_CONFIG__ ?? {};
    const apiPath: string = cfg.apiBase ?? "";
    const isPreview: boolean = cfg.isPreview ?? false;
    const memberCd: string = cfg.memberCd ?? "";
    // memberIdx 는 JSP 에서 문자열("000123")로 전달되므로 parseInt 로 정수화
    const memberIdx: number = parseInt(cfg.memberIdx ?? "0", 10) || 0;
    const bookIdx: string = String(cfg.bookIdx ?? "0");
    const telNum: string = String(cfg.telNum ?? "0");
    const purchaseType: string = String(cfg.purchaseType ?? "");

    /* ── snap_tag.js 와 동일한 헬퍼 함수들 ── */
    const getDate = (): string => {
      const now = new Date();
      const kst = new Date(
        now.getTime() + (9 * 60 - now.getTimezoneOffset()) * 60000
      );
      const y = kst.getUTCFullYear();
      const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
      const d = String(kst.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const encodeDigits = (input: string | number): string => {
      const digits = String(input ?? "").replace(/\D/g, "");
      if (digits.length < 8) return "";
      const tail8 = digits.slice(-8);
      const left4 = tail8.slice(0, 4);
      const right4 = tail8.slice(4);
      const mapChar = (d: string) => String.fromCharCode(97 + Number(d));
      return `${left4.replace(/\d/g, mapChar)}-${right4.replace(
        /\d/g,
        mapChar
      )}`;
    };

    const toWidth6 = (val: string | number): string =>
      String(val).padStart(6, "0");

    /* ── labguardW 파라미터 (snap_tag.js 와 동일) ── */
    const combinedNum = `${bookIdx}${toWidth6(memberIdx)}`;
    const combinedBinary =
      !isPreview && purchaseType === "PMT" && memberCd ? combinedNum : 1;

    const apiKey =
      apiPath === "https://o2o-gwapi-devqa.campusbook.co.kr"
        ? "snap_iam_bf1b899c81b4147a"
        : "snap_iam_ec40d3e5b268d79b";

    const chkNum = encodeDigits(telNum);
    const param = {
      keyPath: "/resources/labcurity_key.txt",
      type: 1,
      product: combinedBinary,
      apiKey,
      externalId: JSON.stringify({ date: getDate(), chkNum }),
    };

    /* ── stUtils.js 를 런타임 동적 import 후 labguardW 호출 ──
     * new Function 으로 감싸야 Vite 빌드·dev 서버의 정적 분석을 완전히 우회할 수 있다.
     * (/* @vite-ignore *\/ 만으로는 dev 서버에서 resolve 오류가 발생함)
     */
    const runtimeImport = new Function("path", "return import(path)") as (
      path: string
    ) => Promise<any>;

    runtimeImport("/resources/stUtils.js")
      .then((mod: any) => {
        if (cancelled) return;

        // 워터마크
        mod.labguardW(param, (blob: Blob) => {
          if (cancelled) return;
          blobUrl = URL.createObjectURL(blob);
          setWatermarkUrl(blobUrl);
        });

        // DevTool 감지 → 프로덕션 환경에서만 (snap_tag.js 와 동일 조건)
        if (apiPath === "https://o2o-gwapi.campusbook.co.kr") {
          mod.controlDevTool("https://www.campusbook.co.kr");
        }
      })
      .catch(() => {
        /* stUtils.js 로드 실패 시 워터마크 없이 조용히 종료 */
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, []);

  return watermarkUrl;
}
