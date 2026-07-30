import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// dragDropEnabled:false로 Tauri 파일드랍 인터셉트를 껐으므로(칸반 HTML5 드래그를
// 위해), 외부 파일을 창에 떨어뜨렸을 때 웹뷰가 그 파일로 이동해버리는 기본 동작을
// 전역에서 막는다. 칸반 컬럼 등 개별 드롭존은 자체 핸들러가 먼저 처리한다.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
import "pretendard/dist/web/variable/pretendardvariable.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
