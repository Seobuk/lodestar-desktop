import { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import ProjectView from "./components/ProjectView";
import TaskView from "./components/TaskView";
import Settings from "./components/Settings";
import { startAutoSync } from "./lib/sync";
import type { Selection } from "./lib/types";

function Empty({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="pane-empty home">
      <h1>Lodestar</h1>
      <p>
        로드스타 프로젝트를 오프라인에서 쓰는 데스크톱 앱입니다. 왼쪽에서
        프로젝트를 고르거나 새로 만드세요.
      </p>
      <p>
        처음이라면{" "}
        <button type="button" className="link" onClick={onSettings}>
          설정
        </button>
        에서 API 토큰을 넣고 동기화하세요. 이후엔 오프라인에서도 모든 작업이
        되고, 인터넷이 연결되면 자동으로 서버와 맞춰집니다.
      </p>
    </div>
  );
}

export default function App() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    startAutoSync();
  }, []);

  return (
    <div className="app">
      <Sidebar
        selection={selection}
        onSelect={setSelection}
        onSettings={() => setSettingsOpen(true)}
      />
      <main className="main">
        {selection?.type === "project" && (
          <ProjectView key={selection.id} projectId={selection.id} />
        )}
        {selection?.type === "task" && (
          <TaskView
            key={selection.id}
            taskId={selection.id}
            projectId={selection.projectId}
            onSelect={setSelection}
          />
        )}
        {!selection && <Empty onSettings={() => setSettingsOpen(true)} />}
      </main>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
