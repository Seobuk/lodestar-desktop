// 커스텀 WBS 간트(업로드 HTML 이식). Lodestar 업무 트리로 구동, 편집은 onSync(일괄 동기화)로 저장.
// 라이브러리 없음(순수 DOM). 계층(펼침/접기)·연도 탭·오늘선·상세 편집·이동/들여쓰기.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type WNode = {
  id?: string;
  name: string;
  s?: string;
  e?: string;
  pr?: number;
  col?: string;
  co?: string;
  children?: WNode[];
  /** 렌더가 표시용으로 임시 부여한 날짜(ensureLeaf). 저장 시 DB에는 null로 남긴다. */
  _auto?: boolean;
};

export type FlatTask = {
  id: string;
  parentId: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
};

export type DlItem = {
  id: string;
  date: string; // "YYYY-MM-DD"
  content: string;
  taskId: string;
};

const PALETTE = [
  "#2a78d6", "#1baf7a", "#e09600", "#7f77dd", "#eb6834", "#1a9e75",
  "#d4537e", "#888780", "#3f8cff", "#c0428a", "#0f9b8e", "#b06a1d",
];

/** 중앙 플로팅 삭제 확인 모달(순수 DOM, 앱 공용 .modal 스타일 재사용 —
 *  SidebarProjects의 업무 삭제 모달과 같은 마크업). 확인=true, 취소·바깥클릭·
 *  Esc=false 로 resolve. 삭제는 휴지통 소프트delete(하위 cascade)라 복원 가능. */
function confirmTaskDelete(name: string, hasChildren: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML =
      '<div class="modal">' +
        '<div class="modal-title">업무 삭제</div>' +
        '<p class="modal-body"></p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="ibtn" data-act="cancel">취소</button>' +
          '<button type="button" class="ibtn danger" data-act="ok">삭제</button>' +
        "</div>" +
      "</div>";
    // 이름은 사용자 데이터 → textContent로만 주입(HTML 주입 방지).
    const body = backdrop.querySelector(".modal-body")!;
    const strong = document.createElement("strong");
    strong.textContent = name || "이 업무";
    body.appendChild(strong);
    body.appendChild(document.createTextNode(" 업무를 삭제할까요?"));
    body.appendChild(document.createElement("br"));
    body.appendChild(
      document.createTextNode(
        (hasChildren ? "하위 항목도 함께 삭제되며, " : "") +
          "프로젝트 관리 탭의 휴지통에서 복원할 수 있습니다.",
      ),
    );

    let done = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      else if (e.key === "Enter") { e.preventDefault(); close(true); }
    };
    function close(val: boolean) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(val);
    }
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false); // 백드롭(바깥)만 취소
    });
    backdrop.querySelector('[data-act="cancel"]')!
      .addEventListener("click", () => close(false));
    backdrop.querySelector('[data-act="ok"]')!
      .addEventListener("click", () => close(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    (backdrop.querySelector('[data-act="ok"]') as HTMLElement).focus();
  });
}

