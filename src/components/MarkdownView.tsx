import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "../lib/markdown";

export default function MarkdownView({ src }: { src: string }) {
  const html = useMemo(() => renderMarkdown(src), [src]);
  // renderMarkdown은 html:false로 원문 HTML을 이스케이프 — 주입 경계는 파서 쪽.
  // 외부 링크는 웹뷰 안이 아니라 기본 브라우저로 연다(target=_blank는 Tauri에서 무동작).
  return (
    <div
      className="doc-body"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (a?.href && /^https?:/i.test(a.href)) {
          e.preventDefault();
          void openUrl(a.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
