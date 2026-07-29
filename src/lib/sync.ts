import { fetch } from "@tauri-apps/plugin-http";
import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "./db";
import { notify } from "./store";
import { getMeta, setMeta, DEFAULT_SERVER } from "./settings";
import { applyOpLocal } from "./localops";
import type { SyncOp } from "./types";

// 동기화 엔진 — 설계는 "push 후 전체 pull":
//  1) push: 오프라인 작업큐(oplog)를 순서대로 서버에 replay. 서버 op는 멱등이라
//     네트워크가 중간에 끊겨도 다음 시도에 안전하게 재전송된다. 서버가 ok:false로
//     거절한 op(검증 실패 등)는 큐에서 빼고 오류만 표시한다 — 안 될 op가 큐를 막지 않게.
//  2) pull: 전체 상태를 받아 로컬 테이블을 통째로 교체(커서·톰스톤 없음, 삭제 전파 공짜).
//  3) pull 도중 새로 쌓인 로컬 op를 다시 로컬 적용(교체로 지워졌을 수 있으니).
// 충돌은 last-write-wins — 개인·소규모 팀 사용이라 CRDT는 YAGNI.

export type SyncStatus =
  | "idle"
  | "unconfigured"
  | "syncing"
  | "ok"
  | "offline"
  | "error";

export const syncState: {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingOps: number;
  errors: string[];
} = { status: "idle", lastSyncAt: null, pendingOps: 0, errors: [] };

/** 모든 로컬 변경의 단일 입구: 로컬 적용 → 큐 적재 → UI 갱신 → 동기화 예약. */
export async function dispatch(op: SyncOp): Promise<void> {
  await applyOpLocal(op);
  const db = await getDb();
  await db.execute("INSERT INTO oplog (op, createdAt) VALUES ($1, $2)", [
    JSON.stringify(op),
    new Date().toISOString(),
  ]);
  syncState.pendingOps += 1;
  notify();
  scheduleSync(1500);
}

let timer: number | undefined;
export function scheduleSync(delay = 0): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

let syncing = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  if (syncing) {
    rerun = true;
    return;
  }
  syncing = true;
  try {
    const token = await getMeta("token");
    if (!token) {
      syncState.status = "unconfigured";
      return;
    }
    syncState.status = "syncing";
    syncState.errors = [];
    notify();

    const server = (await getMeta("serverUrl")) || DEFAULT_SERVER;
    const base = server.replace(/\/+$/, "") + "/api/publish/project-sync";
    const db = await getDb();

    // 1) push — 400개씩(서버 MAX_OPS 500 이내)
    for (;;) {
      const rows = await db.select<{ seq: number; op: string }[]>(
        "SELECT seq, op FROM oplog ORDER BY seq LIMIT 400",
      );
      if (rows.length === 0) break;
      const res = await fetch(base, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ops: rows.map((r) => JSON.parse(r.op)) }),
      });
      if (!res.ok) throw new Error(`push HTTP ${res.status}`);
      const out = (await res.json()) as {
        results: ({ ok: true } | { ok: false; error: string })[];
      };
      for (const r of out.results) if (!r.ok) syncState.errors.push(r.error);
      // 전송된 범위만 삭제 — fetch 동안 쌓인 새 op는 seq가 더 커서 남는다.
      await db.execute("DELETE FROM oplog WHERE seq <= $1", [
        rows[rows.length - 1].seq,
      ]);
    }

    // 2) pull — 전체 상태 교체
    const res = await fetch(base, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`pull HTTP ${res.status}`);
    const snap = (await res.json()) as Snapshot;
    await replaceAll(db, snap);

    // 3) pull 동안 쌓인 로컬 op 재적용
    const rest = await db.select<{ op: string }[]>(
      "SELECT op FROM oplog ORDER BY seq",
    );
    for (const r of rest) await applyOpLocal(JSON.parse(r.op) as SyncOp);

    syncState.lastSyncAt = new Date().toISOString();
    await setMeta("lastSyncAt", syncState.lastSyncAt);
    syncState.status = syncState.errors.length ? "error" : "ok";
  } catch (e) {
    // 네트워크·서버 오류 — 큐를 보존한 채 다음 주기에 재시도(멱등이라 안전)
    console.warn("sync 실패:", e);
    syncState.status = "offline";
  } finally {
    try {
      const db = await getDb();
      const n = await db.select<{ n: number }[]>(
        "SELECT COUNT(*) n FROM oplog",
      );
      syncState.pendingOps = n[0]?.n ?? 0;
    } catch {
      /* 카운트 실패는 무시 */
    }
    syncing = false;
    notify();
    if (rerun) {
      rerun = false;
      scheduleSync(500);
    }
  }
}

