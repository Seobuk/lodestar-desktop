// 클라이언트 생성 id — cuid 호환(c + 소문자/숫자 24자). 서버의
// CLIENT_ID_RE(/^c[a-z0-9]{8,32}$/)와 맞물리며, 오프라인에서 만든 행이
// 서버 push 때 id 그대로 생성되므로 temp-id 리매핑이 필요 없다.
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = "c";
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}
