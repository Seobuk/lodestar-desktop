/** ISO(datetime 또는 date-only) → "YYYY-MM-DD". 서버가 date-only를 UTC 자정으로
 *  저장하므로 slice가 정확하다(로컬 변환하면 KST에서 하루 밀릴 수 있음). */
export const fmtDate = (iso: string | null | undefined): string =>
  iso ? iso.slice(0, 10) : "";

export const fmtDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";

/** D-day 라벨. date-only 문자열을 로컬 자정으로 파싱해 시간대 밀림을 피한다. */
export function dday(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const target = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  return diff === 0 ? "D-DAY" : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}
