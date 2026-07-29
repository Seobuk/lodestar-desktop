import { useState } from "react";
import PersonalKanban from "./PersonalKanban";
import PersonalNotes from "./PersonalNotes";
import PersonalBoard from "./PersonalBoard";
import LibraryPanel from "./LibraryPanel";

// 개인 페이지 — 칸반·메모(Keep)·게시판·서재 4개만(드라이브는 웹 전용).
export default function PersonalView() {
  const [tab, setTab] = useState<"kanban" | "notes" | "board" | "library">(
    "kanban",
  );
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
      {tab === "notes" && <PersonalNotes />}
      {tab === "board" && <PersonalBoard />}
      {tab === "library" && <LibraryPanel />}
    </div>
  );
}
