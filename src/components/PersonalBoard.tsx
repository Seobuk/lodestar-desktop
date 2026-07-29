import { useEffect, useState } from "react";
import { useLiveQuery } from "../lib/store";
import { addPost, removePost, updatePostFields } from "../lib/mutations";
import { fmtDateTime } from "../lib/format";
import MarkdownView from "./MarkdownView";
import Editor from "./Editor";
import ConfirmButton from "./ConfirmButton";
import type { PersonalPostRow } from "../lib/types";

type Mode = { t: "list" } | { t: "read"; id: string } | { t: "edit"; id: string | null };

function PostEdit({
  post,
  onDone,
  onCancel,
}: {
  post: PersonalPostRow | null;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [pinned, setPinned] = useState(Boolean(post?.pinned));
  return (
    <div className="meeting-edit">
      <div className="meeting-edit-head">
        <input
          type="text"
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="글 제목"
          autoFocus
        />
        <label className="pin-check">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          📌 고정
        </label>
      </div>
      <Editor value={body} onChange={setBody} placeholder="내용 (마크다운)" />
      <div className="btn-row">
        <button
          type="button"
          className="primary"
          disabled={!title.trim()}
          onClick={async () => {
            if (post) {
              await updatePostFields(post.id, { title: title.trim(), body, pinned });
              onDone(post.id);
            } else {
              const id = await addPost(title.trim(), body, pinned);
              onDone(id);
            }
          }}
        >
          저장
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

export default function PersonalBoard() {
  const posts = useLiveQuery(
    (db) =>
      db.select<PersonalPostRow[]>(
        "SELECT * FROM personal_posts ORDER BY pinned DESC, createdAt DESC",
      ),
    [],
  );
  const [mode, setMode] = useState<Mode>({ t: "list" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode((m) => (m.t === "read" ? { t: "list" } : m));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (mode.t === "read") {
    const post = (posts ?? []).find((p) => p.id === mode.id);
    if (!post) return <p className="empty">글을 찾을 수 없습니다.</p>;
    return (
      <article className="meeting-read">
        <header>
          <h2>
            {post.pinned ? "📌 " : ""}
            {post.title}
          </h2>
          <div className="meta">{fmtDateTime(post.createdAt)}</div>
          <div className="btn-row">
            <button type="button" onClick={() => setMode({ t: "edit", id: post.id })}>
              편집
            </button>
            <ConfirmButton
              label="삭제"
              onConfirm={async () => {
                await removePost(post.id);
                setMode({ t: "list" });
              }}
            />
          </div>
        </header>
        <MarkdownView src={post.body} />
      </article>
    );
  }

  if (mode.t === "edit") {
    const post = mode.id ? ((posts ?? []).find((p) => p.id === mode.id) ?? null) : null;
    return (
      <PostEdit
        post={post}
        onDone={(id) => setMode({ t: "read", id })}
        onCancel={() => setMode(mode.id ? { t: "read", id: mode.id } : { t: "list" })}
      />
    );
  }

  return (
    <div className="meetings-list">
      <div className="list-head">
        <h3>개인 게시판</h3>
        <button
          type="button"
          className="primary"
          onClick={() => setMode({ t: "edit", id: null })}
        >
          + 새 글
        </button>
      </div>
      {posts?.length === 0 && <p className="empty">아직 글이 없습니다.</p>}
      {posts?.map((p) => (
        <button
          type="button"
          key={p.id}
          className="meeting-row"
          onClick={() => setMode({ t: "read", id: p.id })}
        >
          <span className="meeting-title">
            {p.pinned ? "📌 " : ""}
            {p.title}
          </span>
          <span className="meta">{fmtDateTime(p.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}
