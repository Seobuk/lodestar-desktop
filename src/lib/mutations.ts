import { newId } from "./ids";
import { getDb } from "./db";
import { notify } from "./store";
import { applyOpLocal } from "./localops";
import { dispatch, scheduleSync, syncState } from "./sync";
import type { SyncOp } from "./types";

// UI가 부르는 뮤테이션 — op 모양(서버 applyOp 계약)을 한 곳에 모은다.
// 전부 dispatch(로컬 적용 + 큐 적재 + 동기화 예약)를 거친다.

/** 충돌 보호장치(base)를 붙이는 내용성 엔티티. task·deadline·card는 잦은 필드
 *  변경(간트 트리·드래그 순서)이라 LWW 유지 — 가짜 충돌 경고를 피한다. */
const BASE_ENTITIES = new Set<SyncOp["entity"]>([
  "project",
  "meeting",
  "post",
  "note",
  "libitem",
]);

/**
 * update op의 단일 입구. 큐에 같은 행의 update op가 있으면 병합(디바운스 편집이
 * 큐를 불리지 않게 + base는 최초 것 유지), 같은 행의 create op가 대기 중이면
 * base 생략(서버 create 직후 updatedAt과 비교하면 가짜 충돌). 그 외엔 로컬
 * updatedAt(=마지막 pull의 서버 값, 로컬 생성 행은 NULL)을 base로 싣는다.
 */
async function dispatchUpdate(
  entity: SyncOp["entity"],
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ seq: number; op: string }[]>(
    "SELECT seq, op FROM oplog ORDER BY seq",
  );
  let hasCreate = false;
  for (const r of rows) {
    const q = JSON.parse(r.op) as SyncOp;
    if (q.entity !== entity || q.id !== id) continue;
    if (q.action === "create") {
      hasCreate = true;
      continue;
    }
    if (q.action === "update") {
      q.data = { ...q.data, ...data };
      await db.execute("UPDATE oplog SET op = $1 WHERE seq = $2", [
        JSON.stringify(q),
        r.seq,
      ]);
      await applyOpLocal({ entity, action: "update", id, data });
      notify();
      scheduleSync(1500);
      return;
    }
  }
  let base: string | undefined;
  if (!hasCreate && BASE_ENTITIES.has(entity)) {
    const row = await db.select<{ updatedAt: string | null }[]>(
      `SELECT updatedAt FROM ${table} WHERE id = $1`,
      [id],
    );
    base = row[0]?.updatedAt ?? undefined;
  }
  await dispatch({ entity, action: "update", id, data, ...(base ? { base } : {}) });
}

// ----- 프로젝트 ----------------------------------------------------------

export async function addProject(name: string): Promise<string> {
  const id = newId();
  await dispatch({ entity: "project", action: "create", id, data: { name } });
  return id;
}

export async function updateProjectFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("project", "projects", id, data);
}

export async function addTask(
  projectId: string,
  parentId: string | null,
  title: string,
): Promise<string> {
  const id = newId();
  await dispatch({
    entity: "task",
    action: "create",
    id,
    data: { projectId, parentId, title },
  });
  return id;
}

export async function updateTaskFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("task", "tasks", id, data);
}

export async function trashTask(id: string): Promise<void> {
  await dispatch({ entity: "task", action: "trash", id });
}

export async function restoreTask(id: string): Promise<void> {
  await dispatch({ entity: "task", action: "restore", id });
}

/** 간트의 전체 WBS 트리 저장. 큐에 남은 같은 프로젝트의 이전 tree op와 병합
 *  (디바운스 저장이 큐를 무한히 불리지 않게) — deletedIds는 합집합으로 승계. */
