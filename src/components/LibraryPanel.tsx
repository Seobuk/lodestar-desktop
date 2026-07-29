import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLiveQuery } from "../lib/store";
import { getMeta, DEFAULT_SERVER } from "../lib/settings";
import {
  addLibItem,
  removeLibItem,
  restoreLibItem,
  trashLibItem,
  updateLibItemFields,
} from "../lib/mutations";
import ConfirmButton from "./ConfirmButton";
import { parseJsonArr } from "./PersonalKanban";
import type { LibCollectionRow, LibItemRow } from "../lib/types";

// 개인 서재 — 데스크톱 v1은 카탈로그: 컬렉션별 탐색·검색·메타데이터/메모 편집·
// 휴지통. 컬렉션 편집과 PDF 업로드는 웹 전용, PDF 열람은 온라인에서 브라우저로.

function ItemDetail({ item }: { item: LibItemRow }) {
  const [f, setF] = useState({
    title: item.title,
    authors: item.authors ?? "",
    year: item.year != null ? String(item.year) : "",
    venue: item.venue ?? "",
    doi: item.doi ?? "",
    url: item.url ?? "",
    tags: parseJsonArr<string>(item.tags).join(", "),
    note: item.note ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const orig = {
    title: item.title,
    authors: item.authors ?? "",
    year: item.year != null ? String(item.year) : "",
    venue: item.venue ?? "",
    doi: item.doi ?? "",
    url: item.url ?? "",
    tags: parseJsonArr<string>(item.tags).join(", "),
    note: item.note ?? "",
  };
  const dirty = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== orig[k]);

  const save = async () => {
    const data: Record<string, unknown> = {};
    if (f.title !== orig.title && f.title.trim()) data.title = f.title.trim();
    if (f.authors !== orig.authors) data.authors = f.authors || null;
    if (f.year !== orig.year) data.year = f.year ? Number(f.year) : null;
    if (f.venue !== orig.venue) data.venue = f.venue || null;
    if (f.doi !== orig.doi) data.doi = f.doi || null;
    if (f.url !== orig.url) data.url = f.url || null;
    if (f.tags !== orig.tags)
      data.tags = f.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (f.note !== orig.note) data.note = f.note || null;
    if (Object.keys(data).length) await updateLibItemFields(item.id, data);
  };

  const openPdf = async () => {
    if (!item.fileUrl) return;
    const server = (await getMeta("serverUrl")) || DEFAULT_SERVER;
    const url = /^https?:/i.test(item.fileUrl)
      ? item.fileUrl
      : server.replace(/\/+$/, "") + item.fileUrl;
    await openUrl(url); // 첨부는 세션 인증이라 브라우저(로그인돼 있음)로 연다
  };

  const trashed = Boolean(item.deletedAt);

  return (
    <div className="lib-detail card">
      <div className="lib-grid">
        <label>
          제목
          <input type="text" value={f.title} onChange={set("title")} />
        </label>
        <label>
          저자
          <input type="text" value={f.authors} onChange={set("authors")} />
        </label>
        <label>
          연도
          <input type="number" value={f.year} onChange={set("year")} />
        </label>
        <label>
          저널/출처
          <input type="text" value={f.venue} onChange={set("venue")} />
        </label>
        <label>
          DOI
          <input type="text" value={f.doi} onChange={set("doi")} />
        </label>
        <label>
          URL
          <input type="text" value={f.url} onChange={set("url")} />
        </label>
        <label className="wide">
          태그 (쉼표 구분)
          <input type="text" value={f.tags} onChange={set("tags")} />
        </label>
        <label className="wide">
          메모
          <textarea rows={4} value={f.note} onChange={set("note")} />
        </label>
      </div>
      <div className="btn-row">
        <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
          저장
        </button>
        {item.fileUrl && (
          <button type="button" onClick={() => void openPdf()}>
            PDF 열기 (브라우저)
          </button>
        )}
        {!trashed ? (
          <ConfirmButton
            label="휴지통으로"
            confirmLabel="휴지통으로?"
            onConfirm={() => void trashLibItem(item.id)}
          />
        ) : (
          <>
            <button type="button" onClick={() => void restoreLibItem(item.id)}>
              복원
            </button>
            <ConfirmButton
              label="영구 삭제"
              confirmLabel="정말 영구 삭제?"
              onConfirm={() => void removeLibItem(item.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function LibraryPanel() {
  const collections = useLiveQuery(
    (db) =>
      db.select<LibCollectionRow[]>(
        "SELECT * FROM library_collections ORDER BY name",
      ),
    [],
  );
  const items = useLiveQuery(
    (db) =>
      db.select<LibItemRow[]>(
        "SELECT * FROM library_items ORDER BY createdAt DESC",
      ),
    [],
  );
  const [colSel, setColSel] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [newInput, setNewInput] = useState("");

  const filtered = (items ?? []).filter((it) => {
    if (colSel === "trash") {
      if (!it.deletedAt) return false;
    } else {
      if (it.deletedAt) return false;
      if (colSel === "none" && it.collectionId) return false;
      if (colSel !== "all" && colSel !== "none" && it.collectionId !== colSel)
        return false;
    }
    if (q.trim()) {
      const hay = `${it.title} ${it.authors ?? ""} ${it.venue ?? ""} ${it.tags}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const sel = selId ? filtered.find((i) => i.id === selId) : null;
  const trashCount = (items ?? []).filter((i) => i.deletedAt).length;

  return (
    <div className="lib-layout">
      <aside className="lib-side">
        {(
          [
            ["all", "전체"],
            ["none", "미분류"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={colSel === key ? "on" : ""}
            onClick={() => {
              setColSel(key);
              setSelId(null);
            }}
          >
            {label}
          </button>
        ))}
        {collections?.map((c) => (
          <button
            key={c.id}
            type="button"
            className={colSel === c.id ? "on" : ""}
            onClick={() => {
              setColSel(c.id);
              setSelId(null);
            }}
          >
            📁 {c.name}
          </button>
        ))}
        <button
          type="button"
          className={colSel === "trash" ? "on" : ""}
          onClick={() => {
            setColSel("trash");
            setSelId(null);
          }}
        >
          🗑 휴지통 {trashCount > 0 ? `(${trashCount})` : ""}
        </button>
      </aside>
      <div className="lib-main">
        <div className="lib-toolbar">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목·저자·태그 검색"
          />
          {colSel !== "trash" && (
            <form
              className="lib-add"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newInput.trim()) return;
                const id = await addLibItem(
                  newInput.trim(),
                  colSel !== "all" && colSel !== "none" ? colSel : null,
                );
                setNewInput("");
                setSelId(id);
              }}
            >
              <input
                type="text"
                value={newInput}
                onChange={(e) => setNewInput(e.target.value)}
                placeholder="DOI·URL·제목으로 항목 추가 (서지 자동채움은 동기화 때)"
              />
              <button type="submit" className="primary" disabled={!newInput.trim()}>
                추가
              </button>
            </form>
          )}
        </div>
        {filtered.length === 0 && <p className="empty">항목이 없습니다.</p>}
        <div className="lib-table">
          {filtered.map((it) => (
            <button
              type="button"
              key={it.id}
              className={`lib-row ${selId === it.id ? "on" : ""}`}
              onClick={() => setSelId(it.id)}
            >
              <span className="lib-title">
                {it.fileUrl ? "📄 " : ""}
                {it.title}
              </span>
              <span className="lib-meta">
                {[it.authors, it.year].filter(Boolean).join(" · ")}
              </span>
              <span className="lib-tags">
                {parseJsonArr<string>(it.tags)
                  .slice(0, 3)
                  .map((t) => (
                    <span key={t} className="chip">
                      {t}
                    </span>
                  ))}
              </span>
            </button>
          ))}
        </div>
        {sel && <ItemDetail key={sel.id + String(sel.updatedAt)} item={sel} />}
      </div>
    </div>
  );
}
