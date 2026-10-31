import { useEffect, useRef, useState } from "react";
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

function Swatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (key: string | null) => void;
}) {
  return (
    <div className="swatches">
      {["", ...Object.keys(CARD_COLORS)].map((key) => (
        <button
          key={key || "none"}
          type="button"
          className={`swatch ${value === key ? "on" : ""}`}
          style={{ background: key ? CARD_COLORS[key] : "#fff" }}
          title={key || "기본색"}
          onClick={() => onPick(key || null)}
        />
      ))}
    </div>
  );
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
        <Swatches
          value={card.color ?? ""}
          onPick={(color) => void updateCardFields(card.id, { color })}
        />
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
  // 드래그 중 삽입 지점: status 컬럼의 index번째 카드 앞
  const [over, setOver] = useState<{ status: string; index: number } | null>(
    null,
  );
  const [adding, setAdding] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );

  const byCol = (status: string) =>
    (cards ?? []).filter((c) => c.status === status);

  // dragover는 초당 수십 번 오므로 값이 바뀔 때만 setState
  const setSlot = (status: string, index: number) =>
    setOver((o) =>
      o && o.status === status && o.index === index ? o : { status, index },
    );

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  // sync pull이 드래그 중인 카드를 지우거나 다른 컬럼으로 옮기면 소스 버튼이
  // 언마운트되어 dragend가 오지 않는다(dragId 고착) — 여기서 정리
  const dragStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!dragId) return;
    const c = (cards ?? []).find((x) => x.id === dragId);
    if (!c || c.status !== dragStatus.current) endDrag();
  }, [cards, dragId]);

  const dropTo = async (status: string, index: number) => {
    if (!dragId) return;
    const list = byCol(status);
    const prev = list.slice(0, index).filter((c) => c.id !== dragId).pop();
    const next = list.slice(index).find((c) => c.id !== dragId);
    // ponytail: REAL 중간값 삽입 — 개인 보드 규모에선 정밀도 고갈 없음
    const orderIndex =
      prev && next
        ? (prev.orderIndex + next.orderIndex) / 2
        : prev
          ? prev.orderIndex + 1
          : next
            ? next.orderIndex - 1
            : 1;
    endDrag();
    await updateCardFields(dragId, { status, orderIndex });
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
          onDragOver={(e) => {
            if (!dragId) return; // 텍스트·파일 등 카드가 아닌 드래그는 무시
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            // 카드 rect 중점 기준 최근접 슬롯 — 히트된 요소와 무관하게
            // Y좌표로 연속 계산하므로 카드 사이 틈·표시선 위에서도 정확
            const els = e.currentTarget.querySelectorAll<HTMLElement>(".pk-card");
            let index = els.length;
            for (let i = 0; i < els.length; i++) {
              const r = els[i].getBoundingClientRect();
              if (e.clientY < r.top + r.height / 2) {
                index = i;
                break;
              }
            }
            setSlot(status, index);
          }}
          onDragLeave={(e) => {
            // 컬럼을 완전히 벗어나면 표시선 제거 — 커서가 없는 곳에 삽입을 약속하지 않게
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setOver((o) => (o?.status === status ? null : o));
          }}
          onDrop={(e) => {
            e.preventDefault();
            void dropTo(status, over?.status === status ? over.index : byCol(status).length);
          }}
        >
          <div className="pk-col-head">
            {label}
            <span className="cnt">{byCol(status).length}</span>
          </div>
          {byCol(status).map((c, i, list) => {
            const items = parseJsonArr<ChecklistItem>(c.checklist);
            const done = items.filter((i) => i.done).length;
            const slotOn = (idx: number) =>
              over?.status === status &&
              over.index === idx &&
              // 자기 자신 앞뒤 슬롯은 이동해 봐야 제자리 → 표시 안 함
              list[idx]?.id !== dragId &&
              list[idx - 1]?.id !== dragId;
            return (
              <div key={c.id} className="pk-slot">
                {slotOn(i) && <div className="pk-drop" />}
                <button
                  type="button"
                  className={`pk-card ${c.id === dragId ? "dragging" : ""}`}
                  style={
                    c.color && CARD_COLORS[c.color]
                      ? { background: CARD_COLORS[c.color] }
                      : undefined
                  }
                  draggable
                  onDragStart={(e) => {
                    // setData 없으면 일부 웹뷰에서 드래그가 시작조차 안 된다
                    e.dataTransfer.setData("text/plain", c.id);
                    e.dataTransfer.effectAllowed = "move";
                    dragStatus.current = c.status;
                    setDragId(c.id);
                  }}
                  onDragEnd={endDrag}
                  onClick={() => setEditingId(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      id: c.id,
                      x: Math.min(e.clientX, window.innerWidth - 200),
                      y: Math.min(e.clientY, window.innerHeight - 120),
                    });
                  }}
                >
                  <span className="pk-title">{c.title}</span>
                  {items.length > 0 && (
                    <span className="pk-check">
                      ☑ {done}/{items.length}
                    </span>
                  )}
                </button>
                {i === list.length - 1 && slotOn(i + 1) && (
                  <div className="pk-drop end" />
                )}
              </div>
            );
          })}
          {byCol(status).length === 0 && over?.status === status && (
            <div className="pk-drop empty" />
          )}
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
      {menu && (
        <div
          className="ctx-overlay"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(null);
          }}
        >
          <div
            className="ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <Swatches
              value={(cards ?? []).find((c) => c.id === menu.id)?.color ?? ""}
              onPick={(color) => void updateCardFields(menu.id, { color })}
            />
            <ConfirmButton
              label="카드 삭제"
              onConfirm={async () => {
                await removeCard(menu.id);
                setMenu(null);
              }}
            />
          </div>
        </div>
      )}
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
