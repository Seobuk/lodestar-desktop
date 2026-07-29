import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// 받아쓰기(sherpa-onnx) 프론트 연동. Rust 커맨드 얇은 래퍼 + 오디오 캡처/디코드.

export type ModelsStatus = { small: boolean; turbo: boolean; vad: boolean };

export type SttModelId = "small" | "turbo" | "vad";

export const STT_MODELS: {
  id: SttModelId;
  label: string;
  size: string;
  note: string;
}[] = [
  { id: "vad", label: "음성 구간 감지 (Silero VAD)", size: "1MB", note: "실시간 받아쓰기에 필요" },
  { id: "small", label: "표준 (Whisper small)", size: "약 250MB", note: "실시간 자막 + 정밀 전사" },
  { id: "turbo", label: "고품질 (Whisper turbo)", size: "약 300MB", note: "정밀 전사 전용(실시간엔 무거움)" },
];

export const sttModelsStatus = () => invoke<ModelsStatus>("stt_models_status");
export const sttDownloadModel = (model: SttModelId) =>
  invoke<void>("stt_download_model", { model });
export const sttDeleteModel = (model: SttModelId) =>
  invoke<void>("stt_delete_model", { model });

export type DownloadEvent = {
  model: string;
  file: string;
  received: number;
  total: number;
  done: boolean;
  error: string | null;
};
export const onSttDownload = (cb: (e: DownloadEvent) => void) =>
  listen<DownloadEvent>("stt-download", (e) => cb(e.payload));

export type SttEvent =
  | { kind: "ready" }
  | { kind: "decoding" }
  | { kind: "final"; text: string }
  | { kind: "error"; text: string }
  | { kind: "stopped" };

// ----- 준실시간: 마이크 → 16k PCM → Rust VAD/whisper --------------------

export class RealtimeStt {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private unlisten: UnlistenFn | null = null;

  /** stream = 이미 열린 마이크 MediaStream(녹음과 공유). model = "small". */
  async start(
    stream: MediaStream,
    model: "small",
    onEvent: (e: SttEvent) => void,
  ): Promise<void> {
    this.unlisten = await listen<SttEvent>("stt", (e) => onEvent(e.payload));
    await invoke("stt_realtime_start", { model });

    // AudioContext를 16kHz로 강제 → 마이크가 자동 리샘플됨(수동 리샘플 불필요).
    this.ctx = new AudioContext({ sampleRate: 16000 });
    await this.ctx.audioWorklet.addModule("/stt-worklet.js");
    const src = this.ctx.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(this.ctx, "stt-capture");
    this.node.port.onmessage = (ev) => {
      void invoke("stt_feed", { samples: Array.from(ev.data as Float32Array) });
    };
    src.connect(this.node);
    // 워클릿 출력은 스피커로 보내지 않는다(피드백 방지) — connect(destination) 생략.
  }

  async stop(): Promise<void> {
    try {
      this.node?.port.close();
      this.node?.disconnect();
      await this.ctx?.close();
    } catch {
      /* 무시 */
    }
    this.node = null;
    this.ctx = null;
    await invoke("stt_realtime_stop").catch(() => {});
    this.unlisten?.();
    this.unlisten = null;
  }
}

// ----- 정밀 전사: webm 녹음 → 16k mono PCM → whisper --------------------

/** 저장된 녹음(webm blob)을 16kHz mono Float32로 디코드해 whisper로 전사. */
export async function transcribeBlob(
  blob: Blob,
  model: "small" | "turbo",
): Promise<string> {
  const buf = await blob.arrayBuffer();
  const tmp = new AudioContext();
  const decoded = await tmp.decodeAudioData(buf);
  await tmp.close();
  // 16kHz mono로 리샘플
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const samples = Array.from(rendered.getChannelData(0));
  return invoke<string>("stt_transcribe", { model, samples, sampleRate: 16000 });
}