export function initWbsGantt(
  root: HTMLElement,
  opts: {
    tasks: FlatTask[];
    deadlines?: DlItem[];
    onSync?: (tree: WNode[], deletedIds: string[]) => Promise<WNode[] | null>;
    /** (데스크톱 추가) 미저장 편집 유무 통지 — true: 저장 대기 시작, false: 저장 완료.
     *  pull 재로드가 편집 중인 트리를 덮지 않게 하는 신호. */
    onDirtyChange?: (dirty: boolean) => void;
    // 읽기 전용(모든 프로젝트 개요): 편집 UI를 감추고, 행/막대 클릭 시 onOpen으로 라우팅.
    readOnly?: boolean;
    onOpen?: (node: WNode) => void;
    // 첫 렌더를 모두 접힌 상태로 시작(전체 간트 개요용). "모두 펼치기"로 언제든 해제.
    startCollapsed?: boolean;
  },
): () => void {
  // 업무 id → 마감(D-day) 목록. 간트에 다이아몬드로 표시(읽기 전용, 트리 동기화와 무관).
  const dlByTask: Record<string, DlItem[]> = {};
  (opts.deadlines ?? []).forEach((d) => {
    if (!d.taskId || !d.date) return;
    (dlByTask[d.taskId] = dlByTask[d.taskId] || []).push(d);
  });
  // ── DATA: 평평한 업무 → WBS 트리 ──
  function buildTree(tasks: FlatTask[]): WNode[] {
    const byId: Record<string, WNode> = {};
    tasks.forEach((t) => {
      byId[t.id] = {
        id: t.id,
        name: t.title,
        s: t.startDate ? t.startDate.slice(0, 10) : undefined,
        e: t.endDate ? t.endDate.slice(0, 10) : undefined,
        pr: t.progress ?? 0,
        children: [],
      };
    });
    const roots: WNode[] = [];
    tasks.forEach((t) => {
      const node = byId[t.id];
      const p = t.parentId ? byId[t.parentId] : null;
      if (p) p.children!.push(node);
      else roots.push(node);
    });
    const finalize = (n: WNode) => {
      if (n.children && n.children.length) {
        delete n.s;
        delete n.e;
        delete n.pr;
        n.children.forEach(finalize);
      } else {
        delete n.children;
      }
    };
    roots.forEach((n, i) => {
      n.col = PALETTE[i % PALETTE.length];
      finalize(n);
    });
    return roots;
  }

  let DATA = buildTree(opts.tasks);
  const deletedIds: string[] = [];

  // 연도 범위(데이터 + 오늘 기준).
  const nowY = new Date().getFullYear();
  let Y0 = nowY,
    Y1 = nowY;
  opts.tasks.forEach((t) => {
    [t.startDate, t.endDate].forEach((d) => {
      if (d) {
        const y = +d.slice(0, 4);
        if (y) {
          Y0 = Math.min(Y0, y);
          Y1 = Math.max(Y1, y);
        }
      }
    });
  });
  Y0 = Math.min(Y0, nowY);
  Y1 = Math.max(Y1, nowY);
  if (Y1 < Y0) Y1 = Y0;

  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  const ORIGIN = Date.UTC(Y0, 0, 1);
  const DAY = 86400000;
  const idx = (s: string) => {
    const a = s.split("-");
    return Math.round((Date.UTC(+a[0], +a[1] - 1, +a[2]) - ORIGIN) / DAY);
  };
  const idx2d = (i: number) => {
    const d = new Date(ORIGIN + i * DAY);
    return (
      d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate())
    );
  };
  const fmt = (i: number) => {
    const d = new Date(ORIGIN + i * DAY);
    return (
      d.getUTCFullYear() + "." + pad(d.getUTCMonth() + 1) + "." + pad(d.getUTCDate())
    );
  };
  const SPAN_ALL = idx(Y1 + 1 + "-01-01");
  const _now = new Date();
  const TODAY =
    _now.getFullYear() + "-" + pad(_now.getMonth() + 1) + "-" + pad(_now.getDate());
  const TIDX = idx(TODAY) + 0.5;

  const clampY = (y: number) => Math.max(Y0, Math.min(Y1, y));
  const ST: any = {
    view: "quarter",
    start: 0,
    span: SPAN_ALL,
    year: clampY(nowY),
    weekStart: Math.max(0, idx(TODAY) - 42),
    hidden: {},
    collapsed: {},
    sel: null,
    editing: false,
  };
  const WEEK_SPAN = 91;
  function applyView() {
    if (ST.view === "quarter") {
      ST.start = 0;
      ST.span = SPAN_ALL;
    } else if (ST.view === "month") {
      ST.year = clampY(ST.year);
      ST.start = idx(ST.year + "-01-01");
      ST.span = idx(ST.year + 1 + "-01-01") - ST.start;
    } else {
      ST.weekStart = Math.max(0, ST.weekStart);
      ST.start = ST.weekStart;
      ST.span = WEEK_SPAN;
    }
  }
  function nav(dir: number) {
    if (ST.view === "month") ST.year = clampY(ST.year + dir);
    else if (ST.view === "week") ST.weekStart = Math.max(0, ST.weekStart + dir * WEEK_SPAN);
    applyView();
    render();
  }
  function goToday() {
    if (ST.view === "month") ST.year = clampY(nowY);
    else if (ST.view === "week") ST.weekStart = Math.max(0, idx(TODAY) - 42);
    applyView();
    render();
  }
  const pct = (i: number) => ((i - ST.start) / ST.span) * 100;
  const rgba = (hex: string, a: number) => {
    const h = hex.replace("#", "");
    return `rgba(${parseInt(h.substr(0, 2), 16)},${parseInt(h.substr(2, 2), 16)},${parseInt(h.substr(4, 2), 16)},${a})`;
  };
  const isLeaf = (n: WNode) => !n.children || n.children.length === 0;
  // 키보드 조작: div/span 클릭 요소에 role=button·tabindex·Enter/Space 활성화를 부여한다.
  // (간트 행·칩·체브론이 전부 포커스 불가 div/span이라 키보드로 아무것도 못 하던 문제.)
  // stopPropagation으로 체브론(라벨 안에 있음)의 Enter가 행 열기까지 이중 발동하지 않게.
  const keyBtn = (el: HTMLElement, onActivate: () => void) => {
    el.tabIndex = 0;
    if (!el.getAttribute("role")) el.setAttribute("role", "button");
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }
    });
  };
  const status = (pr: number) => (pr >= 100 ? "완료" : pr <= 0 ? "예정" : "진행중");
  const statusColor = (pr: number) => (pr >= 100 ? "#1a9e75" : pr <= 0 ? "var(--wg-ink3)" : "#2a78d6");
  const esc = (s: any) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const $ = (id: string) => root.querySelector<HTMLElement>("#" + id);

  function ensureLeaf(n: WNode) {
    if (n.s === undefined) {
      const s = idx(TODAY);
      n.s = idx2d(s);
      n.e = idx2d(s + 30);
      n.pr = n.pr ?? 0;
      n._auto = true; // 표시용 임시 일정 — 사용자가 날짜를 만지기 전엔 저장하지 않는다
    }
  }
  function newNode(): WNode {
    const s = idx(TODAY);
    return { name: "새 항목", s: idx2d(s), e: idx2d(s + 30), pr: 0 };
  }

  function rollup(n: WNode): any {
    if (isLeaf(n)) {
      ensureLeaf(n);
      const s = idx(n.s!),
        e = idx(n.e!) + 1,
        d = e - s,
        st = status(n.pr!);
      return { start: s, end: e, wsum: n.pr! * d, dur: d, done: st === "완료" ? 1 : 0, active: st === "진행중" ? 1 : 0, leaves: 1 };
    }
    const r: any = { start: Infinity, end: -Infinity, wsum: 0, dur: 0, done: 0, active: 0, leaves: 0 };
    n.children!.forEach((c) => {
      const cr = rollup(c);
      r.start = Math.min(r.start, cr.start);
      r.end = Math.max(r.end, cr.end);
      r.wsum += cr.wsum; r.dur += cr.dur; r.done += cr.done; r.active += cr.active; r.leaves += cr.leaves;
    });
    return r;
  }
  const prog = (r: any) => (r.dur ? Math.round(r.wsum / r.dur) : 0);
  function allCodes() {
    const out: string[] = [];
    const rec = (n: WNode, c: string) => {
      if (!isLeaf(n)) {
        out.push(c);
        n.children!.forEach((ch, j) => rec(ch, c + "." + (j + 1)));
      }
    };
    DATA.forEach((p, i) => rec(p, String(i + 1)));
    return out;
  }
  function findLoc(target: WNode, arr?: WNode[], parent?: WNode | null): any {
    arr = arr || DATA;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === target) return { arr, i, parent: parent || null };
      if (arr[i].children) {
        const r = findLoc(target, arr[i].children, arr[i]);
        if (r) return r;
      }
    }
    return null;
  }
  function pathInfo(target: WNode): any {
    let res: any = null;
    const rec = (n: WNode, code: string, col: string) => {
      if (res) return;
      if (n === target) { res = { code, col }; return; }
      if (n.children) n.children.forEach((c, j) => rec(c, code + "." + (j + 1), col));
    };
    DATA.forEach((p, i) => rec(p, String(i + 1), p.col!));
    return res;
  }
  const pathCodeOf = (n: WNode) => { const pi = pathInfo(n); return pi ? pi.code : ""; };
  function focusName() { const i = $("wg-ed-name") as HTMLInputElement | null; if (i) { i.focus(); i.select(); } }
  function contains(anc: WNode, node: WNode): boolean {
    if (anc === node) return true;
    if (anc.children) for (const c of anc.children) if (contains(c, node)) return true;
    return false;
  }
  function collectIds(n: WNode, out: string[]) {
    if (n.id) out.push(n.id);
    if (n.children) n.children.forEach((c) => collectIds(c, out));
  }

  function addSibling(n: WNode) {
    const loc = findLoc(n); if (!loc) return;
    const nw = newNode();
    if (loc.parent === null) nw.col = nextColor();
    loc.arr.splice(loc.i + 1, 0, nw);
    ST.sel = { node: nw }; ST.editing = true; render(); saveData(); focusName();
  }
  function addTopLevel() {
    const nw = newNode(); nw.col = nextColor();
    DATA.push(nw); ST.sel = { node: nw }; ST.editing = true; render(); saveData(); focusName();
  }
  function addChild(n: WNode) {
    const r = rollup(n);
    const nw: WNode = { name: "새 작업", s: idx2d(r.start), e: idx2d(Math.max(r.start, r.end - 1)), pr: 0 };
    if (!n.children) n.children = [];
    n.children.push(nw); ST.collapsed[pathCodeOf(n)] = false; ST.sel = { node: nw }; ST.editing = true; render(); saveData(); focusName();
  }
  function indent(n: WNode) {
    const loc = findLoc(n); if (!loc || loc.i === 0) return;
    const prev = loc.arr[loc.i - 1]; loc.arr.splice(loc.i, 1);
    if (!prev.children) prev.children = []; prev.children.push(n);
    ST.collapsed[pathCodeOf(prev)] = false; ST.editing = false; render(); saveData();
  }
  function outdent(n: WNode) {
    const loc = findLoc(n); if (!loc || loc.parent === null) return;
    const parent = loc.parent; const ploc = findLoc(parent);
    loc.arr.splice(loc.i, 1);
    ploc.arr.splice(ploc.i + 1, 0, n);
    if (parent.children.length === 0) { delete parent.children; ensureLeaf(parent); }
    if (ploc.parent === null && !n.col) n.col = nextColor();
    ST.editing = false; render(); saveData();
  }
  function moveSib(n: WNode, dir: number) {
    const loc = findLoc(n); if (!loc) return;
    const j = loc.i + dir; if (j < 0 || j >= loc.arr.length) return;
    const t = loc.arr[j]; loc.arr[j] = loc.arr[loc.i]; loc.arr[loc.i] = t; ST.editing = false; render(); saveData();
  }
  function moveTo(n: WNode, target: WNode | null) {
    if (target && contains(n, target)) return;
    const loc = findLoc(n); if (!loc) return;
    const oldParent = loc.parent; loc.arr.splice(loc.i, 1);
    if (oldParent && oldParent.children && oldParent.children.length === 0) { delete oldParent.children; ensureLeaf(oldParent); }
    if (target === null) { if (!n.col) n.col = nextColor(); DATA.push(n); }
    else { if (!target.children) target.children = []; target.children.push(n); ST.collapsed[pathCodeOf(target)] = false; }
    ST.editing = false; render(); saveData();
  }
  function deleteNode(n: WNode) {
    const loc = findLoc(n); if (!loc) return;
    collectIds(n, deletedIds);
    const parent = loc.parent; loc.arr.splice(loc.i, 1);
    if (parent && parent.children && parent.children.length === 0) { delete parent.children; ensureLeaf(parent); }
    ST.sel = parent ? { node: parent } : null; ST.editing = false; render(); saveData();
  }
  function nextColor() {
    const used = DATA.map((d) => d.col);
    for (const c of PALETTE) if (used.indexOf(c) < 0) return c;
    return PALETTE[DATA.length % PALETTE.length];
  }
  function flattenAll() {
    const rows: any[] = [];
    const walk = (n: WNode, code: string, lv: number) => {
      rows.push({ node: n, code, lv });
      if (n.children) n.children.forEach((c, j) => walk(c, code + "." + (j + 1), lv + 1));
    };
    DATA.forEach((p, i) => walk(p, String(i + 1), 0));
    return rows;
  }
  function flatten() {
    const rows: any[] = [];
    const walk = (n: WNode, code: string, lv: number, col: string) => {
      rows.push({ node: n, code, lv, col });
      if (!isLeaf(n) && !ST.collapsed[code])
        n.children!.forEach((c, j) => walk(c, code + "." + (j + 1), lv + 1, col));
    };
    DATA.forEach((p, i) => { if (!ST.hidden[i]) walk(p, String(i + 1), 0, p.col!); });
    return rows;
  }

  // ── 저장(디바운스) → onSync → 새 노드 id 반영 ──
  // 저장은 실제 편집(추가/삭제/이동/이름/일정/진척)에서만 호출한다 — 렌더는 저장하지
  // 않으므로 간트를 열어 보기만 하는 것으로는 DB가 바뀌지 않는다.
  let saveTimer: any = null;
  function reconcileIds(local: WNode[], server: WNode[]) {
    for (let i = 0; i < local.length && i < server.length; i++) {
      if (!local[i].id && server[i].id) local[i].id = server[i].id;
      if (local[i].children && server[i].children)
        reconcileIds(local[i].children!, server[i].children!);
    }
  }
  // 저장 페이로드 — ensureLeaf가 표시용으로 임시 부여한(_auto) 일정은 빼고 보내
  // "일정 미정" 업무가 오늘+30일짜리 가짜 일정으로 저장되는 것을 막는다.
  function toPayload(nodes: WNode[]): WNode[] {
    return nodes.map((n) => ({
      id: n.id,
      name: n.name,
      s: n._auto ? undefined : n.s,
      e: n._auto ? undefined : n.e,
      pr: n.pr,
      children: n.children ? toPayload(n.children) : undefined,
    }));
  }
  // 디바운스 저장의 실제 본문 — flushSave가 언마운트 시 동기 호출할 수 있게 분리한다.
  function doSave() {
    saveTimer = null;
    const del = deletedIds.slice();
    deletedIds.length = 0;
    opts.onSync!(toPayload(DATA), del)
      .then((serverTree) => {
        if (serverTree) reconcileIds(DATA, serverTree);
        else deletedIds.push(...del); // 실패 — 삭제 내역을 되살려 다음 저장에서 재시도
        opts.onDirtyChange?.(false);
      })
      .catch(() => {
        deletedIds.push(...del);
        opts.onDirtyChange?.(false);
      });
  }
  function saveData() {
    if (opts.readOnly || !opts.onSync) return;
    opts.onDirtyChange?.(true);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 500);
  }
  // 탭 전환·사이드바 이동으로 간트가 언마운트될 때, 대기 중이던 편집을 버리지 않고
  // 즉시 전송한다(기존엔 clearTimeout으로 흘려 0.5초 내 편집이 조용히 유실됐다).
  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      doSave();
    }
  }

  // ── 렌더 ──
  function chips() {
    const w = $("wg-chips")!; w.innerHTML = "";
    DATA.forEach((d, k) => {
      const c = document.createElement("div");
      c.className = "wg-chip" + (ST.hidden[k] ? " off" : "");
      c.innerHTML = '<span class="wg-dot" style="background:' + d.col + '"></span>' + esc(d.name);
      const toggleChip = () => { ST.hidden[k] = !ST.hidden[k]; render(); };
      c.onclick = toggleChip;
      c.setAttribute("aria-pressed", String(!ST.hidden[k]));
      keyBtn(c, toggleChip);
      w.appendChild(c);
    });
  }
  function head() {
    const h = $("wg-ghead")!; h.innerHTML = ""; h.style.height = "40px";
    if (ST.view === "quarter") {
      for (let y = Y0; y <= Y1; y++) {
        const ys = idx(y + "-01-01"), ye = idx(y + 1 + "-01-01");
        const seg = document.createElement("div");
        seg.style.cssText = "position:absolute;top:0;height:40px;left:" + pct(ys) + "%;width:" + ((ye - ys) / ST.span * 100) + "%;border-left:1px solid var(--wg-line);";
        seg.innerHTML =
          '<div style="font-size:12px;font-weight:700;color:var(--wg-ink);padding:5px 0 0 9px">' + y + "</div>" +
          '<div style="display:flex;font-size:11px;color:var(--wg-ink3);padding-left:9px"><span style="flex:1">Q1</span><span style="flex:1">Q2</span><span style="flex:1">Q3</span><span style="flex:1">Q4</span></div>';
        h.appendChild(seg);
      }
    } else if (ST.view === "month") {
      const yr = ST.year;
      for (let m = 0; m < 12; m++) {
        const ms = idx(yr + "-" + pad(m + 1) + "-01");
        const seg2 = document.createElement("div");
        seg2.style.cssText = "position:absolute;top:0;height:40px;left:" + pct(ms) + "%;border-left:1px solid var(--wg-line);font-size:12px;color:var(--wg-ink2);padding:13px 0 0 6px;";
        seg2.textContent = m + 1 + "월"; h.appendChild(seg2);
      }
    } else {
      // 주 보기: 7일마다 눈금, 월이 바뀌면 굵게 + 월 표기.
      const end = ST.start + ST.span;
      let prevM = -1;
      for (let wi = ST.start; wi < end; wi += 7) {
        const d = new Date(ORIGIN + wi * DAY);
        const mo = d.getUTCMonth();
        const monthChanged = mo !== prevM;
        prevM = mo;
        const seg = document.createElement("div");
        seg.style.cssText = "position:absolute;top:0;height:40px;left:" + pct(wi) + "%;border-left:1px solid var(--wg-line);font-size:11px;padding:13px 0 0 5px;color:" + (monthChanged ? "var(--wg-ink)" : "var(--wg-ink3)") + ";font-weight:" + (monthChanged ? "700" : "400") + ";white-space:nowrap;";
        seg.textContent = monthChanged ? mo + 1 + "월 " + d.getUTCDate() + "일" : d.getUTCDate() + "일";
        h.appendChild(seg);
      }
    }
  }
  function showTip(html: string, x: number, y: number) {
    // x,y는 clientX/clientY(뷰포트 좌표) → position:fixed로 배치해 컨테이너 밖으로 나가도 안 잘림.
    const t = $("wg-tip")!; t.innerHTML = html; t.style.display = "block";
    const vw = window.innerWidth, vh = window.innerHeight, M = 8;
    let lx = x + 14;
    if (lx + t.offsetWidth > vw - M) lx = x - t.offsetWidth - 14; // 오른쪽 넘치면 커서 왼쪽으로
    if (lx < M) lx = M;
    let ty = y + 16;
    if (ty + t.offsetHeight > vh - M) ty = y - t.offsetHeight - 12; // 아래로 넘치면 커서 위로 뒤집어 막대를 안 가리게
    if (ty < M) ty = M; // 그래도 위로 넘치면 상단에 물림
    t.style.left = lx + "px"; t.style.top = ty + "px";
  }
  function hideTip() { const t = $("wg-tip"); if (t) t.style.display = "none"; }

  // 읽기 전용이면 클릭 시 라우팅(onOpen), 편집 모드면 상세 패널을 연다.
  const openOrSelect = (n: WNode) => {
    if (opts.readOnly) { opts.onOpen?.(n); return; }
    ST.sel = { node: n }; ST.editing = false; detail();
  };

  function body() {
    const b = $("wg-gbody")!; b.innerHTML = "";
    const selNode = ST.sel ? ST.sel.node : null;
    flatten().forEach((R: any) => {
      const n = R.node, col = R.col, r = rollup(n), leaf = isLeaf(n), pr = leaf ? n.pr : prog(r);
      const row = document.createElement("div");
      row.className = "wg-row wg-lv" + Math.min(R.lv, 2) + (n === selNode ? " sel" : "");
      const lab = document.createElement("div");
      lab.className = "wg-rlabel"; lab.style.paddingLeft = 14 + R.lv * 18 + "px";
      const chev = document.createElement("span"); chev.className = "wg-chev";
      if (!leaf) {
        chev.textContent = ST.collapsed[R.code] ? "▸" : "▾";
        const toggleCollapse = () => { ST.collapsed[R.code] = !ST.collapsed[R.code]; render(); };
        chev.onclick = (ev) => { ev.stopPropagation(); toggleCollapse(); };
        chev.setAttribute("aria-expanded", String(!ST.collapsed[R.code]));
        chev.setAttribute("aria-label", "하위 업무 접기/펼치기");
        keyBtn(chev, toggleCollapse);
      }
      lab.appendChild(chev);
      const txt = document.createElement("span");
      txt.style.cssText = "display:flex;align-items:center;gap:5px;min-width:0";
      txt.innerHTML = '<span class="wg-wbs">' + R.code + '</span><span class="wg-nm">' + esc(n.name) + "</span>";
      lab.appendChild(txt);
      lab.onclick = () => openOrSelect(n);
      keyBtn(lab, () => openOrSelect(n));
      row.appendChild(lab);

      const tr = document.createElement("div"); tr.className = "wg-rtrack";
      if (r.start < ST.start + ST.span && r.end > ST.start && r.end > r.start) {
        const L = Math.max(0, pct(r.start)), Rr = Math.min(100, pct(r.end));
        const bar = document.createElement("div");
        bar.className = "wg-bar " + (leaf ? "wg-leaf" : "wg-summ");
        bar.style.left = L + "%"; bar.style.width = Rr - L + "%";
        if (leaf) {
          bar.style.background = rgba(col, 0.26);
          const fill = document.createElement("div"); fill.className = "wg-fill";
          fill.style.cssText = "width:" + pr + "%;background:" + col + ";border-radius:7px 0 0 7px"; bar.appendChild(fill);
          const lb = document.createElement("span");
          lb.style.cssText = "position:absolute;left:calc(" + L + "% + 8px);top:7px;height:24px;display:flex;align-items:center;font-size:11px;font-weight:600;color:" + ("color-mix(in srgb, " + col + " 42%, var(--ink))") + ";pointer-events:none;white-space:nowrap;z-index:3";
          lb.textContent = n.name; tr.appendChild(lb);
        } else {
          bar.style.background = rgba(col, 0.2); bar.style.border = "1.5px solid " + col;
          const f2 = document.createElement("div"); f2.className = "wg-fill";
          f2.style.cssText = "width:" + pr + "%;background:" + col; bar.appendChild(f2);
        }
        const ht = "<b>" + R.code + " " + esc(n.name) + "</b><br>" + fmt(r.start) + " ~ " + fmt(r.end - 1) + "<br>" + (r.end - r.start) + "일 · 진행률 " + pr + "% · " + (leaf ? status(n.pr) : r.leaves + "개 작업");
        bar.onmousemove = (ev: MouseEvent) => showTip(ht, ev.clientX, ev.clientY);
        bar.onmouseleave = hideTip;
        bar.onclick = () => openOrSelect(n);
        tr.appendChild(bar);
      }
      // 이 업무의 마감(D-day) 다이아몬드
      if (n.id && dlByTask[n.id]) {
        dlByTask[n.id].forEach((dl) => {
          const di = idx(dl.date);
          if (di < ST.start || di > ST.start + ST.span) return;
          const x = pct(di);
          const dia = document.createElement("div");
          dia.className = "wg-dia";
          dia.style.left = "calc(" + x + "% - 7px)";
          const dd = Math.round(di - idx(TODAY));
          const ddl = dd === 0 ? "D-DAY" : dd > 0 ? "D-" + dd : "D+" + -dd;
          const ht = "<b>◆ " + esc(dl.content || "마감") + "</b><br>" + dl.date + " · " + ddl;
          dia.onmousemove = (ev: MouseEvent) => showTip(ht, ev.clientX, ev.clientY);
          dia.onmouseleave = hideTip;
          tr.appendChild(dia);
        });
      }
      row.appendChild(tr); b.appendChild(row);
    });
    const visible = DATA.some((_, k) => !ST.hidden[k]);
    if (visible && TIDX >= ST.start && TIDX <= ST.start + ST.span) {
      const frac = pct(TIDX) / 100;
      // 라벨 폭은 미디어쿼리(≤680px→160px)로 달라지므로 실측값을 쓴다.
      // 상수(340)로 고정하면 모바일에서 오늘선이 차트 밖으로 밀려 안 보인다.
      const gl = root.querySelector<HTMLElement>(".wg-glabel");
      const LBLW = gl ? gl.getBoundingClientRect().width : 340;
      const line = document.createElement("div");
      line.style.cssText = "position:absolute;top:0;bottom:0;left:calc(" + LBLW + "px + (100% - " + LBLW + "px) * " + frac + ");width:0;border-left:2px dashed var(--wg-today);z-index:6;pointer-events:none;";
      const tag = document.createElement("div");
      tag.style.cssText = "position:absolute;top:-1px;left:4px;font-size:10px;font-weight:700;color:#fff;background:var(--wg-today);padding:1px 6px;border-radius:4px;white-space:nowrap;";
      tag.textContent = "오늘 " + fmt(idx(TODAY)).slice(5);
      line.appendChild(tag); b.appendChild(line);
    }
  }

  const PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  function detail() {
    const el = $("wg-detail")!; el.innerHTML = "";
    if (!ST.sel || !ST.sel.node) {
      el.innerHTML = '<span class="empty">항목을 클릭하면 이름·기간·진행률을 편집하고, 하위/형제 추가·레벨 변경·삭제를 할 수 있습니다.</span>';
      return;
    }
    const n: WNode = ST.sel.node, pi = pathInfo(n);
    if (!pi) { ST.sel = null; detail(); return; }
    const code = pi.code, col = pi.col, leaf = isLeaf(n), loc = findLoc(n), r = rollup(n);
    const canOut = loc && loc.parent !== null, canIn = loc && loc.i > 0, isTop = loc && loc.parent === null;

    const head2 = document.createElement("div"); head2.className = "wg-dhead";
    if (ST.editing) {
      head2.innerHTML =
        '<span class="wg-dot" style="background:' + col + '"></span><span class="wg-wbs" style="font-size:13px">' + code + "</span>" +
        '<input class="wg-nameInput" id="wg-ed-name" value="' + esc(n.name) + '">' +
        '<button class="wg-pencil" id="wg-ed-namedone" title="확인">' + PENCIL + "</button>";
    } else {
      const right = leaf
        ? '<span class="wg-badge" id="wg-ed-badge" style="margin-left:auto;background:' + rgba(col, 0.16) + ";color:" + ("color-mix(in srgb, " + col + " 42%, var(--ink))") + '">' + status(n.pr!) + "</span>"
        : '<span style="margin-left:auto;font-size:13px;color:var(--wg-ink3)">' + fmt(r.start) + " ~ " + fmt(r.end - 1) + " · 롤업 " + prog(r) + "%</span>";
      head2.innerHTML =
        '<span class="wg-dot" style="background:' + col + '"></span><span class="wg-wbs" style="font-size:13px">' + code + "</span>" +
        '<span style="font-size:16px;font-weight:700">' + esc(n.name) + "</span>" +
        '<button class="wg-pencil" id="wg-ed-edit" title="이름 수정">' + PENCIL + "</button>" + right;
    }
    el.appendChild(head2);

    if (leaf) {
      const ed = document.createElement("div"); ed.className = "wg-ed";
      ed.innerHTML =
        '<label>시작일<input type="date" id="wg-ed-s" value="' + n.s + '"></label>' +
        '<label>종료일<input type="date" id="wg-ed-e" value="' + n.e + '"></label>' +
        '<label>진행률<div class="wg-prw"><input type="range" min="0" max="100" step="5" value="' + n.pr + '" id="wg-ed-pr"><span class="wg-prv" id="wg-ed-prv">' + n.pr + '%</span></div></label>' +
        '<span class="wg-dur" id="wg-ed-dur">' + (idx(n.e!) - idx(n.s!) + 1) + "일</span>";
      el.appendChild(ed);
      const pb = document.createElement("div"); pb.className = "wg-pbar"; pb.style.background = rgba(col, 0.18);
      pb.innerHTML = '<div id="wg-ed-fill" style="height:100%;width:' + n.pr + '%;background:' + col + '"></div>';
      el.appendChild(pb);
    } else {
      const list = document.createElement("div"); list.style.marginTop = "6px";
      n.children!.forEach((c, j) => {
        const cr = rollup(c), cpr = isLeaf(c) ? c.pr! : prog(cr), st = status(cpr), sub = isLeaf(c) ? "" : " (" + cr.leaves + ")", ccode = code + "." + (j + 1);
        const rrow = document.createElement("div"); rrow.className = "wg-drow";
        rrow.innerHTML =
          '<span class="wg-wbs" style="flex:0 0 46px">' + ccode + "</span>" +
          '<span style="flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.name) + sub + "</span>" +
          '<span style="flex:0 0 150px;font-size:12px;color:var(--wg-ink2)">' + fmt(cr.start) + " ~ " + fmt(cr.end - 1) + "</span>" +
          '<span style="flex:0 0 64px;text-align:right;font-size:12px;color:' + statusColor(cpr) + ';font-weight:600">' + cpr + "% " + st + "</span>";
        rrow.onclick = () => { ST.sel = { node: c }; ST.editing = false; detail(); };
        list.appendChild(rrow);
      });
      el.appendChild(list);
    }

    const act = document.createElement("div"); act.className = "wg-act";
    const canUp = loc && loc.i > 0, canDown = loc && loc.i < loc.arr.length - 1;
    const MT = flattenAll();
    let moveOpts = '<option value="__none" selected>이동 위치 ▾</option><option value="__top">↳ 최상위로</option>';
    MT.forEach((R2: any, k: number) => {
      if (contains(n, R2.node)) return;
      const pdn = Array(R2.lv + 1).join("　");
      moveOpts += '<option value="' + k + '">' + pdn + R2.code + " " + esc(R2.node.name) + "</option>";
    });
    act.innerHTML =
      '<button class="add" id="wg-ed-add">+ 형제 추가</button>' +
      '<button class="add2" id="wg-ed-addchild">+ 하위 추가</button>' +
      '<button id="wg-ed-out"' + (canOut ? "" : " disabled") + ">← 상위로</button>" +
      '<button id="wg-ed-in"' + (canIn ? "" : " disabled") + ">→ 하위로</button>" +
      '<button id="wg-ed-up"' + (canUp ? "" : " disabled") + ' title="위로">↑</button>' +
      '<button id="wg-ed-down"' + (canDown ? "" : " disabled") + ' title="아래로">↓</button>' +
      '<select id="wg-ed-move" title="다른 곳으로 이동">' + moveOpts + "</select>" +
      '<button class="del" id="wg-ed-del">삭제</button>';
    el.appendChild(act);

    if (ST.editing) {
      const inp = $("wg-ed-name") as HTMLInputElement;
      const commit = () => {
        const v = inp.value.trim();
        const changed = !!v && v !== n.name;
        if (changed) n.name = v;
        ST.editing = false; render();
        if (changed) saveData();
      };
      const cancel = () => { ST.editing = false; detail(); };
      inp.onkeydown = (ev) => { if (ev.key === "Enter") commit(); else if (ev.key === "Escape") cancel(); };
      inp.onblur = () => setTimeout(() => { if (ST.editing) commit(); }, 120);
      ($("wg-ed-namedone") as HTMLElement).onclick = commit;
    } else {
      ($("wg-ed-edit") as HTMLElement).onclick = () => { ST.editing = true; detail(); focusName(); };
    }
    if (leaf) {
      const es = $("wg-ed-s") as HTMLInputElement, ee = $("wg-ed-e") as HTMLInputElement,
        epr = $("wg-ed-pr") as HTMLInputElement, prv = $("wg-ed-prv")!, fillEl = $("wg-ed-fill")!,
        badge = $("wg-ed-badge");
      const durEl = $("wg-ed-dur");
      const syncDur = () => { if (durEl) durEl.textContent = (idx(n.e!) - idx(n.s!) + 1) + "일"; };
      // repaint()으로 막대만 다시 그린다. render()는 detail()을 호출해 이 date input을
      // 통째로 새로 만드는데, 그러면 여러 자리(예: 13일) 입력 도중 첫 자리만 유효 날짜로
      // 인식돼 change가 발생 → input이 재생성 → 포커스가 날아가 둘째 자리를 못 친다.
      es.onchange = () => { if (!es.value) return; delete n._auto; n.s = es.value; syncDur(); repaint(); };
      ee.onchange = () => { if (!ee.value) return; delete n._auto; n.e = ee.value; syncDur(); repaint(); };
      // 순서 보정(끝<시작)은 편집이 끝난 뒤(blur)에만. change는 연·월·일을 타이핑하는
      // 도중에도 발생하는데(연도 "2026"을 칠 때 0002→0020→0202→2026 식으로 매 자리마다),
      // 그 중간값이 반대편 날짜보다 앞서면 예전엔 반대 필드를 덮어써 "종료일 입력 중
      // 시작일이 바뀌는" 버그가 났다. blur로 미루면 반쯤 친 연도가 상대 필드를 건드리지 않는다.
      es.onblur = () => { if (es.value && ee.value && idx(n.s!) > idx(n.e!)) { n.e = n.s; ee.value = n.e!; syncDur(); repaint(); } };
      ee.onblur = () => { if (es.value && ee.value && idx(n.e!) < idx(n.s!)) { n.s = n.e; es.value = n.s!; syncDur(); repaint(); } };
      epr.oninput = () => { n.pr = parseInt(epr.value); prv.textContent = n.pr + "%"; fillEl.style.width = n.pr + "%"; if (badge) badge.textContent = status(n.pr); repaint(); };
    }
    ($("wg-ed-add") as HTMLElement).onclick = () => addSibling(n);
    ($("wg-ed-addchild") as HTMLElement).onclick = () => addChild(n);
    if (canOut) ($("wg-ed-out") as HTMLElement).onclick = () => outdent(n);
    if (canIn) ($("wg-ed-in") as HTMLElement).onclick = () => indent(n);
    if (canUp) ($("wg-ed-up") as HTMLElement).onclick = () => moveSib(n, -1);
    if (canDown) ($("wg-ed-down") as HTMLElement).onclick = () => moveSib(n, 1);
    const moveSel = $("wg-ed-move") as HTMLSelectElement;
    moveSel.onchange = () => {
      const v = moveSel.value; if (v === "__none") return;
      if (v === "__top") moveTo(n, null); else moveTo(n, MT[parseInt(v)].node);
    };
    ($("wg-ed-del") as HTMLElement).onclick = async () => {
      if (await confirmTaskDelete(n.name, !!(n.children && n.children.length)))
        deleteNode(n);
    };
  }

  function stats() {
    const vis = DATA.filter((_, k) => !ST.hidden[k]);
    const avgs: number[] = []; let active = 0, done = 0;
    vis.forEach((d) => { const r = rollup(d); avgs.push(prog(r)); active += r.active; done += r.done; });
    const avg = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : 0;
    $("wg-s-avg")!.textContent = avg + "%";
    $("wg-s-active")!.textContent = String(active);
    $("wg-s-done")!.textContent = String(done);
    $("wg-s-count")!.textContent = String(vis.length);
  }

  function range() {
    const rl = $("wg-range");
    const canNav = ST.view !== "quarter";
    ["wg-prev", "wg-next", "wg-today"].forEach((id) => {
      const b = $(id) as HTMLButtonElement | null;
      if (b) b.disabled = !canNav;
    });
    if (rl) {
      if (ST.view === "quarter") rl.textContent = Y0 + " ~ " + Y1;
      else if (ST.view === "month") rl.textContent = ST.year + "년";
      else rl.textContent = fmt(ST.start) + " ~ " + fmt(ST.start + ST.span - 1);
    }
  }
  function repaint() { body(); stats(); saveData(); } // 일정·진행률 편집 전용(상세 패널) — 저장 포함
  function render() { chips(); head(); body(); if (!opts.readOnly) detail(); stats(); range(); } // 표시 전용 — 저장 없음

  // ── 스켈레톤 ── (읽기 전용이면 편집 버튼·상세 패널 제외, 카운트 라벨을 "프로젝트"로)
  root.className = "wbsg";
  root.innerHTML =
    '<div class="wg-toolbar"><div class="wg-tabs">' +
    '<button class="wg-tab on" data-v="quarter">분기</button>' +
    '<button class="wg-tab" data-v="month">월</button>' +
    '<button class="wg-tab" data-v="week">주</button></div>' +
    '<div class="wg-nav">' +
    '<button class="wg-btn" id="wg-prev" title="이전">◀</button>' +
    '<span id="wg-range" class="wg-range"></span>' +
    '<button class="wg-btn" id="wg-next" title="다음">▶</button>' +
    '<button class="wg-btn" id="wg-today">오늘</button></div>' +
    '<div class="wg-spacer"></div>' +
    '<div class="wg-actions">' +
    (opts.readOnly ? "" : '<button class="wg-btn pri" id="wg-add">+ 최상위 업무</button>') +
    '<button class="wg-btn" id="wg-expand">모두 펼치기</button>' +
    '<button class="wg-btn" id="wg-collapse">모두 접기</button></div></div>' +
    '<div class="wg-stats">' +
    '<div class="wg-stat"><div class="lab">평균 진행률</div><div class="val" id="wg-s-avg">–</div></div>' +
    '<div class="wg-stat"><div class="lab">진행 중</div><div class="val" id="wg-s-active">–</div></div>' +
    '<div class="wg-stat"><div class="lab">완료</div><div class="val" id="wg-s-done">–</div></div>' +
    '<div class="wg-stat"><div class="lab">' + (opts.readOnly ? "프로젝트" : "최상위") + '</div><div class="val" id="wg-s-count">–</div></div></div>' +
    '<div class="wg-chips" id="wg-chips"></div>' +
    '<div class="wg-gantt"><div class="wg-head"><div class="wg-glabel">WBS · 작업분류</div><div class="wg-gtime" id="wg-ghead"></div></div>' +
    '<div class="wg-gbody" id="wg-gbody"></div><div class="wg-tip" id="wg-tip"></div></div>' +
    (opts.readOnly ? "" : '<div class="wg-detail" id="wg-detail"></div>');

  root.querySelectorAll<HTMLElement>(".wg-tab").forEach((t) => {
    t.onclick = () => {
      root.querySelectorAll(".wg-tab").forEach((b) => b.classList.remove("on"));
      t.classList.add("on");
      ST.view = t.getAttribute("data-v")!;
      applyView();
      render();
    };
  });
  ($("wg-prev") as HTMLElement).onclick = () => nav(-1);
  ($("wg-next") as HTMLElement).onclick = () => nav(1);
  ($("wg-today") as HTMLElement).onclick = () => goToday();
  const addBtn = $("wg-add");
  if (addBtn) addBtn.onclick = () => addTopLevel();
  ($("wg-expand") as HTMLElement).onclick = () => { ST.collapsed = {}; render(); };
  ($("wg-collapse") as HTMLElement).onclick = () => { ST.collapsed = {}; allCodes().forEach((c) => (ST.collapsed[c] = true)); render(); };

  if (opts.startCollapsed) allCodes().forEach((c) => (ST.collapsed[c] = true));
  render();

  return () => {
    flushSave(); // 대기 중인 편집을 버리지 않고 즉시 저장
    root.innerHTML = "";
  };
}
