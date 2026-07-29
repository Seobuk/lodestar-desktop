import { useCallback, useEffect, useRef, useState } from "react";
import { getMeta, setMeta } from "./settings";
import { getDb } from "./db";

// 편집 중 초안 자동보관 — 저장 없이 화면을 떠나거나(사이드바 클릭·탭 전환) 앱이
// 죽어도 글이 안 날아가게 meta 테이블에 800ms 디바운스로 남긴다. 저장/취소 시
// 명시적으로 지우고, 다음에 같은 편집기를 열면 복원 배너를 띄운다.

export async function clearDraft(key: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM meta WHERE key = $1", ["draft:" + key]);
}

export function useDraft<T extends object>(
  key: string,
  value: T,
  hasContent: boolean,
  onRestore: (v: T) => void,
): { restored: boolean; discard: () => void } {
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);

  // mount 시 1회 복원
  useEffect(() => {
    let alive = true;
    void getMeta("draft:" + key).then((raw) => {
      loaded.current = true;
      if (!alive || !raw) return;
      try {
        onRestore(JSON.parse(raw) as T);
        setRestored(true);
      } catch {
        /* 깨진 초안은 무시 */
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 내용이 있을 때만 디바운스 저장
  useEffect(() => {
    if (!loaded.current || !hasContent) return;
    const t = window.setTimeout(
      () => void setMeta("draft:" + key, JSON.stringify(value)),
      800,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, JSON.stringify(value), hasContent]);

  const discard = useCallback(() => {
    void clearDraft(key);
    setRestored(false);
  }, [key]);

  return { restored, discard };
}
