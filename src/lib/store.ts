import { useEffect, useState, useSyncExternalStore } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { getDb } from "./db";

// 아주 작은 무효화 스토어 — 로컬 DB가 바뀔 때 notify()가 버전을 올리고,
// useLiveQuery를 쓰는 컴포넌트가 전부 재조회한다. 데이터 규모가 팀 단위라
// 전면 재조회가 싸다. (상태관리 라이브러리 불필요)

const listeners = new Set<() => void>();
let version = 0;

export function notify(): void {
  version++;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** 로컬 DB 질의를 구독한다 — DB 변경(notify) 또는 deps 변경 시 재실행. */
export function useLiveQuery<T>(
  fn: (db: Database) => Promise<T>,
  deps: unknown[],
): T | undefined {
  const v = useVersion();
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    getDb()
      .then(fn)
      .then((r) => {
        if (alive) setValue(r);
      })
      .catch((e) => console.error("query 실패:", e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, v]);
  return value;
}
