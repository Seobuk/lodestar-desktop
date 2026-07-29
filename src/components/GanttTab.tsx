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
import { pullState } from "../lib/sync";
import { useVersion } from "../lib/store";
import type { DeadlineRow, TaskRow } from "../lib/types";
import "../wbs-gantt.css";

type GanttData = { tasks: FlatTask[]; deadlines: DlItem[] };

async function loadGanttData(projectId: string): Promise<GanttData> {
  const db = await getDb();
  const rows = await db.select<TaskRow[]>(
    "SELECT * FROM tasks WHERE projectId = $1 AND trashedAt IS NULL ORDER BY orderIndex",
    [projectId],
  );
  const dls = await db.select<DeadlineRow[]>(
    "SELECT * FROM deadline_items WHERE taskId IN (SELECT id FROM tasks WHERE projectId = $1 AND trashedAt IS NULL)",
    [projectId],
  );
  return {
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
  };
}

// 웹 GanttTab의 데스크톱판 — wbs-gantt.ts는 저장 콜백과 dirty 신호만 주입해
// 재사용. 저장은 "로컬 DB 적용 + 오프라인 큐 적재"라 오프라인에서도 항상 성공.
// 백그라운드 pull이 트리를 바꿨을 땐 편집 중(dirty)이 아니고 내용이 실제로
// 달라졌을 때만 다시 로드한다 — 스테일 트리를 통째로 저장해 타인 편집을
// 되돌리는 사고(리뷰)와, 30초마다 화면이 리셋되는 것 둘 다 피한다.
export default function GanttTab({ projectId }: { projectId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GanttData | null>(null);
  const dirtyRef = useRef(false);
  const dataJsonRef = useRef("");
  const v = useVersion(); // pull 완료(notify) 감지용

  useEffect(() => {
    let alive = true;
    if (dirtyRef.current) return; // 편집 중 — 다음 pull 때 다시 판단
    void loadGanttData(projectId).then((d) => {
      if (!alive) return;
      const json = JSON.stringify(d);
      if (json === dataJsonRef.current) return; // 내용 동일 — 리마운트 불필요
      dataJsonRef.current = json;
      setData(d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, v, pullState.seq]);

  useEffect(() => {
    if (!ref.current || !data) return;
    return initWbsGantt(ref.current, {
      tasks: data.tasks,
      deadlines: data.deadlines,
      onDirtyChange: (d) => {
        dirtyRef.current = d;
      },
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
    // 간트가 자체 상태를 소유 — data 객체가 갈릴 때만 다시 마운트
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return <div className="pane-empty">불러오는 중…</div>;
  return <div ref={ref} style={{ width: "100%" }} />;
}
