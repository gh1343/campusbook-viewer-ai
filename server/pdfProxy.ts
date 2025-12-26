import type { Connect } from "vite";
import { Readable } from "node:stream";

type PdfProxyOptions = {
  owner: string;
  repo: string;
  branch?: string;
  token?: string;
  pdfDir?: string; // repository path to PDFs, e.g. "public/pdf"
};

/**
 * Simple connect middleware that proxies /api/pdf/:file to GitHub (handles LFS).
 * Intended for local dev/preview or when you host the built app behind a Node server.
 *
 * Required env (or options):
 * - GITHUB_TOKEN   : PAT with repo/content read access (private repo)
 * - GITHUB_OWNER   : repo owner
 * - GITHUB_REPO    : repo name
 * - GITHUB_BRANCH  : branch name (default: main)
 * - GITHUB_PDF_DIR : path to pdf folder in repo (default: public/pdf)
 */
export function createPdfProxyMiddleware(options: PdfProxyOptions): Connect.NextHandleFunction {
  const {
    owner,
    repo,
    branch = "main",
    token = process.env.GITHUB_TOKEN,
    pdfDir = "public/pdf",
  } = options;

  const rawBase = `https://api.github.com/repos/${owner}/${repo}/contents`;

  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/pdf/")) {
      return next();
    }

    const file = decodeURIComponent(req.url.replace("/api/pdf/", ""));
    if (!file) {
      res.statusCode = 400;
      res.end("Missing PDF filename");
      return;
    }
    if (file.includes("..")) {
      res.statusCode = 400;
      res.end("Invalid filename");
      return;
    }

    const targetUrl = `${rawBase}/${pdfDir}/${file}?ref=${branch}`;
    const baseHeaders: Record<string, string> = {
      "User-Agent": "campusbook-viewer-ai/pdf-proxy",
    };
    if (token) baseHeaders.Authorization = `Bearer ${token}`;

    try {
      // 1) Fetch raw to detect LFS pointer
      const pointerResp = await fetch(targetUrl, {
        headers: { ...baseHeaders, Accept: "application/vnd.github.raw" },
        redirect: "follow",
      });
      if (!pointerResp.ok) {
        res.statusCode = pointerResp.status || 500;
        res.end(`GitHub fetch failed (${pointerResp.status})`);
        return;
      }

      const pointerText = await pointerResp.text();
      const isLfs = pointerText.includes("git-lfs.github.com/spec/v1");

      if (!isLfs) {
        // Not LFS: fetch again and stream bytes
        const fileResp = await fetch(targetUrl, {
          headers: { ...baseHeaders, Accept: "application/vnd.github.raw" },
          redirect: "follow",
        });
        if (!fileResp.ok || !fileResp.body) {
          res.statusCode = fileResp.status || 500;
          res.end(`GitHub fetch failed (${fileResp.status})`);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/pdf");
        const stream = Readable.fromWeb(fileResp.body as unknown as ReadableStream);
        stream.on("error", (err) => res.destroy(err));
        stream.pipe(res);
        return;
      }

      // 2) Parse LFS pointer (oid + size)
      const oidMatch = pointerText.match(/oid sha256:([0-9a-f]{64})/);
      const sizeMatch = pointerText.match(/size (\d+)/);
      if (!oidMatch || !sizeMatch) {
        res.statusCode = 500;
        res.end("Invalid LFS pointer");
        return;
      }
      const oid = oidMatch[1];
      const size = Number(sizeMatch[1]);

      // 3) Ask LFS batch API for download URL
      const batchUrl = `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`;
      const batchResp = await fetch(batchUrl, {
        method: "POST",
        headers: {
          ...baseHeaders,
          Accept: "application/vnd.git-lfs+json",
          "Content-Type": "application/vnd.git-lfs+json",
        },
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid, size }],
        }),
      });
      if (!batchResp.ok) {
        res.statusCode = batchResp.status || 500;
        res.end(`LFS batch failed (${batchResp.status})`);
        return;
      }
      const batchJson = (await batchResp.json()) as any;
      const download = batchJson?.objects?.[0]?.actions?.download;
      if (!download?.href) {
        res.statusCode = 502;
        res.end("LFS download URL missing");
        return;
      }

      // 4) Download actual LFS binary
      const dlHeaders = new Headers(download.header || {});
      if (!dlHeaders.has("Authorization") && token) {
        dlHeaders.set("Authorization", `Bearer ${token}`);
      }
      dlHeaders.set("User-Agent", "campusbook-viewer-ai/pdf-proxy");

      const dlResp = await fetch(download.href, { headers: dlHeaders, redirect: "follow" });
      if (!dlResp.ok || !dlResp.body) {
        res.statusCode = dlResp.status || 500;
        res.end(`LFS download failed (${dlResp.status})`);
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/pdf");
      const stream = Readable.fromWeb(dlResp.body as unknown as ReadableStream);
      stream.on("error", (err) => res.destroy(err));
      stream.pipe(res);
    } catch (err) {
      console.error("[pdf-proxy] error", err);
      res.statusCode = 500;
      res.end("Proxy error");
    }
  };
}
