import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "./styles/global.scss";
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
// 로컬 테스트 설정:
// 미리보기:        { isPreview: true,  startOfPages: 1, endOfPages: 14 }
// 뉴논문 관련 링크: { isPreview: true,  startOfPages: 0, endOfPages: 0  }
// 일반 도서:       { isPreview: false }
(window as any).__RMS_CONFIG__ = {
  isPreview: true,
  startOfPages: 1,
  endOfPages: 14,
};
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
