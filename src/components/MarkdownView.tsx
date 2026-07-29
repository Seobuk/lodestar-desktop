import { useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "../lib/markdown";
import { getMeta, DEFAULT_SERVER } from "../lib/settings";

export default function MarkdownView({ src }: { src: string }) {
  const html = useMemo(() => renderMarkdown(src), [src]);
  // renderMarkdown은 html:false로 원문 HTML을 이스케이프 — 주입 경계는 파서 쪽.
  // 링크는 raw href 기준으로 처리한다: a.href는 웹뷰 오리진(tauri.localhost)으로
  // 절대화돼 상대 링크(📎 첨부 `/api/attachments/..`, 웹에서 복사한 `/p/..`)가
  // 죽은 주소가 되기 때문. 상대 경로는 서버 주소를 붙여 기본 브라우저로 연다
  // (첨부는 세션 인증이라 로그인된 브라우저에서 열려야 맞다).
  return (
    <div
      className="doc-body"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        const href = a?.getAttribute("href");
        if (!a || !href) return;
        e.preventDefault();
        if (href.startsWith("/")) {
          void getMeta("serverUrl").then((server) =>
            openUrl((server || DEFAULT_SERVER).replace(/\/+$/, "") + href),
          );
        } else if (/^(https?:|mailto:|tel:)/i.test(href)) {
          void openUrl(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
