import { useEffect, useState } from "react";
import { ALLOWED_SERVERS, DEFAULT_SERVER, getMeta, setMeta } from "../lib/settings";
import { scheduleSync, syncState } from "../lib/sync";
import { useVersion } from "../lib/store";
import { fmtDateTime } from "../lib/format";

export default function Settings({ onClose }: { onClose: () => void }) {
  useVersion();
  const [url, setUrl] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setUrl((await getMeta("serverUrl")) || DEFAULT_SERVER);
      setToken((await getMeta("token")) || "");
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>설정</h2>
        <label>
          서버 주소
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_SERVER}
          />
        </label>
        <label>
          API 토큰 (PAT)
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="lsk_…"
          />
        </label>
        <p className="hint">
          토큰은 로드스타 웹의 <b>🔑 /token</b> 페이지에서 발급합니다. 프로젝트
          접근 권한이 있는 계정이어야 합니다.
        </p>
        <div className="sync-info">
          <div>마지막 동기화: {fmtDateTime(syncState.lastSyncAt) || "없음"}</div>
          {syncState.pendingOps > 0 && (
            <div>전송 대기 작업: {syncState.pendingOps}개</div>
          )}
          {syncState.errors.length > 0 && (
            <ul className="sync-errors">
              {syncState.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const normalized = (url.trim() || DEFAULT_SERVER).replace(/\/+$/, "");
              // 빌드 타임 http 스코프 밖 주소는 요청이 거부돼 영원한 '오프라인'이 된다.
              if (!ALLOWED_SERVERS.includes(normalized)) {
                setErr(
                  `이 빌드는 다음 서버만 허용합니다: ${ALLOWED_SERVERS.join(", ")}`,
                );
                return;
              }
              await setMeta("serverUrl", normalized);
              await setMeta("token", token.trim());
              scheduleSync(0);
              onClose();
            }}
          >
            저장 후 동기화
          </button>
          {err && <span className="sync-errors">{err}</span>}
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
