import { useEffect, useState } from "react";
import ConfirmButton from "./ConfirmButton";
import {
  STT_MODELS,
  onSttDownload,
  sttDeleteModel,
  sttDownloadModel,
  sttModelsStatus,
  type ModelsStatus,
  type SttModelId,
} from "../lib/stt";

// 설정 모달의 "받아쓰기 모델" 섹션 — 모델별 설치/삭제, 다운로드 진행률.
export default function SttModels() {
  const [status, setStatus] = useState<ModelsStatus | null>(null);
  const [busy, setBusy] = useState<SttModelId | null>(null);
  const [progress, setProgress] = useState<{ pct: number; label: string } | null>(
    null,
  );

  const refresh = () => sttModelsStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    refresh();
    const un = onSttDownload((e) => {
      if (e.done || e.error) return;
      const pct = e.total > 0 ? Math.round((e.received / e.total) * 100) : 0;
      setProgress({ pct, label: e.file.split(/[\\/]/).pop() ?? "" });
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const installed = (id: SttModelId) =>
    status ? status[id] : false;

  const download = async (id: SttModelId) => {
    setBusy(id);
    setProgress({ pct: 0, label: "" });
    try {
      // small/turbo 실시간엔 vad도 필요 — 자동 동반 설치
      if ((id === "small" || id === "turbo") && status && !status.vad) {
        await sttDownloadModel("vad");
      }
      await sttDownloadModel(id);
      await refresh();
    } catch (e) {
      alert(`설치 실패: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const remove = async (id: SttModelId) => {
    await sttDeleteModel(id);
    await refresh();
  };

  return (
    <div className="stt-models">
      <div className="stt-models-head">받아쓰기 모델 (오프라인)</div>
      {STT_MODELS.map((m) => (
        <div key={m.id} className="stt-model-row">
          <div className="stt-model-info">
            <span className="stt-model-label">{m.label}</span>
            <span className="stt-model-note">
              {m.size} · {m.note}
            </span>
          </div>
          {busy === m.id ? (
            <span className="stt-progress">
              {progress ? `${progress.pct}%` : "…"}
            </span>
          ) : installed(m.id) ? (
            <span className="stt-model-actions">
              <span className="stt-installed">설치됨</span>
              <ConfirmButton label="삭제" onConfirm={() => void remove(m.id)} />
            </span>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy !== null}
              onClick={() => void download(m.id)}
            >
              설치
            </button>
          )}
        </div>
      ))}
      <p className="hint">
        모델은 최초 1회 다운로드 후 오프라인으로 동작합니다. 실시간 자막은 표준
        (small)+음성 구간 감지가, 정밀 전사는 설치된 모델 중 고품질을 씁니다.
      </p>
    </div>
  );
}
