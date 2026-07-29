import { useLayoutEffect, useRef, useState } from "react";
import MarkdownView from "./MarkdownView";
import { uploadImage } from "../lib/api-image";

// 마크다운 본문 에디터 — 웹(MarkdownTextarea)과 같은 "편집 ↔ 미리보기 토글"에
// 스마트 리스트(Enter 마커 연속·빈 항목 탈출, Tab/Shift+Tab 들여쓰기)와
// Ctrl+S 저장, 이미지 붙여넣기 업로드(온라인 전용)를 더했다.
export default function Editor({
  value,
  onChange,
  rows = 18,
  placeholder,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  /** Ctrl+S — 부모의 저장 동작(비활성 조건은 부모가 판단). */
  onSave?: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef<[number, number] | null>(null);

  // 프로그램적 편집 후 캐럿 복원(제어 컴포넌트라 렌더 뒤에 잡아야 함)
  useLayoutEffect(() => {
    if (caretRef.current && taRef.current) {
      const [s, e] = caretRef.current;
      taRef.current.setSelectionRange(s, e);
      caretRef.current = null;
    }
  });

  const apply = (next: string, selStart: number, selEnd = selStart) => {
    caretRef.current = [selStart, selEnd];
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }
    if (e.nativeEvent.isComposing) return; // IME 조합 중엔 손대지 않는다
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if (e.key === "Tab") {
      e.preventDefault();
      const ls = value.lastIndexOf("\n", start - 1) + 1;
      const block = value.slice(ls, end);
      if (e.shiftKey) {
        const out = block.replace(/(^|\n) {1,2}/g, "$1");
        if (out === block) return;
        apply(value.slice(0, ls) + out + value.slice(end), ls, ls + out.length);
      } else {
        const out = block.replace(/(^|\n)/g, "$1  ");
        apply(value.slice(0, ls) + out + value.slice(end), ls, ls + out.length);
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && start === end) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const line = value.slice(lineStart, start);
      const m = /^(\s*)([-*+]|\d+[.)])\s(\[[ xX]\]\s)?(.*)$/.exec(line);
      if (!m) return;
      e.preventDefault();
      const [, ws, marker, check, rest] = m;
      if (!rest.trim()) {
        // 빈 리스트 항목에서 Enter → 마커 제거(리스트 탈출)
        apply(value.slice(0, lineStart) + value.slice(start), lineStart);
        return;
      }
      const num = /^\d+/.exec(marker);
      const nextMarker = num
        ? `${parseInt(num[0], 10) + 1}${marker.endsWith(")") ? ")" : "."}`
        : marker;
      const insert = `\n${ws}${nextMarker} ${check ? "[ ] " : ""}`;
      apply(
        value.slice(0, start) + insert + value.slice(start),
        start + insert.length,
      );
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!images.length) return;
    e.preventDefault();
    if (!navigator.onLine) {
      setMsg("이미지 업로드는 온라인에서만 가능합니다.");
      return;
    }
    setMsg("이미지 업로드 중…");
    try {
      for (const f of images) {
        const url = await uploadImage(f, f.name || "clipboard.png");
        const ta = taRef.current;
        const pos = ta ? ta.selectionStart : value.length;
        const insert = `![](${url})\n`;
        // onChange 이후의 최신 값을 써야 하므로 ref에서 직접 읽는다
        const cur = ta ? ta.value : value;
        apply(cur.slice(0, pos) + insert + cur.slice(pos), pos + insert.length);
      }
      setMsg(null);
    } catch (err) {
      setMsg(`이미지 업로드 실패: ${(err as Error).message}`);
    }
  };

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
        <span className="editor-hint">
          {msg ?? "이미지 붙여넣기 가능 · Ctrl+S 저장"}
        </span>
      </div>
      {preview ? (
        <div className="editor-preview">
          <MarkdownView src={value} />
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => void handlePaste(e)}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
