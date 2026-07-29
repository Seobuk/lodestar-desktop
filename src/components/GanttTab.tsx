import { useEffect, useRef, useState } from "react";
import {
  initWbsGantt,
  type DlItem,
  type FlatTask,
  type WNode,
} from "../lib/wbs-gantt";
import { getDb } from "../lib/db";
import { newId } from "../lib/ids";
import { syncTaskTree } from "../lib/mutations";
import type { DeadlineRow, TaskRow } from "../lib/types";
import "../wbs-gantt.css";

// 웹 GanttTab의 데스크톱판 — wbs-gantt.ts는 무수정 재사용, 저장(onSync)만
// "로컬 DB 적용 + 오프라인 큐 적재"로 갈아끼웠다. 오프라인에서도 항상 성공.
export default function GanttTab({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{
    tasks: FlatTask[];
    deadlines: DlItem[];
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const db = await getDb();
      const rows = await db.select<TaskRow[]>(
        "SELECT * FROM tasks WHERE projectId = $1 AND trashedAt IS NULL ORDER BY orderIndex",
        [projectId],
      );
      const dls = await db.select<DeadlineRow[]>(
        "SELECT * FROM deadline_items WHERE taskId IN (SELECT id FROM tasks WHERE projectId = $1 AND trashedAt IS NULL)",
        [projectId],
      );
      if (!alive) return;
      setData({
        tasks: rows.map((t) => ({
          id: t.id,
          parentId: t.parentId,
          title: t.title,
          startDate: t.startDate ? t.startDate.slice(0, 10) : null,
          endDate: t.endDate ? t.endDate.slice(0, 10) : null,
          progress: t.progress ?? 0,
        })),
        deadlines: dls
          .filter((d) => d.taskId)
          .map((d) => ({
            id: d.id,
            date: d.date.slice(0, 10),
            content: d.content,
            taskId: d.taskId as string,
          }))
          .filter((d) => d.date),
      });
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!ref.current || !data) return;
    return initWbsGantt(ref.current, {
      tasks: data.tasks,
      deadlines: data.deadlines,
      onSync: async (tree, deletedIds) => {
        // 새 노드에 클라이언트 id를 먼저 채운다(서버 create-with-id 경로 →
        // temp-id 리매핑 불필요). 그 뒤 로컬 적용+큐 적재는 syncTaskTree가 한다.
        const fill = (nodes: WNode[]) => {
          for (const n of nodes) {
            if (!n.id) n.id = newId();
            if (n.children) fill(n.children);
          }
        };
        fill(tree);
        await syncTaskTree(projectId, tree, deletedIds);
        return tree; // id 채워진 트리 반환 → 간트가 reconcile
      },
    });
    // 간트가 자체 상태를 소유 — 데이터 로드 완료 시 1회만 마운트
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return <div className="pane-empty">불러오는 중…</div>;
  return <div ref={ref} style={{ width: "100%" }} />;
}
