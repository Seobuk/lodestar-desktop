import { useEffect, useRef, useState } from "react";
import { notify, useLiveQuery } from "../lib/store";
import {
  deleteRecording,
  listRecordings,
  loadRecordingBlob,
  loadRecordingUrl,
  saveRecording,
} from "../lib/recordings";
import {
  RealtimeStt,
  sttModelsStatus,
  transcribeBlob,
  type ModelsStatus,
  type SttEvent,
} from "../lib/stt";
import { fmtDateTime } from "../lib/format";
import ConfirmButton from "./ConfirmButton";

// 회의록 녹음 + 받아쓰기(sherpa-onnx 오프라인).
// 녹음: MediaRecorder(webm/opus) → 로컬 SQLite(이 PC 전용, 동기화 안 됨).
// 준실시간: 같은 마이크 스트림을 16kHz로 캡처 → Rust VAD+whisper → 확정 문장을 본문에.
// 정밀 전사: 저장된 녹음 전체를 whisper로 한 번에(고품질, 회의 후).

const fmtDur = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** 저장된 녹음 목록(재생·정밀 전사·삭제). onTranscript가 있으면 정밀 전사 버튼 노출. */
export function RecordingsList({
  meetingKey,
  models,
  onTranscript,
}: {
  meetingKey: string;
  models?: ModelsStatus | null;
  onTranscript?: (text: string) => void;
}) {
  const recs = useLiveQuery((db) => listRecordings(db, meetingKey), [meetingKey]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(
    () => () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  if (!recs?.length) return null;
  const preciseModel = models?.turbo ? "turbo" : models?.small ? "small" : null;
  return (
    <div className="rec-list">
      {recs.map((r) => (
        <div key={r.id} className="rec-row">
          <span className="rec-meta">
            🎙 {fmtDateTime(r.createdAt)} · {fmtDur(r.durationSec)}
          </span>
          {urls[r.id] ? (
            <audio controls src={urls[r.id]} />
          ) : (
            <button
              type="button"
              onClick={async () => {
                const url = await loadRecordingUrl(r.id);
                setUrls((u) => ({ ...u, [r.id]: url }));
              }}
            >
              ▶ 재생
            </button>
          )}
          {onTranscript && preciseModel && (
            <button
              type="button"
              disabled={busy === r.id}
              title={`Whisper ${preciseModel}로 정밀 전사해 본문에 추가`}
              onClick={async () => {
                setBusy(r.id);
                try {
                  const blob = await loadRecordingBlob(r.id);
                  const text = await transcribeBlob(blob, preciseModel);
                  if (text.trim()) onTranscript(text.trim());
                } catch (e) {
                  alert(`정밀 전사 실패: ${(e as Error).message}`);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === r.id ? "전사 중…" : "✍ 정밀 전사"}
            </button>
          )}
          <ConfirmButton
            label="삭제"
            onConfirm={async () => {
              await deleteRecording(r.id);
              notify();
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default function RecorderPanel({
  meetingKey,
  onTranscript,
}: {
  meetingKey: string;
  /** 받아쓰기(준실시간·정밀) 확정 문장 — 부모가 본문 끝에 붙인다. */
  onTranscript: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sttOn, setSttOn] = useState(true);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelsStatus | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const sttRef = useRef<RealtimeStt | null>(null);
  const keyRef = useRef(meetingKey);
  keyRef.current = meetingKey;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    sttModelsStatus().then(setModels).catch(() => setModels(null));
  }, []);

  const realtimeReady = Boolean(models?.small && models?.vad);

  const start = async () => {
    setErr(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr("마이크를 열 수 없습니다 — 장치와 권한을 확인하세요.");
      return;
    }
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const dur = Math.round((Date.now() - startedAtRef.current) / 1000);
      if (blob.size > 0) {
        await saveRecording(keyRef.current, blob, dur);
        notify();
      }
    };
    mr.start(1000);
    mediaRef.current = mr;
    startedAtRef.current = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(
      () => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)),
      1000,
    );
    setRecording(true);

    if (sttOn && realtimeReady) {
      const rt = new RealtimeStt();
      sttRef.current = rt;
      try {
        await rt.start(stream, "small", (e: SttEvent) => {
          if (e.kind === "ready") setStatus("듣는 중…");
          else if (e.kind === "decoding") setStatus("인식 중…");
          else if (e.kind === "final") {
            setStatus("듣는 중…");
            onTranscriptRef.current(e.text);
          } else if (e.kind === "error") setErr(e.text);
        });
      } catch (e) {
        setErr(`받아쓰기 시작 실패: ${(e as Error).message}`);
        sttRef.current = null;
      }
    }
  };

  const stop = async () => {
    window.clearInterval(timerRef.current);
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
    setStatus("");
    await sttRef.current?.stop();
    sttRef.current = null;
  };

  // 언마운트 시 정리
  useEffect(
    () => () => {
      if (mediaRef.current) {
        window.clearInterval(timerRef.current);
        mediaRef.current.stop();
        mediaRef.current = null;
        void sttRef.current?.stop();
      }
    },
    [],
  );

  return (
    <div className="rec-panel">
      <div className="rec-controls">
        {recording ? (
          <button type="button" className="rec-stop" onClick={() => void stop()}>
            ■ 정지 {fmtDur(elapsed)}
          </button>
        ) : (
          <button type="button" className="rec-start" onClick={() => void start()}>
            ● 녹음
          </button>
        )}
        <label className="pin-check">
          <input
            type="checkbox"
            checked={sttOn && realtimeReady}
            disabled={recording || !realtimeReady}
            onChange={(e) => setSttOn(e.target.checked)}
          />
          실시간 받아쓰기
        </label>
        {recording && status && <span className="rec-live">{status}</span>}
      </div>
      {err && <p className="rec-err">{err}</p>}
      {!realtimeReady && (
        <p className="rec-hint">
          실시간 받아쓰기를 쓰려면 설정(⚙)의 <b>받아쓰기 모델</b>에서 표준(Whisper
          small)과 음성 구간 감지 모델을 설치하세요. 녹음만은 모델 없이도 됩니다.
        </p>
      )}
      <RecordingsList
        meetingKey={meetingKey}
        models={models}
        onTranscript={onTranscript}
      />
      <p className="rec-hint">
        녹음은 이 PC에만 저장됩니다(동기화 안 됨). 받아쓰기는 완전 오프라인으로
        동작하며, 실시간은 발화 단위로 본문에 추가됩니다. 녹음 옆 <b>정밀 전사</b>는
        회의 후 전체를 고품질로 다시 받아씁니다.
      </p>
    </div>
  );
}
