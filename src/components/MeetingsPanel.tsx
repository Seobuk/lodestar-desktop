import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "../lib/store";
import { getMeetingRow, getTaskRow, listMeetings, taskTree } from "../lib/queries";
import {
  addMeeting,
  removeMeeting,
  updateMeetingFields,
} from "../lib/mutations";
import { fmtDateTime } from "../lib/format";
import { useDraft, clearDraft } from "../lib/useDraft";
import MarkdownView from "./MarkdownView";
import Editor from "./Editor";
import ConfirmButton from "./ConfirmButton";
import type { MeetingRow, TaskNode } from "../lib/types";

type Mode = { t: "list" } | { t: "read"; id: string } | { t: "edit"; id: string | null };

function flatten(
  nodes: TaskNode[],
  depth = 0,
): { id: string; title: string; depth: number }[] {
  const out: { id: string; title: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, title: n.title, depth });
    out.push(...flatten(n.children, depth + 1));
  }
  return out;
}

function TaskChip({ taskId }: { taskId: string }) {
  const task = useLiveQuery((db) => getTaskRow(db, taskId), [taskId]);
  if (!task) return null;
  return <span className="chip">🔗 {task.title}</span>;
}

function MeetingEdit({
  projectId,
  meeting,
  onDone,
  onCancel,
}: {
  projectId: string;
  meeting: MeetingRow | null;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(meeting?.title ?? "");
  const [body, setBody] = useState(meeting?.body ?? "");
  const [taskId, setTaskId] = useState(meeting?.taskId ?? "");
  const tasks = useLiveQuery((db) => taskTree(db, projectId), [projectId]);
  const flat = useMemo(() => flatten(tasks ?? []), [tasks]);

  // 저장 없이 떠나도 글이 안 날아가게 초안 자동보관 + 재진입 시 복원
  const draftKey = meeting ? `meeting:${meeting.id}` : `meeting:new:${projectId}`;
  const { restored, discard } = useDraft(
    draftKey,
    { title, body, taskId },
    Boolean(title.trim() || body.trim()),
    (v) => {
      setTitle(v.title ?? "");
      setBody(v.body ?? "");
      setTaskId(v.taskId ?? "");
    },
  );

  const canSave = Boolean(title.trim());
  const doSave = async () => {
    if (!canSave) return;
    const data = { title: title.trim(), body, taskId: taskId || null };
    await clearDraft(draftKey);
    if (meeting) {
      await updateMeetingFields(meeting.id, data);
      onDone(meeting.id);
    } else {
      const id = await addMeeting(projectId, data.title, body, data.taskId);
      onDone(id);
    }
  };

  return (
    <div className="meeting-edit">
      {restored && (
        <div className="draft-banner">
          저장 안 된 초안을 복원했습니다.
          <button
            type="button"
            onClick={() => {
              discard();
              setTitle(meeting?.title ?? "");
              setBody(meeting?.body ?? "");
              setTaskId(meeting?.taskId ?? "");
            }}
          >
            초안 버리기
          </button>
        </div>
      )}
      <div className="meeting-edit-head">
        <input
          type="text"
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="회의록 제목"
          autoFocus
        />
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">연결 업무 없음</option>
          {flat.map((t) => (
            <option key={t.id} value={t.id}>
              {`${"　".repeat(t.depth)}${t.depth > 0 ? "└ " : ""}${t.title}`}
            </option>
          ))}
        </select>
      </div>
      <Editor
        value={body}
        onChange={setBody}
        placeholder="회의 내용 (마크다운)"
        onSave={() => void doSave()}
      />
      <div className="btn-row">
        <button
          type="button"
          className="primary"
          disabled={!canSave}
          onClick={() => void doSave()}
        >
          저장
        </button>
        <button
          type="button"
          onClick={() => {
            void clearDraft(draftKey);
            onCancel();
          }}
        >
          취소
        </button>
      </div>
    </div>
  );
}

function MeetingRead({
  id,
  onEdit,
  onDeleted,
}: {
  id: string;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const meeting = useLiveQuery((db) => getMeetingRow(db, id), [id]);
  if (meeting === undefined)
    return <p className="empty">불러오는 중…</p>;
  if (meeting === null)
    return <p className="empty">회의록을 찾을 수 없습니다.</p>;
  return (
    <article className="meeting-read">
      <header>
        <h2>{meeting.title}</h2>
        <div className="meta">
          {fmtDateTime(meeting.createdAt)}
          {meeting.taskId && <TaskChip taskId={meeting.taskId} />}
        </div>
        <div className="btn-row">
          <button type="button" onClick={onEdit}>
            편집
          </button>
          <ConfirmButton
            label="삭제"
            onConfirm={async () => {
              await removeMeeting(id);
              onDeleted();
            }}
          />
        </div>
      </header>
      <MarkdownView src={meeting.body} />
    </article>
  );
}

export default function MeetingsPanel({
  projectId,
  openId,
  onOpened,
}: {
  projectId: string;
  openId?: string | null;
  onOpened?: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ t: "list" });
  const meetings = useLiveQuery((db) => listMeetings(db, projectId), [projectId]);

  useEffect(() => {
    if (openId) {
      setMode({ t: "read", id: openId });
      onOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // ESC = 한 단계 후퇴(열람 → 목록). 편집 중엔 실수 방지를 위해 취소 버튼으로만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode((m) => (m.t === "read" ? { t: "list" } : m));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (mode.t === "read")
    return (
      <MeetingRead
        id={mode.id}
        onEdit={() => setMode({ t: "edit", id: mode.id })}
        onDeleted={() => setMode({ t: "list" })}
      />
    );

  if (mode.t === "edit") {
    // 목록이 아직 로드 전이면 기존 회의록 편집이 '새 글'로 열려 본문을 빈 값으로
    // 덮을 수 있다(리뷰) — 로드 완료까지 대기.
    if (mode.id && meetings === undefined)
      return <p className="empty">불러오는 중…</p>;
    const current = mode.id
      ? (meetings?.find((m) => m.id === mode.id) ?? null)
      : null;
    return (
      <MeetingEdit
        key={current?.id ?? "new"}
        projectId={projectId}
        meeting={current}
        onDone={(id) => setMode({ t: "read", id })}
        onCancel={() =>
          setMode(mode.id ? { t: "read", id: mode.id } : { t: "list" })
        }
      />
    );
  }

  return (
    <div className="meetings-list">
      <div className="list-head">
        <h3>회의록</h3>
        <button
          type="button"
          className="primary"
          onClick={() => setMode({ t: "edit", id: null })}
        >
          + 새 회의록
        </button>
      </div>
      {meetings?.length === 0 && (
        <p className="empty">아직 회의록이 없습니다.</p>
      )}
      {meetings?.map((m) => (
        <button
          type="button"
          key={m.id}
          className="meeting-row"
          onClick={() => setMode({ t: "read", id: m.id })}
        >
          <span className="meeting-title">{m.title}</span>
          {m.taskId && <TaskChip taskId={m.taskId} />}
          <span className="meta">{fmtDateTime(m.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}
