import { useEffect, useState } from "react";
import { useLiveQuery } from "../lib/store";
import { getProjectRow, listMeetings } from "../lib/queries";
import { updateProjectFields } from "../lib/mutations";
import { fmtDateTime } from "../lib/format";
import DeadlineList from "./DeadlineList";
import MeetingsPanel from "./MeetingsPanel";
import GanttTab from "./GanttTab";
import Editor from "./Editor";
import type { ProjectRow } from "../lib/types";

function InlineName({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (!editing)
    return (
      <h1 className="page-title">
        {value}
        <button
          type="button"
          className="ghost"
          title="이름 변경"
          onClick={() => {
            setV(value);
            setEditing(true);
          }}
        >
          ✎
        </button>
      </h1>
    );
  return (
    <form
      className="inline-name"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSave(v.trim());
        setEditing(false);
      }}
    >
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        autoFocus
        onBlur={() => setEditing(false)}
      />
    </form>
  );
}

function InfoTab({ project }: { project: ProjectRow }) {
  // 편집 중엔 로컬 값을 유지 — 동기화 pull이 밑에서 갈아끼워도 덮지 않는다(저장 시 LWW).
  const [desc, setDesc] = useState<string | null>(null);
  const value = desc ?? project.description;
  const dirty = desc !== null && desc !== project.description;
  const save = async () => {
    if (!dirty) return;
    await updateProjectFields(project.id, { description: value });
    setDesc(null);
  };
  return (
    <div className="info-tab">
      <Editor
        value={value}
        onChange={setDesc}
        placeholder="프로젝트 설명 (마크다운)"
        onSave={() => void save()}
      />
      <div className="btn-row">
        <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
          저장
        </button>
      </div>
    </div>
  );
}

type TabKey = "dash" | "gantt" | "meetings" | "info";

// key={projectId} 리마운트로 탭이 초기화되지 않게 — 보던 탭을 프로젝트 전환 후에도 유지
let lastTab: TabKey = "dash";

export default function ProjectView({
  projectId,
  initialMeetingId,
}: {
  projectId: string;
  /** 전역 검색에서 회의록을 골랐을 때 — 회의록 탭을 열고 해당 노트를 펼친다. */
  initialMeetingId?: string | null;
}) {
  const project = useLiveQuery((db) => getProjectRow(db, projectId), [projectId]);
  const meetings = useLiveQuery((db) => listMeetings(db, projectId), [projectId]);
  const [tab, rawSetTab] = useState<TabKey>(
    initialMeetingId ? "meetings" : lastTab,
  );
  const setTab = (t: TabKey) => {
    lastTab = t;
    rawSetTab(t);
  };
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(
    initialMeetingId ?? null,
  );

  useEffect(() => {
    if (initialMeetingId) {
      setTab("meetings");
      setOpenMeetingId(initialMeetingId);
    }
  }, [initialMeetingId]);

  if (project === undefined)
    return <div className="pane-empty">불러오는 중…</div>;
  if (project === null)
    return (
      <div className="pane-empty">
        프로젝트를 찾을 수 없습니다. (삭제되었을 수 있음)
      </div>
    );

  return (
    <div className="project-view">
      <InlineName
        value={project.name}
        onSave={(name) => void updateProjectFields(projectId, { name })}
      />
      <nav className="tabs">
        {(
          [
            ["dash", "대시보드"],
            ["gantt", "간트"],
            ["meetings", "회의록"],
            ["info", "정보"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "on" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "dash" && (
        <div className="dash">
          <DeadlineList
            scopeType="project"
            scopeId={projectId}
            title="프로젝트 마감 일정"
          />
          <section className="card">
            <h3>회의록</h3>
            {meetings?.length === 0 && (
              <p className="empty">아직 회의록이 없습니다.</p>
            )}
            {meetings?.slice(0, 8).map((m) => (
              <button
                type="button"
                key={m.id}
                className="meeting-row"
                onClick={() => {
                  setOpenMeetingId(m.id);
                  setTab("meetings");
                }}
              >
                <span className="meeting-title">{m.title}</span>
                <span className="meta">{fmtDateTime(m.createdAt)}</span>
              </button>
            ))}
          </section>
        </div>
      )}
      {tab === "gantt" && <GanttTab projectId={projectId} />}
      {/* 회의록·정보는 언마운트하지 않고 숨긴다 — 탭을 잠깐 오가도 작성/수정 중이던
          내용이 파기되지 않게(리뷰). 간트는 자체 상태 소유 + 언마운트 시 flush 설계 유지. */}
      <div style={{ display: tab === "meetings" ? undefined : "none" }}>
        <MeetingsPanel
          projectId={projectId}
          openId={openMeetingId}
          onOpened={() => setOpenMeetingId(null)}
        />
      </div>
      <div style={{ display: tab === "info" ? undefined : "none" }}>
        <InfoTab project={project} />
      </div>
    </div>
  );
}
