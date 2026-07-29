import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
