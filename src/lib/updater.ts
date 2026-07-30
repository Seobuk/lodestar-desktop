import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getMeta, setMeta } from "./settings";
import { notify } from "./store";

// 자동 업데이트 — 시작 시 + 4시간마다 GitHub Releases 확인. "자동 다운로드"가
// 켜져 있으면(기본) 새 버전을 백그라운드로 받아 두고, 적용(앱 재시작 수반)은
// 배너에서 클릭 한 번 — 작업 중 갑작스런 재시작을 피하기 위한 의도적 설계.

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "none"
  | "error";

export const updateState: {
  phase: UpdatePhase;
  version: string | null;
  progress: number;
  error: string | null;
} = { phase: "idle", version: null, progress: 0, error: null };

let pending: Update | null = null;

export async function autoUpdateEnabled(): Promise<boolean> {
  return (await getMeta("autoUpdate")) !== "0";
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  await setMeta("autoUpdate", on ? "1" : "0");
  notify();
}

export async function checkForUpdate(manual = false): Promise<void> {
  if (updateState.phase === "downloading" || updateState.phase === "ready")
    return;
  updateState.phase = "checking";
  updateState.error = null;
  notify();
  try {
    const u = await check();
    if (!u) {
      // manual이면 "최신 버전" 표시를 잠시 유지, 자동이면 조용히
      updateState.phase = manual ? "none" : "idle";
      notify();
      return;
    }
    pending = u;
    updateState.version = u.version;
    updateState.phase = "available";
    notify();
    if (await autoUpdateEnabled()) await downloadUpdate();
  } catch (e) {
    updateState.phase = manual ? "error" : "idle";
    updateState.error = String(e);
    notify();
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!pending || updateState.phase === "downloading") return;
  updateState.phase = "downloading";
  updateState.progress = 0;
  notify();
  let received = 0;
  let total = 0;
  try {
    await pending.download((ev: DownloadEvent) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? 0;
      } else if (ev.event === "Progress") {
        received += ev.data.chunkLength;
        if (total > 0) {
          const p = Math.round((received / total) * 100);
          if (p !== updateState.progress) {
            updateState.progress = p;
            notify();
          }
        }
      }
    });
    updateState.phase = "ready";
    notify();
  } catch (e) {
    updateState.phase = "error";
    updateState.error = String(e);
    notify();
  }
}

/** 적용 — Windows에선 앱이 종료되고 설치기가 돈다. */
export async function applyUpdate(): Promise<void> {
  if (!pending) return;
  await pending.install();
  await relaunch().catch(() => {});
}

let started = false;
export function startUpdateChecks(): void {
  if (started) return;
  started = true;
  void checkForUpdate();
  window.setInterval(
    () => {
      if (updateState.phase === "idle" || updateState.phase === "none")
        void checkForUpdate();
    },
    4 * 3600 * 1000,
  );
}
