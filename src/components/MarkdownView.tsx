import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

export default function MarkdownView({ src }: { src: string }) {
  const html = useMemo(() => renderMarkdown(src), [src]);
  // renderMarkdown은 html:false로 원문 HTML을 이스케이프 — 주입 경계는 파서 쪽.
  return <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
