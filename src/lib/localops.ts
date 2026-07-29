import { getDb } from "./db";
import type { SyncOp } from "./types";

// 서버 lib 헬퍼의 로컬 근사 — 오프라인 중에도 UI가 즉시 반영되도록 같은 op를
// 로컬 SQLite에 적용한다. 정확한 규칙(휴지통 배치 복원, 검증, 서지 자동채움)은
// 서버가 갖고 있고, 다음 pull이 로컬을 서버 상태로 교정한다.
//
// ⚠️ updatedAt 불변식: 로컬 쓰기는 updatedAt을 절대 만지지 않는다 — 이 컬럼은
// "마지막 pull 때 서버가 준 값"만 담아 충돌 보호장치의 base로 쓰인다(로컬 생성
// 행은 NULL = 아직 서버 기준 없음 → base 생략 = LWW).

const nowIso = () => new Date().toISOString();

type TreeNode = {
  id?: string;
  name?: string;
  s?: string;
  e?: string;
  pr?: number;
  children?: TreeNode[];
};

/** 업무 + 활성 하위 전체를 휴지통으로(재귀 CTE). task.trash와 task.tree가 공용. */
const TRASH_SQL = `UPDATE tasks SET trashedAt = $2 WHERE trashedAt IS NULL AND id IN (
  WITH RECURSIVE dset(id) AS (
    SELECT $1
    UNION ALL
    SELECT t.id FROM tasks t JOIN dset ON t.parentId = dset.id
  ) SELECT id FROM dset)`;

/** JSON으로 직렬화해 저장하는 컬럼 / 0·1 정수로 저장하는 불리언 컬럼. */
const JSON_COLS = new Set(["checklist", "items", "labels", "tags", "attachments"]);
const BOOL_COLS = new Set(["isMilestone", "pinned", "archived"]);
const toSql = (col: string, v: unknown): unknown =>
  JSON_COLS.has(col) ? JSON.stringify(v ?? []) : BOOL_COLS.has(col) ? (v ? 1 : 0) : v;

