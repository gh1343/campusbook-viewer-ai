import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  return {
    base: "/campusbook-viewer-ai/", // 본인 리포 이름으로 교체, 또는 './' 사용
    plugins: [react(), tailwindcss()],
    define: {
      "process.env.API_KEY": JSON.stringify(env.GEMINI_API_KEY),
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    server: {
      proxy: {
        "/pdf_proxy": {
          target: "https://d19t5saodanwfx.cloudfront.net",
          changeOrigin: true,
          rewrite: (proxy_path) => proxy_path.replace(/^\/pdf_proxy/, ""),
        },
      },
    },
    resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  };
});
