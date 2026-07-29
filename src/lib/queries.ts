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
