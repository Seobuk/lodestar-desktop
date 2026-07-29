import { getDb } from "./db";

export const DEFAULT_SERVER = "https://lodestar-rho.vercel.app";

/** 이 빌드가 통신할 수 있는 서버(빌드 타임 capability 스코프의 미러).
 *  목록 밖 주소를 저장하면 plugin-http가 요청 자체를 거부해 영원한 '오프라인'이
 *  되므로 설정 화면에서 사전 검증한다. 바꾸려면 capabilities/default.json도 함께. */
export const ALLOWED_SERVERS = [
  "https://lodestar-rho.vercel.app",
  "http://localhost:3000",
];

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
