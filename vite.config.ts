import fs from "fs";
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** 개발 서버에서 소스맵을 완전히 제거하는 플러그인 */
function removeSourcemaps(): Plugin {
  return {
    name: "remove-sourcemaps",
    enforce: "post",
    transform(code) {
      return {
        code: code.replace(/\/\/# sourceMappingURL=.*/g, ""),
        map: null,
      };
    },
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const originalSetHeader = res.setHeader.bind(res);
        res.setHeader = (name: string, value: unknown) => {
          // SourceMap 관련 응답 헤더 제거
          if (
            name.toLowerCase() === "sourcemap" ||
            name.toLowerCase() === "x-sourcemap"
          ) {
            return res;
          }
          return originalSetHeader(name, value);
        };
        next();
      });
    },
  };
}

/** 로컬 PDF 파일을 /local-pdfs/ 경로로 서빙 (dev 전용, 빌드 미포함) */
function serveLocalPdfs(): Plugin {
  return {
    name: "serve-local-pdfs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/local-pdfs", (req, res, next) => {
        const fileName = (req.url || "/").replace(/^\//, "");
        const filePath = path.join(__dirname, "local-pdfs", fileName);
        if (fileName && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          res.setHeader("Content-Type", "application/pdf");
          fs.createReadStream(filePath).pipe(res);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: "/campusbook-viewer-ai/", // 본인 리포 이름으로 교체, 또는 './' 사용
    plugins: [react(), tailwindcss(), removeSourcemaps(), serveLocalPdfs()],
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    server: {
      port: 5173,
      proxy: {
        "/pdf_proxy": {
          target: "https://d19t5saodanwfx.cloudfront.net",
          changeOrigin: true,
          rewrite: (proxy_path) => proxy_path.replace(/^\/pdf_proxy/, ""),
        },
      },
    },
    resolve: { alias: { "@": path.resolve(__dirname, ".") } },
    build: {
      sourcemap: false,
    },
    css: {
      devSourcemap: false,
    },
  };
});
