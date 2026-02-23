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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: "/campusbook-viewer-ai/", // 본인 리포 이름으로 교체, 또는 './' 사용
    plugins: [react(), tailwindcss(), removeSourcemaps()],
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
