import { useEffect, useState } from "react";

/** 두 번 눌러 확정하는 삭제 버튼 — WebView 환경에서 window.confirm에 기대지 않는다.
 *  3초 안에 다시 누르지 않으면 해제. */
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
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
