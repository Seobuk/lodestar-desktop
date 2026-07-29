import { fetch } from "@tauri-apps/plugin-http";
import { getMeta, DEFAULT_SERVER } from "./settings";

// 이미지 붙여넣기 업로드 — 서버 /api/publish/image(PAT Bearer, multipart `file`)
// 재사용. 서버가 1600px·WebP로 재인코딩해 wiki-images 버킷에 올리고 공개 URL을
// 돌려준다. 온라인 전용(오프라인 큐잉은 바이너리를 로컬에 쌓아야 해서 제외).
// multipart는 직접 조립한다 — plugin-http의 FormData 직렬화에 기대지 않기 위해.

export async function uploadImage(file: Blob, name: string): Promise<string> {
  const token = await getMeta("token");
  if (!token) throw new Error("API 토큰이 설정되지 않았습니다.");
  const server = (await getMeta("serverUrl")) || DEFAULT_SERVER;

  const boundary = "----lodestar" + Math.random().toString(36).slice(2);
  const type = file.type || "image/png";
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name.replace(/"/g, "")}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);

  const res = await fetch(
    server.replace(/\/+$/, "") + "/api/publish/image",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    },
  );
  const out = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!res.ok || !out.url) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out.url;
}
