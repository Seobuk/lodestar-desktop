import type Database from "@tauri-apps/plugin-sql";
import type {
  DeadlineRow,
  MeetingRow,
  ProjectRow,
  TaskNode,
  TaskRow,
} from "./types";

export async function listProjects(db: Database): Promise<ProjectRow[]> {
  return db.select<ProjectRow[]>(
    "SELECT * FROM projects WHERE status = 'active' ORDER BY orderIndex",
  );
}

export async function getProjectRow(
  db: Database,
  id: string,
): Promise<ProjectRow | null> {
  const r = await db.select<ProjectRow[]>(
    "SELECT * FROM projects WHERE id = $1",
    [id],
  );
  return r[0] ?? null;
}

export async function taskTree(
  db: Database,
  projectId: string,
): Promise<TaskNode[]> {
  const rows = await db.select<TaskRow[]>(
    "SELECT * FROM tasks WHERE projectId = $1 AND trashedAt IS NULL ORDER BY orderIndex",
    [projectId],
  );
  const byId = new Map<string, TaskNode>(
    rows.map((r) => [r.id, { ...r, children: [] }]),
  );
  const roots: TaskNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getTaskRow(
  db: Database,
  id: string,
): Promise<TaskRow | null> {
  const r = await db.select<TaskRow[]>("SELECT * FROM tasks WHERE id = $1", [
    id,
  ]);
  return r[0] ?? null;
}

export async function listMeetings(
  db: Database,
  projectId: string,
): Promise<MeetingRow[]> {
  return db.select<MeetingRow[]>(
    "SELECT * FROM meetings WHERE projectId = $1 ORDER BY createdAt DESC",
    [projectId],
  );
}

export async function getMeetingRow(
  db: Database,
  id: string,
): Promise<MeetingRow | null> {
  const r = await db.select<MeetingRow[]>(
    "SELECT * FROM meetings WHERE id = $1",
    [id],
  );
  return r[0] ?? null;
}

export type SearchHit = {
  kind: "project" | "task" | "meeting" | "note" | "post" | "libitem";
  id: string;
  title: string;
  projectId: string | null;
};

/** 전역 검색 — 로컬 미러 전체를 LIKE로 훑는다(팀 규모 데이터라 즉답). */
export async function searchAll(
  db: Database,
  q: string,
): Promise<SearchHit[]> {
  const like = `%${q}%`;
  return db.select<SearchHit[]>(
    `SELECT 'project' AS kind, id, name AS title, NULL AS projectId FROM projects WHERE status = 'active' AND name LIKE $1
     UNION ALL SELECT 'task', id, title, projectId FROM tasks WHERE trashedAt IS NULL AND (title LIKE $1 OR description LIKE $1)
     UNION ALL SELECT 'meeting', id, title, projectId FROM meetings WHERE title LIKE $1 OR body LIKE $1
     UNION ALL SELECT 'note', id, CASE WHEN title != '' THEN title ELSE substr(body, 1, 40) END, NULL FROM personal_notes WHERE title LIKE $1 OR body LIKE $1
     UNION ALL SELECT 'post', id, title, NULL FROM personal_posts WHERE title LIKE $1 OR body LIKE $1
     UNION ALL SELECT 'libitem', id, title, NULL FROM library_items WHERE deletedAt IS NULL AND (title LIKE $1 OR authors LIKE $1 OR note LIKE $1)
     LIMIT 40`,
    [like],
  );
}

export async function listDeadlines(
  db: Database,
  scopeType: "project" | "task",
  scopeId: string,
): Promise<DeadlineRow[]> {
  const col = scopeType === "task" ? "taskId" : "projectId";
  return db.select<DeadlineRow[]>(
    `SELECT * FROM deadline_items WHERE ${col} = $1 ORDER BY date, orderIndex`,
    [scopeId],
  );
}
