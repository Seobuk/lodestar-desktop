import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "./db";
import { newId } from "./ids";

// 회의록 녹음 저장소 — 로컬 SQLite에 base64로 담는다(파일시스템 플러그인 없이).
// ponytail: 1시간 opus ≈ 14MB(base64 19MB) — IPC 한 번에 저장/로드 가능한 크기.
// 동기화하지 않는다(서버 무료 1GB 보호) — 받아쓰기 텍스트만 본문으로 동기화된다.

export type RecordingMeta = {
  id: string;
  meetingKey: string;
  mime: string;
  durationSec: number;
  createdAt: string | null;
};

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export async function saveRecording(
  meetingKey: string,
  blob: Blob,
  durationSec: number,
): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.execute(
    "INSERT INTO recordings (id, meetingKey, mime, durationSec, data, createdAt) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      id,
      meetingKey,
      blob.type || "audio/webm",
      durationSec,
      await blobToBase64(blob),
      new Date().toISOString(),
    ],
  );
  return id;
}

/** 목록은 data(수 MB) 없이 메타만 읽는다. */
export async function listRecordings(
  db: Database,
  meetingKey: string,
): Promise<RecordingMeta[]> {
  return db.select<RecordingMeta[]>(
    "SELECT id, meetingKey, mime, durationSec, createdAt FROM recordings WHERE meetingKey = $1 ORDER BY createdAt",
    [meetingKey],
  );
}

export async function loadRecordingUrl(id: string): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ data: string; mime: string }[]>(
    "SELECT data, mime FROM recordings WHERE id = $1",
    [id],
  );
  const r = rows[0];
  if (!r) throw new Error("녹음을 찾을 수 없습니다.");
  const bin = atob(r.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: r.mime }));
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM recordings WHERE id = $1", [id]);
}

/** 새 회의록 저장 시 임시 키(초안) → 실제 회의록 id로 녹음을 이전. */
export async function rekeyRecordings(
  oldKey: string,
  newKey: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE recordings SET meetingKey = $2 WHERE meetingKey = $1",
    [oldKey, newKey],
  );
}
