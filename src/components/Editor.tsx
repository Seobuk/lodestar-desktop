import { useLayoutEffect, useRef, useState } from "react";
import MarkdownView from "./MarkdownView";
import { uploadImage } from "../lib/api-image";

// 마크다운 본문 에디터 — 웹(MarkdownTextarea)과 같은 "편집 ↔ 미리보기 토글"에
// 서식 도구모음(업노트식 — 문법을 대신 넣어준다), 스마트 리스트(Enter 마커 연속·
// 빈 항목 탈출, Tab/Shift+Tab 들여쓰기), Ctrl+B/I/K 단축키, Ctrl+S 저장,
// 이미지 붙여넣기 업로드(온라인 전용)를 더했다. 저장 포맷은 순수 마크다운이라
// 웹과 완전 호환.
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
      taRef.current.focus();
      taRef.current.setSelectionRange(s, e);
      caretRef.current = null;
    }
  });

  const apply = (next: string, selStart: number, selEnd = selStart) => {
    caretRef.current = [selStart, selEnd];
    onChange(next);
  };

  // ----- 서식 도구 -------------------------------------------------------

  const sel = (): [number, number] => {
    const ta = taRef.current;
    return ta ? [ta.selectionStart, ta.selectionEnd] : [value.length, value.length];
  };

  /** 선택을 before/after로 감싼다. 선택이 없으면 placeholder를 넣고 선택해 준다. */
  const wrap = (before: string, after: string, ph: string) => {
    const [s, e] = sel();
    const inner = value.slice(s, e) || ph;
    const next = value.slice(0, s) + before + inner + after + value.slice(e);
    apply(next, s + before.length, s + before.length + inner.length);
  };

  /** 선택 범위가 걸친 줄들의 시작·끝 오프셋. */
  const lineRange = (): [number, number] => {
    const [s, e] = sel();
    const ls = value.lastIndexOf("\n", s - 1) + 1;
    let le = value.indexOf("\n", e);
    if (le === -1) le = value.length;
    return [ls, le];
  };

  /** 줄 접두사 토글 — 모든 줄에 있으면 제거, 아니면 (기존 리스트 마커를 걷어내고) 추가.
   *  numbered=true면 1. 2. 3. 순번을 붙인다. */
  const togglePrefix = (prefix: string, numbered = false) => {
    const [ls, le] = lineRange();
    const lines = value.slice(ls, le).split("\n");
    const strip = (l: string) =>
      l.replace(/^(\s*)([-*+]\s(\[[ xX]\]\s)?|\d+[.)]\s|>\s)/, "$1");
    const has = (l: string) =>
      numbered ? /^\s*\d+[.)]\s/.test(l) : l.trimStart().startsWith(prefix);
    const allHave = lines.every((l) => !l.trim() || has(l));
    const out = lines
      .map((l, i) => {
        if (!l.trim()) return l;
        const bare = strip(l);
        if (allHave) return bare;
        const ws = /^\s*/.exec(bare)?.[0] ?? "";
        const body = bare.slice(ws.length);
        return ws + (numbered ? `${i + 1}. ` : prefix) + body;
      })
      .join("\n");
    apply(value.slice(0, ls) + out + value.slice(le), ls, ls + out.length);
  };

  /** 제목 순환: 없음 → # → ## → ### → 없음 (캐럿이 있는 줄). */
  const cycleHeading = () => {
    const [ls, le] = lineRange();
    const firstEnd = value.indexOf("\n", ls);
    const end = firstEnd === -1 || firstEnd > le ? le : firstEnd;
    const line = value.slice(ls, end);
    const m = /^(#{1,6})\s/.exec(line);
    const level = m ? m[1].length : 0;
    const bare = line.replace(/^#{1,6}\s/, "");
    const out = level >= 3 ? bare : "#".repeat(level + 1) + " " + bare;
    apply(value.slice(0, ls) + out + value.slice(end), ls + out.length);
  };

  const insertBlock = (text: string) => {
    const [s] = sel();
    const needNL = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
    const next = value.slice(0, s) + needNL + text + value.slice(s);
    apply(next, s + needNL.length + text.length);
  };

  const codeTool = () => {
    const [s, e] = sel();
    const inner = value.slice(s, e);
    if (inner.includes("\n")) wrap("```\n", "\n```", "");
    else wrap("`", "`", "코드");
  };

  const linkTool = () => {
    const [s, e] = sel();
    const inner = value.slice(s, e) || "링크 텍스트";
    const next =
      value.slice(0, s) + "[" + inner + "](url)" + value.slice(e);
    const urlStart = s + inner.length + 3; // "[inner](" 뒤
    apply(next, urlStart, urlStart + 3); // "url" 선택 — 바로 주소 입력
  };

  const TOOLS: { label: string; title: string; run: () => void }[] = [
    { label: "H", title: "제목 (반복 클릭으로 # → ## → ###)", run: cycleHeading },
    { label: "B", title: "굵게 (Ctrl+B)", run: () => wrap("**", "**", "굵게") },
    { label: "I", title: "기울임 (Ctrl+I)", run: () => wrap("*", "*", "기울임") },
    { label: "S", title: "취소선", run: () => wrap("~~", "~~", "취소선") },
    { label: "•", title: "글머리 목록", run: () => togglePrefix("- ") },
    { label: "1.", title: "번호 목록", run: () => togglePrefix("", true) },
    { label: "☑", title: "체크박스", run: () => togglePrefix("- [ ] ") },
    { label: "❝", title: "인용", run: () => togglePrefix("> ") },
    { label: "‹›", title: "코드 (선택이 여러 줄이면 코드블록)", run: codeTool },
    { label: "—", title: "구분선", run: () => insertBlock("\n---\n") },
    { label: "🔗", title: "링크 (Ctrl+K)", run: linkTool },
    { label: "ƒx", title: "수식 (KaTeX, $…$)", run: () => wrap("$", "$", "E=mc^2") },
    {
      label: "⊞",
      title: "표 삽입",
      run: () =>
        insertBlock("\n| 항목 | 값 |\n| --- | --- |\n|  |  |\n"),
    },
  ];

  // ----- 키 입력 ---------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        onSave?.();
        return;
      }
      if (k === "b") {
        e.preventDefault();
        wrap("**", "**", "굵게");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        wrap("*", "*", "기울임");
        return;
      }
      if (k === "k") {
        e.preventDefault();
        linkTool();
        return;
      }
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
        {!preview && (
          <span className="editor-tools">
            {TOOLS.map((t) => (
              <button
                key={t.title}
                type="button"
                title={t.title}
                // 클릭이 textarea 포커스를 뺏지 않게 — 선택 영역 유지
                onMouseDown={(e) => e.preventDefault()}
                onClick={t.run}
              >
                {t.label}
              </button>
            ))}
          </span>
        )}
        <span className="editor-hint">
          {msg ?? "이미지 붙여넣기 · Ctrl+S 저장"}
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
