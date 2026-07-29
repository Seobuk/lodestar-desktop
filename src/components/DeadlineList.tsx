import { useState } from "react";
import { useLiveQuery } from "../lib/store";
import { listDeadlines } from "../lib/queries";
import {
  addDeadline,
  removeDeadline,
  updateDeadlineFields,
} from "../lib/mutations";
import { dday, fmtDate } from "../lib/format";
import ConfirmButton from "./ConfirmButton";
import type { DeadlineRow } from "../lib/types";

function DDayBadge({ date }: { date: string }) {
  const label = dday(date);
  const cls =
    label === "D-DAY" ? "dday now" : label.startsWith("D+") ? "dday past" : "dday";
  return <span className={cls}>{label}</span>;
}

function Row({ item }: { item: DeadlineRow }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(fmtDate(item.date));
  const [content, setContent] = useState(item.content);

  if (editing) {
    return (
      <div className="dl-row editing">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용"
        />
        <button
          type="button"
          className="primary"
          disabled={!date}
          onClick={async () => {
            await updateDeadlineFields(item.id, { date, content });
            setEditing(false);
          }}
        >
          저장
        </button>
        <button type="button" onClick={() => setEditing(false)}>
          취소
        </button>
      </div>
    );
  }
  return (
    <div className="dl-row">
      <DDayBadge date={item.date} />
      <span className="dl-date">{fmtDate(item.date)}</span>
      <span className="dl-content">{item.content}</span>
      <span className="row-actions">
        <button
          type="button"
          title="수정"
          onClick={() => {
            setDate(fmtDate(item.date));
            setContent(item.content);
            setEditing(true);
          }}
        >
          ✎
        </button>
        <ConfirmButton label="삭제" onConfirm={() => void removeDeadline(item.id)} />
      </span>
    </div>
  );
}

export default function DeadlineList({
  scopeType,
  scopeId,
  title,
}: {
  scopeType: "project" | "task";
  scopeId: string;
  title: string;
}) {
  const items = useLiveQuery(
    (db) => listDeadlines(db, scopeType, scopeId),
    [scopeType, scopeId],
  );
  const [date, setDate] = useState("");
  const [content, setContent] = useState("");

  return (
    <section className="card">
      <h3>{title}</h3>
      {items?.length === 0 && <p className="empty">등록된 마감이 없습니다.</p>}
      {items?.map((it) => <Row key={it.id} item={it} />)}
      <form
        className="dl-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!date) return;
          await addDeadline(scopeType, scopeId, date, content.trim());
          setDate("");
          setContent("");
        }}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="내용 (선택)"
        />
        <button type="submit" className="primary" disabled={!date}>
          추가
        </button>
      </form>
    </section>
  );
}
