import { useVersion } from "../lib/store";
import { applyUpdate, downloadUpdate, updateState } from "../lib/updater";

// 업데이트 배너 — 상태는 lib/updater가 소유(시작 시·4시간마다 자동 확인,
// 자동 다운로드 설정에 따라 미리 받아 둠). 적용만 사용자가 누른다(재시작 수반).
export default function UpdateBanner() {
  useVersion();
  const s = updateState;

  if (s.phase === "available")
    return (
      <div className="update-banner">
        새 버전 v{s.version}{" "}
        <button type="button" className="link" onClick={() => void downloadUpdate()}>
          다운로드
        </button>
      </div>
    );
  if (s.phase === "downloading")
    return (
      <div className="update-banner">
        새 버전 v{s.version} 다운로드 중… {s.progress}%
      </div>
    );
  if (s.phase === "ready")
    return (
      <div className="update-banner">
        v{s.version} 준비 완료 —{" "}
        <button type="button" className="link" onClick={() => void applyUpdate()}>
          지금 적용 (다시 시작)
        </button>
      </div>
    );
  return null;
}
