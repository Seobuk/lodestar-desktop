import { useState } from "react";
import { useLiveQuery, useVersion } from "../lib/store";
import { getMeta } from "../lib/settings";
import { listProjects, taskTree } from "../lib/queries";
import { addProject, addTask, trashTask } from "../lib/mutations";
import { scheduleSync, syncState, type SyncStatus } from "../lib/sync";
import ConfirmButton from "./ConfirmButton";
import type { ProjectRow, Selection, TaskNode } from "../lib/types";

function SideTask({
  node,
  depth,
  projectId,
  selection,
  onSelect,
}: {
  node: TaskNode;
  depth: number;
  projectId: string;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const active = selection?.type === "task" && selection.id === node.id;

  return (
    <>
      <div
        className={`side-row task ${active ? "active" : ""}`}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            className="chev"
            onClick={() => setOpen(!open)}
            aria-label={open ? "접기" : "펼치기"}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="chev-space" />
        )}
        <button
          type="button"
          className="side-name"
          onClick={() => onSelect({ type: "task", id: node.id, projectId })}
        >
          {node.title}
        </button>
        <span className="row-actions">
          <button
            type="button"
            title="하위 업무 추가"
            onClick={() => setAdding(!adding)}
          >
            +
          </button>
          <ConfirmButton
            label="✕"
            confirmLabel="휴지통?"
            title="휴지통으로"
            onConfirm={() => void trashTask(node.id)}
          />
        </span>
      </div>
      {adding && (
        <form
          className="side-add"
          style={{ paddingLeft: 24 + depth * 14 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await addTask(projectId, node.id, title.trim());
            setTitle("");
            setAdding(false);
            setOpen(true);
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="하위 업무 이름"
            autoFocus
          />
        </form>
      )}
      {open &&
        node.children.map((c) => (
          <SideTask
            key={c.id}
            node={c}
            depth={depth + 1}
            projectId={projectId}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function SideProject({
  project,
  selection,
  onSelect,
}: {
  project: ProjectRow;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const tasks = useLiveQuery((db) => taskTree(db, project.id), [project.id]);
  const active = selection?.type === "project" && selection.id === project.id;

  return (
    <div className="side-project">
      <div className={`side-row project ${active ? "active" : ""}`}>
        <button
          type="button"
          className="chev"
          onClick={() => setOpen(!open)}
          aria-label={open ? "접기" : "펼치기"}
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          type="button"
          className="side-name"
          onClick={() => {
            onSelect({ type: "project", id: project.id });
            setOpen(true);
          }}
        >
          {project.name}
        </button>
        <span className="row-actions">
          <button
            type="button"
            title="세부 업무 추가"
            onClick={() => {
              setAdding(!adding);
              setOpen(true);
            }}
          >
            +
          </button>
        </span>
      </div>
      {adding && (
        <form
          className="side-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            await addTask(project.id, null, title.trim());
            setTitle("");
            setAdding(false);
          }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="세부 업무 이름"
            autoFocus
          />
        </form>
      )}
      {open &&
        tasks?.map((t) => (
          <SideTask
            key={t.id}
            node={t}
            depth={1}
            projectId={project.id}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

const STATUS_LABEL: Record<SyncStatus, string> = {
  idle: "대기",
  unconfigured: "토큰 미설정",
  syncing: "동기화 중…",
  ok: "동기화됨",
  offline: "오프라인",
  error: "일부 실패",
};

function StatusBar({ onSettings }: { onSettings: () => void }) {
  useVersion(); // syncState 변경(notify)마다 다시 그린다
  const s = syncState;
  return (
    <div className="statusbar">
      <span className={`dot ${s.status}`} />
      <span className="status-text">
        {STATUS_LABEL[s.status]}
        {s.pendingOps > 0 && ` · 대기 ${s.pendingOps}`}
      </span>
      <button
        type="button"
        title="지금 동기화"
        onClick={() => scheduleSync(0)}
      >
        ↻
      </button>
      <button type="button" title="설정" onClick={onSettings}>
        ⚙
      </button>
    </div>
  );
}

export default function Sidebar({
  selection,
  onSelect,
  onSettings,
}: {
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onSettings: () => void;
}) {
  const projects = useLiveQuery(listProjects, []);
  const personalEnabled = useLiveQuery(
    () => getMeta("personalEnabled").then((v) => v !== "0"),
    [],
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  return (
    <aside className="side">
      <button type="button" className="brand" onClick={() => onSelect(null)}>
        Lodestar
      </button>
      <div className="side-scroll">
        {personalEnabled !== false && (
          <button
            type="button"
            className={`side-personal ${selection?.type === "personal" ? "active" : ""}`}
            onClick={() => onSelect({ type: "personal" })}
          >
            👤 개인 페이지
          </button>
        )}
        {projects?.map((p) => (
          <SideProject
            key={p.id}
            project={p}
            selection={selection}
            onSelect={onSelect}
          />
        ))}
        {adding ? (
          <form
            className="side-add"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              const id = await addProject(name.trim());
              setName("");
              setAdding(false);
              onSelect({ type: "project", id });
            }}
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="새 프로젝트 이름"
              autoFocus
              onBlur={() => {
                if (!name.trim()) setAdding(false);
              }}
            />
          </form>
        ) : (
          <button
            type="button"
            className="side-new"
            onClick={() => setAdding(true)}
          >
            + 새 프로젝트
          </button>
        )}
      </div>
      <StatusBar onSettings={onSettings} />
    </aside>
  );
}
