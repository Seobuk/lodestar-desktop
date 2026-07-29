import { newId } from "./ids";
import { dispatch } from "./sync";

// UI가 부르는 뮤테이션 — op 모양(서버 applyOp 계약)을 한 곳에 모은다.
// 전부 dispatch(로컬 적용 + 큐 적재 + 동기화 예약)를 거친다.

export async function addProject(name: string): Promise<string> {
  const id = newId();
  await dispatch({ entity: "project", action: "create", id, data: { name } });
  return id;
}

export async function updateProjectFields(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await dispatch({ entity: "project", action: "update", id, data });
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
  await dispatch({ entity: "task", action: "update", id, data });
}

export async function trashTask(id: string): Promise<void> {
  await dispatch({ entity: "task", action: "trash", id });
}

export async function restoreTask(id: string): Promise<void> {
  await dispatch({ entity: "task", action: "restore", id });
}

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
  await dispatch({ entity: "meeting", action: "update", id, data });
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
  await dispatch({ entity: "deadline", action: "update", id, data });
}

export async function removeDeadline(id: string): Promise<void> {
  await dispatch({ entity: "deadline", action: "delete", id });
}
