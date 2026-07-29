// 로컬 SQLite 행 타입 — 서버 모델의 부분집합(데스크톱이 안 쓰는 컬럼은 미러링 안 함).
// 날짜는 전부 ISO 문자열로 저장한다(서버 JSON 그대로). 날짜만 필요한 필드는
// slice(0, 10)으로 표시.

export type ProjectRow = {
  id: string;
  name: string;
  description: string;
  deadline: string | null;
  status: string;
  orderIndex: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TaskRow = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string;
  deadline: string | null;
  status: string;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  isMilestone: number;
  orderIndex: number;
  createdAt: string | null;
  updatedAt: string | null;
  trashedAt: string | null;
};

export type TaskNode = TaskRow & { children: TaskNode[] };

export type MeetingRow = {
  id: string;
  projectId: string;
  taskId: string | null;
  title: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DeadlineRow = {
  id: string;
  taskId: string | null;
  projectId: string | null;
  date: string;
  content: string;
  orderIndex: number;
  createdAt: string | null;
  updatedAt: string | null;
};

/** project-sync/personal-sync POST의 작업 단위 — 서버 applyOp와 같은 모양.
 *  base = 마지막 pull 때 본 행의 updatedAt(충돌 보호장치, 내용성 엔티티만). */
export type SyncOp = {
  entity:
    | "project"
    | "task"
    | "meeting"
    | "deadline"
    | "card"
    | "note"
    | "post"
    | "libitem";
  action: string;
  id?: string;
  data?: Record<string, unknown>;
  base?: string;
};

export type Selection =
  | { type: "project"; id: string }
  | { type: "task"; id: string; projectId: string }
  | { type: "personal" };

// ----- 개인 페이지 로컬 행 -----

export type PersonalCardRow = {
  id: string;
  title: string;
  status: string;
  checklist: string; // JSON [{text,done}]
  color: string | null;
  postit: string | null;
  orderIndex: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PersonalNoteRow = {
  id: string;
  title: string;
  body: string;
  items: string; // JSON [{text,done}]
  color: string;
  labels: string; // JSON string[]
  pinned: number;
  archived: number;
  orderIndex: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PersonalPostRow = {
  id: string;
  title: string;
  body: string;
  pinned: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LibCollectionRow = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string | null;
};

export type LibItemRow = {
  id: string;
  collectionId: string | null;
  itemType: string;
  title: string;
  authors: string | null;
  year: number | null;
  venue: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  tags: string; // JSON string[]
  note: string | null;
  fileUrl: string | null;
  fileName: string | null;
  deletedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ChecklistItem = { text: string; done: boolean };