export async function applyOpLocal(op: SyncOp): Promise<void> {
  const db = await getDb();
  const d = op.data ?? {};
  const kind = `${op.entity}.${op.action}`;

  switch (kind) {
    // ----- 프로젝트 -----
    case "project.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM projects",
      );
      await db.execute(
        "INSERT OR IGNORE INTO projects (id, name, orderIndex, createdAt) VALUES ($1, $2, $3, $4)",
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

    // ----- 업무 -----
    case "task.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM tasks WHERE projectId = $1 AND parentId IS $2 AND trashedAt IS NULL",
        [d.projectId, d.parentId ?? null],
      );
      await db.execute(
        "INSERT OR IGNORE INTO tasks (id, projectId, parentId, title, orderIndex, createdAt) VALUES ($1, $2, $3, $4, $5, $6)",
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
      await db.execute(TRASH_SQL, [op.id, nowIso()]);
      break;
    case "task.tree": {
      // 간트 일괄 동기화의 로컬 적용 — 서버 syncProjectTasks의 근사.
      // 데스크톱 래퍼가 모든 노드에 id를 미리 채워 보내므로 create도 id 그대로.
      const projectId = String(d.projectId ?? "");
      const tree = Array.isArray(d.tree) ? (d.tree as TreeNode[]) : [];
      const deletedIds = Array.isArray(d.deletedIds)
        ? (d.deletedIds as string[])
        : [];
      const now = nowIso();
      for (const delId of deletedIds) await db.execute(TRASH_SQL, [delId, now]);
      const walk = async (nodes: TreeNode[], parentId: string | null) => {
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (!node.id) continue;
          const leaf = !node.children || node.children.length === 0;
          const title = String(node.name ?? "").trim() || "새 항목";
          const startDate = leaf && node.s ? node.s : null;
          const endDate = leaf && node.e ? node.e : null;
          const progress = leaf
            ? Math.min(100, Math.max(0, Math.round(node.pr ?? 0)))
            : 0;
          const exists = await db.select<{ id: string }[]>(
            "SELECT id FROM tasks WHERE id = $1",
            [node.id],
          );
          if (exists.length) {
            await db.execute(
              "UPDATE tasks SET title = $2, parentId = $3, orderIndex = $4, startDate = $5, endDate = $6, progress = $7, durationDays = NULL, isMilestone = 0 WHERE id = $1",
              [node.id, title, parentId, i, startDate, endDate, progress],
            );
          } else {
            await db.execute(
              "INSERT INTO tasks (id, projectId, parentId, title, orderIndex, startDate, endDate, progress, createdAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [node.id, projectId, parentId, title, i, startDate, endDate, progress, now],
            );
          }
          if (node.children?.length) await walk(node.children, node.id);
        }
      };
      await walk(tree, null);
      break;
    }
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
           WITH RECURSIVE dset2(id) AS (
             SELECT $1
             UNION ALL
             SELECT t.id FROM tasks t JOIN dset2 ON t.parentId = dset2.id
           ) SELECT id FROM dset2))`,
        [op.id, batch],
      );
      break;
    }

    // ----- 회의록 -----
    case "meeting.create":
      await db.execute(
        "INSERT OR IGNORE INTO meetings (id, projectId, taskId, title, body, createdAt) VALUES ($1, $2, $3, $4, $5, $6)",
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

    // ----- 마감 -----
    case "deadline.create": {
      const col = d.scopeType === "task" ? "taskId" : "projectId";
      const r = await db.select<{ m: number | null }[]>(
        `SELECT MAX(orderIndex) m FROM deadline_items WHERE ${col} = $1`,
        [d.scopeId],
      );
      await db.execute(
        `INSERT OR IGNORE INTO deadline_items (id, ${col}, date, content, orderIndex, createdAt) VALUES ($1, $2, $3, $4, $5, $6)`,
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

    // ----- 개인: 칸반 카드 -----
    case "card.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM personal_cards",
      );
      await db.execute(
        "INSERT OR IGNORE INTO personal_cards (id, title, status, orderIndex, createdAt) VALUES ($1, $2, $3, $4, $5)",
        [
          op.id,
          String(d.title ?? ""),
          String(d.status ?? "todo"),
          (r[0]?.m ?? -1) + 1,
          nowIso(),
        ],
      );
      break;
    }
    case "card.update":
      await dynUpdate("personal_cards", op.id!, d, [
        "title",
        "status",
        "checklist",
        "color",
        "postit",
        "orderIndex",
      ]);
      break;
    case "card.delete":
      await db.execute("DELETE FROM personal_cards WHERE id = $1", [op.id]);
      break;

    // ----- 개인: 메모(Keep) -----
    case "note.create": {
      const r = await db.select<{ m: number | null }[]>(
        "SELECT MAX(orderIndex) m FROM personal_notes",
      );
      await db.execute(
        "INSERT OR IGNORE INTO personal_notes (id, title, body, items, color, pinned, orderIndex, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          op.id,
          String(d.title ?? ""),
          String(d.body ?? ""),
          JSON.stringify(d.items ?? []),
          String(d.color ?? "default"),
          d.pinned ? 1 : 0,
          (r[0]?.m ?? -1) + 1,
          nowIso(),
        ],
      );
      break;
    }
    case "note.update":
      await dynUpdate("personal_notes", op.id!, d, [
        "title",
        "body",
        "items",
        "color",
        "labels",
        "pinned",
        "archived",
      ]);
      break;
    case "note.delete":
      await db.execute("DELETE FROM personal_notes WHERE id = $1", [op.id]);
      break;

    // ----- 개인: 게시판 -----
    case "post.create":
      await db.execute(
        "INSERT OR IGNORE INTO personal_posts (id, title, body, pinned, createdAt) VALUES ($1, $2, $3, $4, $5)",
        [op.id, String(d.title ?? ""), String(d.body ?? ""), d.pinned ? 1 : 0, nowIso()],
      );
      break;
    case "post.update":
      await dynUpdate("personal_posts", op.id!, d, ["title", "body", "pinned"]);
      break;
    case "post.delete":
      await db.execute("DELETE FROM personal_posts WHERE id = $1", [op.id]);
      break;

    // ----- 개인: 서재 항목 -----
    case "libitem.create":
      // 로컬 근사: 제목=입력값 — 서버가 push 때 서지 자동채움, pull이 교정.
      await db.execute(
        "INSERT OR IGNORE INTO library_items (id, collectionId, itemType, title, createdAt) VALUES ($1, $2, $3, $4, $5)",
        [
          op.id,
          d.collectionId ?? null,
          String(d.itemType ?? "document"),
          String(d.input ?? ""),
          nowIso(),
        ],
      );
      break;
    case "libitem.update": {
      if (d.trash === true)
        await db.execute("UPDATE library_items SET deletedAt = $2 WHERE id = $1", [
          op.id,
          nowIso(),
        ]);
      if (d.restore === true)
        await db.execute("UPDATE library_items SET deletedAt = NULL WHERE id = $1", [
          op.id,
        ]);
      await dynUpdate("library_items", op.id!, d, [
        "collectionId",
        "title",
        "authors",
        "year",
        "venue",
        "volume",
        "issue",
        "pages",
        "publisher",
        "doi",
        "url",
        "abstract",
        "note",
        "tags",
        "fileUrl",
        "fileName",
      ]);
      break;
    }
    case "libitem.delete":
      await db.execute("DELETE FROM library_items WHERE id = $1", [op.id]);
      break;
  }
}

/** data에 있는 키만 SET하는 동적 UPDATE — updatedAt은 건드리지 않는다(불변식). */
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
    args.push(toSql(c, data[c]));
    sets.push(`${c} = $${args.length}`);
  }
  if (!sets.length) return;
  args.push(id);
  await db.execute(
    `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${args.length}`,
    args,
  );
}