let autoStarted = false;
export function startAutoSync(): void {
  if (autoStarted) return;
  autoStarted = true;
  void getMeta("lastSyncAt").then((v) => {
    if (v) {
      syncState.lastSyncAt = v;
      notify();
    }
  });
  scheduleSync(0);
  window.setInterval(() => scheduleSync(0), 30_000);
  window.addEventListener("online", () => scheduleSync(0));
}

// ----- pull 스냅숏 → 로컬 교체 -------------------------------------------

type Snapshot = {
  serverTime: string;
  projects: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  meetings: Record<string, unknown>[];
  deadlineItems: Record<string, unknown>[];
};

async function replaceAll(db: Database, snap: Snapshot): Promise<void> {
  // ⚠️ BEGIN/COMMIT 금지 — tauri plugin-sql은 연결 풀이라 BEGIN과 후속 쿼리가
  // 다른 연결로 나가 DB가 잠긴다(앱 전체 멈춤, 실측). 교체가 원자적이지 않아도
  // 로컬은 미러일 뿐이고 다음 pull이 다시 채우므로 무방하다.
  await db.execute("DELETE FROM projects");
  await db.execute("DELETE FROM tasks");
  await db.execute("DELETE FROM meetings");
  await db.execute("DELETE FROM deadline_items");
    for (const p of snap.projects)
      await db.execute(
        "INSERT INTO projects (id, name, description, deadline, status, orderIndex, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          p.id,
          p.name,
          p.description ?? "",
          p.deadline ?? null,
          p.status ?? "active",
          p.orderIndex ?? 0,
          p.createdAt ?? null,
          p.updatedAt ?? null,
        ],
      );
    for (const t of snap.tasks)
      await db.execute(
        "INSERT INTO tasks (id, projectId, parentId, title, description, deadline, status, progress, startDate, endDate, durationDays, isMilestone, orderIndex, createdAt, updatedAt, trashedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          t.id,
          t.projectId,
          t.parentId ?? null,
          t.title,
          t.description ?? "",
          t.deadline ?? null,
          t.status ?? "todo",
          t.progress ?? 0,
          t.startDate ?? null,
          t.endDate ?? null,
          t.durationDays ?? null,
          t.isMilestone ? 1 : 0,
          t.orderIndex ?? 0,
          t.createdAt ?? null,
          t.updatedAt ?? null,
          t.trashedAt ?? null,
        ],
      );
    for (const m of snap.meetings)
      await db.execute(
        "INSERT INTO meetings (id, projectId, taskId, title, body, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          m.id,
          m.projectId,
          m.taskId ?? null,
          m.title,
          m.body ?? "",
          m.createdAt ?? null,
          m.updatedAt ?? null,
        ],
      );
    for (const dl of snap.deadlineItems)
      await db.execute(
        "INSERT INTO deadline_items (id, taskId, projectId, date, content, orderIndex, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          dl.id,
          dl.taskId ?? null,
          dl.projectId ?? null,
          dl.date,
          dl.content ?? "",
          dl.orderIndex ?? 0,
          dl.createdAt ?? null,
          dl.updatedAt ?? null,
        ],
      );
}
