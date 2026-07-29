import { useState } from "react";
import MarkdownView from "./MarkdownView";

/** 마크다운 본문 에디터 — 웹(MarkdownTextarea)과 같은 "편집 ↔ 미리보기 토글" 방식. */
export default function Editor({
  value,
  onChange,
  rows = 18,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="editor">
      <div className="editor-bar">
        <button
          type="button"
          className={preview ? "" : "on"}
          onClick={() => setPreview(false)}
        >
          편집
        </button>
        <button
          type="button"
          className={preview ? "on" : ""}
          onClick={() => setPreview(true)}
        >
          미리보기
        </button>
      </div>
      {preview ? (
        <div className="editor-preview">
          <MarkdownView src={value} />
        </div>
      ) : (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
