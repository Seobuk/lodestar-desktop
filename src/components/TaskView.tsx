import { useState } from "react";
import { useLiveQuery } from "../lib/store";
import { getProjectRow, getTaskRow } from "../lib/queries";
import { trashTask, updateTaskFields } from "../lib/mutations";
import DeadlineList from "./DeadlineList";
import Editor from "./Editor";
import ConfirmButton from "./ConfirmButton";
import type { Selection } from "../lib/types";

const STATUS_LABELS: [string, string][] = [
  ["todo", "할 일"],
  ["doing", "진행 중"],
  ["done", "완료"],
  ["blocked", "막힘"],
];

function ProgressSlider({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const v = local ?? value;
  return (
    <label className="progress">
      진행률
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={v}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => {
          if (local !== null && local !== value) onCommit(local);
          setLocal(null);
        }}
      />
      <span className="mono">{v}%</span>
    </label>
  );
}

export default function TaskView({
  taskId,
  projectId,
  onSelect,
}: {
  taskId: string;
  projectId: string;
  onSelect: (s: Selection | null) => void;
}) {
  const task = useLiveQuery((db) => getTaskRow(db, taskId), [taskId]);
  const project = useLiveQuery((db) => getProjectRow(db, projectId), [projectId]);
  const [title, setTitle] = useState<string | null>(null);
  const [desc, setDesc] = useState<string | null>(null);

  if (!task || task.trashedAt)
    return (
      <div className="pane-empty">
        업무를 찾을 수 없습니다. (삭제되었을 수 있음)
      </div>
    );

  const descValue = desc ?? task.description;
  const descDirty = desc !== null && desc !== task.description;

  return (
    <div className="task-view">
      <nav className="breadcrumb">
        <button
          type="button"
          onClick={() => onSelect({ type: "project", id: projectId })}
        >
          {project?.name ?? "프로젝트"}
        </button>
        <span>›</span>
        <span>{task.title}</span>
      </nav>

      {title === null ? (
        <h1 className="page-title">
          {task.title}
          <button
            type="button"
            className="ghost"
            title="이름 변경"
            onClick={() => setTitle(task.title)}
          >
            ✎
          </button>
        </h1>
      ) : (
        <form
          className="inline-name"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void updateTaskFields(taskId, { title: title.trim() });
            setTitle(null);
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onBlur={() => setTitle(null)}
          />
        </form>
      )}

      <div className="task-controls">
        <select
          value={task.status}
          onChange={(e) => void updateTaskFields(taskId, { status: e.target.value })}
        >
          {STATUS_LABELS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <ProgressSlider
          value={task.progress}
          onCommit={(v) => void updateTaskFields(taskId, { progress: v })}
        />
        <ConfirmButton
          label="휴지통으로"
          confirmLabel="정말 휴지통으로?"
          onConfirm={async () => {
            await trashTask(taskId);
            onSelect({ type: "project", id: projectId });
          }}
        />
      </div>

      <DeadlineList scopeType="task" scopeId={taskId} title="마감 일정" />

      <section className="card">
        <h3>설명</h3>
        <Editor
          value={descValue}
          onChange={setDesc}
          rows={12}
          placeholder="업무 설명 (마크다운)"
        />
        <div className="btn-row">
          <button
            type="button"
            className="primary"
            disabled={!descDirty}
            onClick={async () => {
              await updateTaskFields(taskId, { description: descValue });
              setDesc(null);
            }}
          >
            저장
          </button>
        </div>
      </section>
    </div>
  );
}
