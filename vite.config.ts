import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createPdfProxyMiddleware } from "./server/pdfProxy";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const pdfProxyOptions = {
    owner: env.GITHUB_OWNER || "gh1343",
    repo: env.GITHUB_REPO || "campusbook-viewer-ai",
    branch: env.GITHUB_BRANCH || "main",
    token: env.GITHUB_TOKEN,
    pdfDir: env.GITHUB_PDF_DIR || "public/pdf",
  };
  const pdfProxyPlugin = {
    name: "pdf-proxy",
    configureServer(server) {
      server.middlewares.use(createPdfProxyMiddleware(pdfProxyOptions));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPdfProxyMiddleware(pdfProxyOptions));
    },
  };

  return {
    base: "/campusbook-viewer-ai/", // 본인 리포 이름으로 교체, 또는 './' 사용
    plugins: [react(), tailwindcss(), pdfProxyPlugin],
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  };
});
