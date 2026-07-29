import { useEffect, useState } from "react";
import PersonalKanban from "./PersonalKanban";
import PersonalNotes from "./PersonalNotes";
import PersonalBoard from "./PersonalBoard";
import LibraryPanel from "./LibraryPanel";

// 개인 페이지 — 칸반·메모(Keep)·게시판·서재 4개만(드라이브는 웹 전용).
export default function PersonalView({
  initialTab,
  openNoteId,
  openPostId,
  openLibItemId,
}: {
  /** 전역 검색에서 진입할 때 — 탭과 열 항목 지정. */
  initialTab?: "kanban" | "notes" | "board" | "library";
  openNoteId?: string;
  openPostId?: string;
  openLibItemId?: string;
}) {
  const [tab, setTab] = useState<"kanban" | "notes" | "board" | "library">(
    initialTab ?? "kanban",
  );
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, openNoteId, openPostId, openLibItemId]);
  return (
    <div className="personal-view">
      <h1 className="page-title">개인 페이지</h1>
      <nav className="tabs">
        {(
          [
            ["kanban", "칸반"],
            ["notes", "메모"],
            ["board", "게시판"],
            ["library", "서재"],
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
      {tab === "kanban" && <PersonalKanban />}
      {tab === "notes" && <PersonalNotes openId={openNoteId} />}
      {tab === "board" && <PersonalBoard openId={openPostId} />}
      {tab === "library" && <LibraryPanel openItemId={openLibItemId} />}
    </div>
  );
}
