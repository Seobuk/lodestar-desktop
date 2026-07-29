# Lodestar Desktop

로드스타(https://lodestar-rho.vercel.app) **프로젝트 탭을 오프라인에서 쓰는 윈도우
데스크톱 앱**. 프로젝트·업무(WBS)·마감(D-day)·회의록을 로컬 SQLite에 저장하고,
인터넷이 연결되면 서버와 자동 동기화한다. Tauri 2 + React 19 + TypeScript.

## 동작 방식

- 모든 편집은 **로컬 우선**: 로컬 SQLite에 즉시 적용 + 작업큐(oplog)에 적재.
- 온라인이 되면 큐를 서버 `/api/publish/project-sync`(PAT Bearer 인증)에 순서대로
  replay(push)한 뒤, 전체 상태를 받아(pull) 로컬을 교체한다. 충돌은 last-write-wins.
- create는 클라이언트가 cuid 호환 id를 미리 만들어 보내므로 재전송에도 멱등
  (서버가 id 중복을 "이미 적용됨"으로 처리).
- 30초 주기 + 편집 직후 + 온라인 복귀 시 자동 동기화, 상태줄 ↻로 수동 동기화.

## 처음 설정

1. 로드스타 웹에 구글 로그인 → 사이드바 **🔑 API 토큰**(/token)에서 토큰 발급
   (프로젝트 접근 권한 `hasProjectAccess`가 있는 계정이어야 함).
2. 앱 실행 → 좌하단 ⚙ 설정 → 토큰 붙여넣기 → 저장 후 동기화.

## 개발

```
npm install
npm run tauri dev      # 개발 실행
npm run tauri build    # 설치본 빌드 (NSIS, src-tauri/target/release/bundle/)
```

요구: Node 20+, Rust(rustup), VS 2022 Build Tools(C++), WebView2 런타임(Win11 기본).

## 구조

- `src/lib/db.ts` — 로컬 SQLite 스키마(서버 모델의 부분집합 미러)
- `src/lib/sync.ts` — 동기화 엔진(push oplog → pull 전체 교체 → 잔여 op 재적용)
- `src/lib/localops.ts` — op의 로컬 적용(서버 lib 헬퍼의 근사, pull이 교정)
- `src/lib/mutations.ts` — UI 뮤테이션(op 모양의 단일 정의처)
- `src/lib/markdown.ts` — 웹과 동일한 markdown-it(+KaTeX·highlight.js) 렌더
- `src/components/` — 사이드바(프로젝트·WBS 트리), 프로젝트 뷰(대시보드·회의록·정보),
  업무 뷰, 마감 목록, 회의록 패널(목록→열람→편집), 설정 모달

서버 쪽 계약(`/api/publish/project-sync`)은 로드스타 저장소
`app/api/publish/project-sync/route.ts` 참고. 간트(WBS 트리 재배열)와 휴지통
관리 UI는 아직 웹 전용 — `task.tree` op는 서버에 이미 준비돼 있다.