export async function syncTaskTree(
  projectId: string,
  tree: unknown[],
  deletedIds: string[],
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ seq: number; op: string }[]>(
    "SELECT seq, op FROM oplog",
  );
  const merged = new Set(deletedIds);
  const stale: number[] = [];
  for (const r of rows) {
    const op = JSON.parse(r.op) as {
      entity?: string;
      action?: string;
      data?: { projectId?: string; deletedIds?: string[] };
    };
    if (
      op.entity === "task" &&
      op.action === "tree" &&
      op.data?.projectId === projectId
    ) {
      stale.push(r.seq);
      for (const x of op.data.deletedIds ?? []) merged.add(x);
    }
  }
  if (stale.length)
    await db.execute(`DELETE FROM oplog WHERE seq IN (${stale.join(",")})`);
  await dispatch({
    entity: "task",
    action: "tree",
    data: { projectId, tree, deletedIds: [...merged] },
  });
  const n = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM oplog");
  syncState.pendingOps = n[0]?.n ?? 0;
  notify();
}

// ----- 회의록·마감 --------------------------------------------------------

export async function addMeeting(
  projectId: string,
  title: string,
  body: string,
  taskId: string | null,
): Promise<string> {
  const id = newId();
  await dispatch({
    entity: "meeting",
    action: "create",
    id,
    data: { projectId, title, body, taskId },
  });
  return id;
}

export async function updateMeetingFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("meeting", "meetings", id, data);
}

export async function removeMeeting(id: string): Promise<void> {
  await dispatch({ entity: "meeting", action: "delete", id });
}

export async function addDeadline(
  scopeType: "project" | "task",
  scopeId: string,
  date: string,
  content: string,
): Promise<string> {
  const id = newId();
  await dispatch({
    entity: "deadline",
    action: "create",
    id,
    data: { scopeType, scopeId, date, content },
  });
  return id;
}

export async function updateDeadlineFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("deadline", "deadline_items", id, data);
}

export async function removeDeadline(id: string): Promise<void> {
  await dispatch({ entity: "deadline", action: "delete", id });
}

// ----- 개인: 칸반 카드 ----------------------------------------------------

export async function addCard(title: string, status: string): Promise<string> {
  const id = newId();
  await dispatch({ entity: "card", action: "create", id, data: { title, status } });
  return id;
}

export async function updateCardFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("card", "personal_cards", id, data);
}

export async function removeCard(id: string): Promise<void> {
  await dispatch({ entity: "card", action: "delete", id });
}

// ----- 개인: 메모(Keep) ---------------------------------------------------

export async function addNote(data: {
  title?: string;
  body?: string;
  items?: { text: string; done: boolean }[];
  color?: string;
  pinned?: boolean;
}): Promise<string> {
  const id = newId();
  await dispatch({ entity: "note", action: "create", id, data });
  return id;
}

export async function updateNoteFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("note", "personal_notes", id, data);
}

export async function removeNote(id: string): Promise<void> {
  await dispatch({ entity: "note", action: "delete", id });
}

// ----- 개인: 게시판 -------------------------------------------------------

export async function addPost(
  title: string,
  body: string,
  pinned: boolean,
): Promise<string> {
  const id = newId();
  await dispatch({
    entity: "post",
    action: "create",
    id,
    data: { title, body, pinned },
  });
  return id;
}

export async function updatePostFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("post", "personal_posts", id, data);
}

export async function removePost(id: string): Promise<void> {
  await dispatch({ entity: "post", action: "delete", id });
}

// ----- 개인: 서재 ---------------------------------------------------------

export async function addLibItem(
  input: string,
  collectionId: string | null,
): Promise<string> {
  const id = newId();
  await dispatch({
    entity: "libitem",
    action: "create",
    id,
    data: { input, collectionId },
  });
  return id;
}

export async function updateLibItemFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatchUpdate("libitem", "library_items", id, data);
}

/** 휴지통 이동/복원 — 서버 updateItem의 trash/restore 액션 플래그 재사용. */
export async function trashLibItem(id: string): Promise<void> {
  await dispatchUpdate("libitem", "library_items", id, { trash: true });
}

export async function restoreLibItem(id: string): Promise<void> {
  await dispatchUpdate("libitem", "library_items", id, { restore: true });
}

export async function removeLibItem(id: string): Promise<void> {
  await dispatch({ entity: "libitem", action: "delete", id });
}
