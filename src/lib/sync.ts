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
//     거절한 op(검증 실패·충돌 보호장치)는 큐에서 빼고 오류만 표시한다.
//  2) pull: 전체 상태를 받아 로컬 테이블을 통째로 교체(커서·톰스톤 없음).
//     ⚠️ BEGIN/COMMIT 금지 — tauri plugin-sql은 연결 풀이라 DB가 잠긴다(실측).
//  3) pull 도중 새로 쌓인 로컬 op를 다시 로컬 적용.
// 충돌: 내용성 엔티티(프로젝트 설명·회의록·개인 글·메모·서재)는 base(마지막 pull의
// updatedAt)를 실어 보내 서버가 더 새로우면 덮지 않고 경고(+회의록·글·메모는
// '(오프라인 사본)'으로 보존). 그 외(업무·마감·카드)는 last-write-wins.
// 엔드포인트 2개: 프로젝트(project-sync) + 개인(personal-sync, hasPersonalPage
// 없으면 403 → 개인 탭 숨김·개인 op 폐기).

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

const PERSONAL_ENTITIES = new Set(["card", "note", "post", "libitem"]);

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
    const root = server.replace(/\/+$/, "");
    const projUrl = root + "/api/publish/project-sync";
    const persUrl = root + "/api/publish/personal-sync";
    const db = await getDb();

    // 1) push — 400개씩(서버 MAX_OPS 500 이내), 엔티티별 엔드포인트로 분배
    for (;;) {
      const rows = await db.select<{ seq: number; op: string }[]>(
        "SELECT seq, op FROM oplog ORDER BY seq LIMIT 400",
      );
      if (rows.length === 0) break;
      const proj: typeof rows = [];
      const pers: typeof rows = [];
      for (const r of rows)
        (PERSONAL_ENTITIES.has((JSON.parse(r.op) as SyncOp).entity)
          ? pers
          : proj
        ).push(r);
      if (proj.length) await pushBatch(db, projUrl, token, proj, false);
      if (pers.length) await pushBatch(db, persUrl, token, pers, true);
    }

    // 2) pull — 전체 상태 교체
    const auth = { Authorization: `Bearer ${token}` };
    const res = await fetch(projUrl, { headers: auth });
    if (!res.ok) throw new Error(`pull HTTP ${res.status}`);
    await replaceProject(db, (await res.json()) as ProjectSnapshot);

    const pres = await fetch(persUrl, { headers: auth });
    if (pres.status === 403) {
      await setMeta("personalEnabled", "0"); // 권한 없음 — 개인 탭 숨김
    } else if (pres.ok) {
      await replacePersonal(db, (await pres.json()) as PersonalSnapshot);
      await setMeta("personalEnabled", "1");
    } else {
      throw new Error(`personal pull HTTP ${pres.status}`);
    }

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

/** 한 배치를 한 엔드포인트로 push하고 그 seq들만 큐에서 지운다. */
async function pushBatch(
  db: Database,
  url: string,
  token: string,
  rows: { seq: number; op: string }[],
  personal: boolean,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ops: rows.map((r) => JSON.parse(r.op)) }),
  });
  const seqs = rows.map((r) => r.seq).join(",");
  if (personal && res.status === 403) {
    // 개인 페이지 권한 없음 — 해당 op 폐기(영원히 안 될 op가 큐를 막지 않게)
    await setMeta("personalEnabled", "0");
    syncState.errors.push(
      "개인 페이지 권한이 없어 개인 데이터 변경을 보내지 못했습니다.",
    );
    await db.execute(`DELETE FROM oplog WHERE seq IN (${seqs})`);
    return;
  }
  if (!res.ok) throw new Error(`push HTTP ${res.status}`);
  const out = (await res.json()) as {
    results: ({ ok: true } | { ok: false; error: string })[];
  };
  for (const r of out.results) if (!r.ok) syncState.errors.push(r.error);
  // 실패 op도 큐에서 뺀다 — 오류는 상태줄·설정에 표시.
  await db.execute(`DELETE FROM oplog WHERE seq IN (${seqs})`);
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

type Row = Record<string, unknown>;
type ProjectSnapshot = {
  projects: Row[];
  tasks: Row[];
  meetings: Row[];
  deadlineItems: Row[];
};
type PersonalSnapshot = {
  cards: Row[];
  notes: Row[];
  posts: Row[];
  libraryCollections: Row[];
  libraryItems: Row[];
  tagColors: Record<string, string>;
};

async function replaceProject(db: Database, snap: ProjectSnapshot): Promise<void> {
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

async function replacePersonal(db: Database, snap: PersonalSnapshot): Promise<void> {
  await db.execute("DELETE FROM personal_cards");
  await db.execute("DELETE FROM personal_notes");
  await db.execute("DELETE FROM personal_posts");
  await db.execute("DELETE FROM library_collections");
  await db.execute("DELETE FROM library_items");
  for (const c of snap.cards)
    await db.execute(
      "INSERT INTO personal_cards (id, title, status, checklist, color, postit, orderIndex, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        c.id,
        c.title,
        c.status ?? "todo",
        JSON.stringify(c.checklist ?? []),
        c.color ?? null,
        c.postit ?? null,
        c.orderIndex ?? 0,
        c.createdAt ?? null,
        c.updatedAt ?? null,
      ],
    );
  for (const n of snap.notes)
    await db.execute(
      "INSERT INTO personal_notes (id, title, body, items, color, labels, pinned, archived, orderIndex, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        n.id,
        n.title ?? "",
        n.body ?? "",
        JSON.stringify(n.items ?? []),
        n.color ?? "default",
        JSON.stringify(n.labels ?? []),
        n.pinned ? 1 : 0,
        n.archived ? 1 : 0,
        n.orderIndex ?? 0,
        n.createdAt ?? null,
        n.updatedAt ?? null,
      ],
    );
  for (const p of snap.posts)
    await db.execute(
      "INSERT INTO personal_posts (id, title, body, pinned, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        p.id,
        p.title,
        p.body ?? "",
        p.pinned ? 1 : 0,
        p.createdAt ?? null,
        p.updatedAt ?? null,
      ],
    );
  for (const c of snap.libraryCollections)
    await db.execute(
      "INSERT INTO library_collections (id, name, parentId, createdAt) VALUES ($1,$2,$3,$4)",
      [c.id, c.name, c.parentId ?? null, c.createdAt ?? null],
    );
  for (const it of snap.libraryItems)
    await db.execute(
      "INSERT INTO library_items (id, collectionId, itemType, title, authors, year, venue, volume, issue, pages, publisher, doi, url, abstract, tags, note, fileUrl, fileName, deletedAt, createdAt, updatedAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)",
      [
        it.id,
        it.collectionId ?? null,
        it.itemType ?? "document",
        it.title,
        it.authors ?? null,
        it.year ?? null,
        it.venue ?? null,
        it.volume ?? null,
        it.issue ?? null,
        it.pages ?? null,
        it.publisher ?? null,
        it.doi ?? null,
        it.url ?? null,
        it.abstract ?? null,
        JSON.stringify(it.tags ?? []),
        it.note ?? null,
        it.fileUrl ?? null,
        it.fileName ?? null,
        it.deletedAt ?? null,
        it.createdAt ?? null,
        it.updatedAt ?? null,
      ],
    );
  await setMeta("tagColors", JSON.stringify(snap.tagColors ?? {}));
}
