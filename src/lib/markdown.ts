// 로드스타 서버의 lib/markdown.ts 포팅 — 같은 파서·같은 옵션이라 회의록 본문
// 렌더 결과가 웹과 일치한다. html:false가 보안 경계(원문 HTML 이스케이프,
// javascript: 링크 차단). 코드 복사 버튼만 데스크톱에선 뺐다.
import MarkdownIt from "markdown-it";
import katex from "@vscode/markdown-it-katex";
import hljs from "highlight.js/lib/common";

function highlightFence(str: string, lang: string): string {
  const inner =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      : md.utils.escapeHtml(str);
  return `<pre class="code-block hljs"><code class="language-${md.utils.escapeHtml(lang || "")}">${inner}</code></pre>`;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight: highlightFence,
});

md.use(katex, { throwOnError: false, enableFencedBlocks: true });

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, idx, options);
};

const defaultImageRule = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("loading", "lazy");
  return defaultImageRule(tokens, idx, options, env, self);
};

export function renderMarkdown(src: string): string {
  return md.render(src ?? "");
}
