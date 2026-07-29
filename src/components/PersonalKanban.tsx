import { useState } from "react";
import { useLiveQuery } from "../lib/store";
import { addCard, removeCard, updateCardFields } from "../lib/mutations";
import ConfirmButton from "./ConfirmButton";
import type { ChecklistItem, PersonalCardRow } from "../lib/types";

const COLUMNS: [string, string][] = [
  ["todo", "할 일"],
  ["doing", "진행 중"],
  ["done", "완료"],
  ["blocked", "막힘"],
];

/** 웹 kanban-colors 팔레트 키 → 카드 배경(연한 톤). */
const CARD_COLORS: Record<string, string> = {
  red: "#fde3e1",
  orange: "#fdeeda",
  yellow: "#fdf7d8",
  green: "#e3f4e0",
  blue: "#e0edfb",
  purple: "#ece2f7",
};

export function parseJsonArr<T>(s: string): T[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function CardEditor({
  card,
  onClose,
}: {
  card: PersonalCardRow;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [newItem, setNewItem] = useState("");
  const checklist = parseJsonArr<ChecklistItem>(card.checklist);

  const saveChecklist = (items: ChecklistItem[]) =>
    void updateCardFields(card.id, { checklist: items });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== card.title)
              void updateCardFields(card.id, { title: title.trim() });
          }}
        />
        <div className="swatches">
          {["", ...Object.keys(CARD_COLORS)].map((key) => (
            <button
              key={key || "none"}
              type="button"
              className={`swatch ${(card.color ?? "") === key ? "on" : ""}`}
              style={{ background: key ? CARD_COLORS[key] : "#fff" }}
              title={key || "기본색"}
              onClick={() => void updateCardFields(card.id, { color: key || null })}
            />
          ))}
        </div>
        <div className="check-list">
          {checklist.map((it, i) => (
            <div key={i} className="check-row">
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => {
                  const next = checklist.map((x, j) =>
                    j === i ? { ...x, done: !x.done } : x,
                  );
                  saveChecklist(next);
                }}
              />
              <span className={it.done ? "done" : ""}>{it.text}</span>
              <button
                type="button"
                className="ghost"
                onClick={() => saveChecklist(checklist.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <form
            className="check-add"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              saveChecklist([...checklist, { text: newItem.trim(), done: false }]);
              setNewItem("");
            }}
          >
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="체크리스트 항목 추가"
            />
          </form>
        </div>
        <div className="btn-row">
          <ConfirmButton
            label="카드 삭제"
            onConfirm={async () => {
              await removeCard(card.id);
              onClose();
            }}
          />
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PersonalKanban() {
  const cards = useLiveQuery(
    (db) =>
      db.select<PersonalCardRow[]>(
        "SELECT * FROM personal_cards ORDER BY orderIndex",
      ),
    [],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const byCol = (status: string) =>
    (cards ?? []).filter((c) => c.status === status);

  const dropTo = async (status: string) => {
    if (!dragId) return;
    const max = Math.max(0, ...byCol(status).map((c) => c.orderIndex));
    await updateCardFields(dragId, { status, orderIndex: max + 1 });
    setDragId(null);
  };

  const editing = editingId
    ? (cards ?? []).find((c) => c.id === editingId)
    : null;

  return (
    <div className="pk-board">
      {COLUMNS.map(([status, label]) => (
        <div
          key={status}
          className="pk-col"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => void dropTo(status)}
        >
          <div className="pk-col-head">
            {label}
            <span className="cnt">{byCol(status).length}</span>
          </div>
          {byCol(status).map((c) => {
            const items = parseJsonArr<ChecklistItem>(c.checklist);
            const done = items.filter((i) => i.done).length;
            return (
              <button
                type="button"
                key={c.id}
                className="pk-card"
                style={
                  c.color && CARD_COLORS[c.color]
                    ? { background: CARD_COLORS[c.color] }
                    : undefined
                }
                draggable
                onDragStart={() => setDragId(c.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => setEditingId(c.id)}
              >
                <span className="pk-title">{c.title}</span>
                {items.length > 0 && (
                  <span className="pk-check">
                    ☑ {done}/{items.length}
                  </span>
                )}
              </button>
            );
          })}
          {adding === status ? (
            <form
              className="pk-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newTitle.trim()) return;
                await addCard(newTitle.trim(), status);
                setNewTitle("");
                setAdding(null);
              }}
            >
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="카드 제목"
                autoFocus
                onBlur={() => {
                  if (!newTitle.trim()) setAdding(null);
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              className="pk-new"
              onClick={() => {
                setAdding(status);
                setNewTitle("");
              }}
            >
              + 카드
            </button>
          )}
        </div>
      ))}
      {editing && (
        <CardEditor
          key={editing.id}
          card={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
