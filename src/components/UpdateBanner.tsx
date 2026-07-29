import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// 자동 업데이트 — 시작 시 GitHub Releases의 latest.json을 확인하고, 새 버전이
// 있으면 사이드바 상단에 배너를 띄운다. 설치는 사용자가 누를 때만(강제 없음).
export default function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [state, setState] = useState<"idle" | "downloading" | "ready" | "error">(
    "idle",
  );

  useEffect(() => {
    // 개발 모드·오프라인·릴리즈 없음 등은 조용히 무시
    check()
      .then((u) => {
        if (u) setUpdate(u);
      })
      .catch(() => {});
  }, []);

  if (!update) return null;
  return (
    <div className="update-banner">
      {state === "ready" ? (
        <>
          설치 완료 —{" "}
          <button type="button" className="link" onClick={() => void relaunch()}>
            다시 시작
          </button>
        </>
      ) : state === "downloading" ? (
        <>새 버전 설치 중…</>
      ) : state === "error" ? (
        <>업데이트 실패 — 다음에 다시 시도합니다.</>
      ) : (
        <>
          새 버전 v{update.version}{" "}
          <button
            type="button"
            className="link"
            onClick={async () => {
              setState("downloading");
              try {
                await update.downloadAndInstall();
                setState("ready");
              } catch {
                setState("error");
              }
            }}
          >
            설치
          </button>
        </>
      )}
    </div>
  );
}
