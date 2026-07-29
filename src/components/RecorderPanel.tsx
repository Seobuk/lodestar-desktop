import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { notify, useLiveQuery } from "../lib/store";
import {
  deleteRecording,
  listRecordings,
  loadRecordingUrl,
  saveRecording,
} from "../lib/recordings";
import { fmtDateTime } from "../lib/format";
import ConfirmButton from "./ConfirmButton";

// 회의록 녹음 + 실시간 받아쓰기 패널.
// 녹음: MediaRecorder(webm/opus) → 로컬 SQLite(이 PC 전용, 동기화 안 됨).
// 받아쓰기: Rust stt_start/stt_stop(WinRT SpeechRecognizer)이 "stt" 이벤트로
// 파셜(실시간 자막)·확정 문장을 보내고, 확정 문장은 onTranscript로 본문에 붙는다.

const fmtDur = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** 저장된 녹음 목록(재생·삭제) — 편집·열람 화면 공용. */
export function RecordingsList({ meetingKey }: { meetingKey: string }) {
  const recs = useLiveQuery((db) => listRecordings(db, meetingKey), [meetingKey]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(
    () => () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  if (!recs?.length) return null;
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
  /** 받아쓰기 확정 문장 — 부모가 본문 끝에 붙인다. */
  onTranscript: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sttOn, setSttOn] = useState(true);
  const [sttActive, setSttActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [partial, setPartial] = useState("");

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef(0);
  const startedAtRef = useRef(0);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const keyRef = useRef(meetingKey);
  keyRef.current = meetingKey;
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopStt = async () => {
    try {
      await invoke("stt_stop");
    } catch {
      /* 무시 */
    }
    unlistenRef.current?.();
    unlistenRef.current = null;
    setSttActive(false);
    setPartial("");
  };

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

    if (sttOn) {
      unlistenRef.current = await listen<{ kind: string; text?: string }>(
        "stt",
        (e) => {
          if (e.payload.kind === "partial") setPartial(e.payload.text ?? "");
          else if (e.payload.kind === "final" && e.payload.text) {
            setPartial("");
            onTranscriptRef.current(e.payload.text);
          } else if (e.payload.kind === "stopped") setSttActive(false);
        },
      );
      try {
        await invoke("stt_start");
        setSttActive(true);
      } catch (e2) {
        setErr(String(e2));
        unlistenRef.current?.();
        unlistenRef.current = null;
      }
    }
  };

  const stop = async () => {
    window.clearInterval(timerRef.current);
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
    await stopStt();
  };

  // 언마운트(탭·화면 전환) 시 녹음/받아쓰기 정리 — 녹음 데이터는 onstop에서 저장됨
  useEffect(
    () => () => {
      if (mediaRef.current) {
        window.clearInterval(timerRef.current);
        mediaRef.current.stop();
        mediaRef.current = null;
        void invoke("stt_stop").catch(() => {});
        unlistenRef.current?.();
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
            checked={sttOn}
            disabled={recording}
            onChange={(e) => setSttOn(e.target.checked)}
          />
          실시간 받아쓰기
        </label>
        {recording && sttActive && (
          <span className="rec-live">
            {partial ? partial : "듣는 중…"}
          </span>
        )}
      </div>
      {err && <p className="rec-err">{err}</p>}
      <RecordingsList meetingKey={meetingKey} />
      <p className="rec-hint">
        녹음은 이 PC에만 저장됩니다(동기화 안 됨). 받아쓰기는 Windows 내장 음성
        인식(한국어 음성 팩)을 사용해 오프라인에서 동작하며, 확정된 문장이 본문
        끝에 자동으로 추가됩니다.
      </p>
    </div>
  );
}
