import { getDb } from "./db";
import type { SyncOp } from "./types";

// 서버 lib 헬퍼의 로컬 근사 — 오프라인 중에도 UI가 즉시 반영되도록 같은 op를
// 로컬 SQLite에 적용한다. 정확한 규칙(휴지통 배치 복원, 조상 복원, 검증)은
// 서버가 갖고 있고, 다음 pull이 로컬을 서버 상태로 교정한다.

const nowIso = () => new Date().toISOString();

export async function applyOpLocal(op: SyncOp): Promise<void> {
  const db = await getDb();
  const d = op.data ?? {};
  const kind = `${op.entity}.${op.action}`;

  switch (kind) {
    case "project.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM projects",
      );
      await db.execute(
        "INSERT OR IGNORE INTO projects (id, name, orderIndex, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $4)",
        [op.id, String(d.name ?? ""), (r[0]?.m ?? -1) + 1, nowIso()],
      );
      break;
    }
    case "project.update":
      await dynUpdate("projects", op.id!, d, [
        "name",
        "description",
        "deadline",
        "status",
        "orderIndex",
      ]);
      break;
    case "task.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM tasks WHERE projectId = $1 AND parentId IS $2 AND trashedAt IS NULL",
        [d.projectId, d.parentId ?? null],
      );
      await db.execute(
        "INSERT OR IGNORE INTO tasks (id, projectId, parentId, title, orderIndex, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        [
          op.id,
          d.projectId,
          d.parentId ?? null,
          String(d.title ?? ""),
          (r[0]?.m ?? -1) + 1,
          nowIso(),
        ],
      );
      break;
    }
    case "task.update":
      await dynUpdate("tasks", op.id!, d, [
        "title",
        "description",
        "deadline",
        "status",
        "startDate",
        "endDate",
        "durationDays",
        "isMilestone",
        "progress",
      ]);
      break;
    case "task.trash":
      await db.execute(
        `UPDATE tasks SET trashedAt = $2 WHERE trashedAt IS NULL AND id IN (
           WITH RECURSIVE dset(id) AS (
             SELECT $1
             UNION ALL
             SELECT t.id FROM tasks t JOIN dset ON t.parentId = dset.id
           ) SELECT id FROM dset)`,
        [op.id, nowIso()],
      );
      break;
    case "task.restore": {
      const row = await db.select<{ trashedAt: string | null }[]>(
        "SELECT trashedAt FROM tasks WHERE id = $1",
        [op.id],
      );
      const batch = row[0]?.trashedAt;
      if (!batch) break;
      // ponytail: 같은 배치 하위만 복원하는 근사 — 트래시 조상 복원은 서버 몫, pull이 교정
      await db.execute(
        `UPDATE tasks SET trashedAt = NULL WHERE id = $1 OR (trashedAt = $2 AND id IN (
           WITH RECURSIVE dset(id) AS (
             SELECT $1
             UNION ALL
             SELECT t.id FROM tasks t JOIN dset ON t.parentId = dset.id
           ) SELECT id FROM dset))`,
        [op.id, batch],
      );
      break;
    }
    case "meeting.create":
      await db.execute(
        "INSERT OR IGNORE INTO meetings (id, projectId, taskId, title, body, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        [
          op.id,
          d.projectId,
          d.taskId ?? null,
          String(d.title ?? ""),
          String(d.body ?? ""),
          nowIso(),
        ],
      );
      break;
    case "meeting.update":
      await dynUpdate("meetings", op.id!, d, ["title", "body", "taskId"]);
      break;
    case "meeting.delete":
      await db.execute("DELETE FROM meetings WHERE id = $1", [op.id]);
      break;
    case "deadline.create": {
      const col = d.scopeType === "task" ? "taskId" : "projectId";
      const r = await db.select<{ m: number | null }[]>(
        `SELECT MAX(orderIndex) m FROM deadline_items WHERE ${col} = $1`,
        [d.scopeId],
      );
      await db.execute(
        `INSERT OR IGNORE INTO deadline_items (id, ${col}, date, content, orderIndex, createdAt, updatedAt) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [
          op.id,
          d.scopeId,
          String(d.date ?? ""),
          String(d.content ?? ""),
          (r[0]?.m ?? -1) + 1,
          nowIso(),
        ],
      );
      break;
    }
    case "deadline.update":
      await dynUpdate("deadline_items", op.id!, d, ["date", "content"]);
      break;
    case "deadline.delete":
      await db.execute("DELETE FROM deadline_items WHERE id = $1", [op.id]);
      break;
  }
}

/** data에 있는 키만 SET하는 동적 UPDATE (+ updatedAt 갱신). */
async function dynUpdate(
  table: string,
  id: string,
  data: Record<string, unknown>,
  cols: string[],
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const c of cols) {
    if (data[c] === undefined) continue;
    args.push(c === "isMilestone" ? (data[c] ? 1 : 0) : data[c]);
    sets.push(`${c} = $${args.length}`);
  }
  if (!sets.length) return;
  args.push(new Date().toISOString());
  sets.push(`updatedAt = $${args.length}`);
  args.push(id);
  await db.execute(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${args.length}`,
    args,
  );
}
