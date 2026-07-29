import { useEffect, useRef, useState } from "react";

/** 두 번 눌러 확정하는 삭제 버튼 — WebView 환경에서 window.confirm에 기대지 않는다.
 *  3초 안에 다시 누르지 않으면 해제. 무장 직후 300ms 불응기 — 습관성 더블클릭이
 *  한 동작으로 확정해버리는 것을 막는다. */
export default function ConfirmButton({
  label,
  confirmLabel = "정말 삭제?",
  onConfirm,
  className = "",
  title,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  className?: string;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  const armedAt = useRef(0);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      title={title}
      className={`danger ${armed ? "armed" : ""} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          if (Date.now() - armedAt.current < 300) return; // 더블클릭 불응기
          setArmed(false);
          onConfirm();
        } else {
          armedAt.current = Date.now();
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
