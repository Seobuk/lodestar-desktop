import { useState } from "react";
import { useLiveQuery } from "../lib/store";
import { addNote, removeNote, updateNoteFields } from "../lib/mutations";
import ConfirmButton from "./ConfirmButton";
import { parseJsonArr } from "./PersonalKanban";
import type { ChecklistItem, PersonalNoteRow } from "../lib/types";

/** Keep 팔레트 키 → 배경색(웹과 같은 12색 체계). */
export const NOTE_COLORS_HEX: Record<string, string> = {
  default: "#ffffff",
  red: "#faafa8",
  orange: "#f39f76",
  yellow: "#fff8b8",
  green: "#e2f6d3",
  teal: "#b4ddd3",
  blue: "#d4e4ed",
  darkblue: "#aeccdc",
  purple: "#d3bfdb",
  pink: "#f6e2dd",
  brown: "#e9e3d4",
  gray: "#efeff1",
};

function NoteEditor({
  note,
  onClose,
}: {
  note: PersonalNoteRow;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [newItem, setNewItem] = useState("");
  const items = parseJsonArr<ChecklistItem>(note.items);
  const dirty = title !== note.title || body !== note.body;

  const saveItems = (next: ChecklistItem[]) =>
    void updateNoteFields(note.id, { items: next });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal note-editor"
        style={{ background: NOTE_COLORS_HEX[note.color] ?? "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="메모 내용"
        />
        <div className="check-list">
          {items.map((it, i) => (
            <div key={i} className="check-row">
              <input
                type="checkbox"
                checked={it.done}
                onChange={() =>
                  saveItems(
                    items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)),
                  )
                }
              />
              <span className={it.done ? "done" : ""}>{it.text}</span>
              <button
                type="button"
                className="ghost"
                onClick={() => saveItems(items.filter((_, j) => j !== i))}
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
              saveItems([...items, { text: newItem.trim(), done: false }]);
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
        <div className="swatches">
          {Object.entries(NOTE_COLORS_HEX).map(([key, hex]) => (
            <button
              key={key}
              type="button"
              className={`swatch ${note.color === key ? "on" : ""}`}
              style={{ background: hex }}
              title={key}
              onClick={() => void updateNoteFields(note.id, { color: key })}
            />
          ))}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="primary"
            disabled={!dirty}
            onClick={() => void updateNoteFields(note.id, { title, body })}
          >
            저장
          </button>
          <button
            type="button"
            onClick={() =>
              void updateNoteFields(note.id, { pinned: !note.pinned })
            }
          >
            {note.pinned ? "📌 고정 해제" : "📌 고정"}
          </button>
          <button
            type="button"
            onClick={async () => {
              await updateNoteFields(note.id, { archived: !note.archived });
              onClose();
            }}
          >
            {note.archived ? "보관 해제" : "보관"}
          </button>
          <ConfirmButton
            label="삭제"
            onConfirm={async () => {
              await removeNote(note.id);
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

export default function PersonalNotes() {
  const notes = useLiveQuery(
    (db) =>
      db.select<PersonalNoteRow[]>(
        "SELECT * FROM personal_notes ORDER BY pinned DESC, orderIndex DESC, createdAt DESC",
      ),
    [],
  );
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const visible = (notes ?? []).filter(
    (n) => Boolean(n.archived) === showArchived,
  );
  const editing = editingId
    ? (notes ?? []).find((n) => n.id === editingId)
    : null;

  return (
    <div className="notes-wrap">
      <form
        className="note-composer"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() && !body.trim()) return;
          await addNote({ title: title.trim(), body });
          setTitle("");
          setBody("");
        }}
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="메모 작성…"
        />
        <button type="submit" className="primary" disabled={!title.trim() && !body.trim()}>
          추가
        </button>
      </form>
      <div className="notes-toolbar">
        <button
          type="button"
          className={showArchived ? "" : "on"}
          onClick={() => setShowArchived(false)}
        >
          메모
        </button>
        <button
          type="button"
          className={showArchived ? "on" : ""}
          onClick={() => setShowArchived(true)}
        >
          보관함
        </button>
      </div>
      {visible.length === 0 && (
        <p className="empty">
          {showArchived ? "보관된 메모가 없습니다." : "메모가 없습니다."}
        </p>
      )}
      <div className="note-grid">
        {visible.map((n) => {
          const items = parseJsonArr<ChecklistItem>(n.items);
          return (
            <button
              type="button"
              key={n.id}
              className="note-card"
              style={{ background: NOTE_COLORS_HEX[n.color] ?? "#fff" }}
              onClick={() => setEditingId(n.id)}
            >
              {n.pinned ? <span className="note-pin">📌</span> : null}
              {n.title && <div className="note-title">{n.title}</div>}
              {n.body && <div className="note-body">{n.body}</div>}
              {items.length > 0 && (
                <div className="note-items">
                  {items.slice(0, 6).map((it, i) => (
                    <div key={i} className={it.done ? "done" : ""}>
                      {it.done ? "☑" : "☐"} {it.text}
                    </div>
                  ))}
                  {items.length > 6 && <div>… 외 {items.length - 6}개</div>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {editing && (
        <NoteEditor
          key={editing.id + String(editing.updatedAt)}
          note={editing}
          onClose={() => setEditingId(null)}
        />
      )}
    </div>
  );
}
