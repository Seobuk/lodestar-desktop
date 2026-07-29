import Database from "@tauri-apps/plugin-sql";

// 로컬 미러 DB. 서버(Prisma 스키마)의 부분집합 컬럼만 둔다 — pull이 전체 상태를
// 교체하므로 마이그레이션 부담이 없다(컬럼 추가 시 테이블 지우고 재생성해도 무방).
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    orderIndex INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    parentId TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    deadline TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    progress INTEGER NOT NULL DEFAULT 0,
    startDate TEXT,
    endDate TEXT,
    durationDays INTEGER,
    isMilestone INTEGER NOT NULL DEFAULT 0,
    orderIndex INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT,
    trashedAt TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parentId)`,
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    taskId TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(projectId)`,
  `CREATE TABLE IF NOT EXISTS deadline_items (
    id TEXT PRIMARY KEY,
    taskId TEXT,
    projectId TEXT,
    date TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    orderIndex INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS oplog (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS personal_cards (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    checklist TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    postit TEXT,
    orderIndex REAL NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS personal_notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    color TEXT NOT NULL DEFAULT 'default',
    labels TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    orderIndex INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS personal_posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS library_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parentId TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS library_items (
    id TEXT PRIMARY KEY,
    collectionId TEXT,
    itemType TEXT NOT NULL DEFAULT 'document',
    title TEXT NOT NULL,
    authors TEXT,
    year INTEGER,
    venue TEXT,
    volume TEXT,
    issue TEXT,
    pages TEXT,
    publisher TEXT,
    doi TEXT,
    url TEXT,
    abstract TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    fileUrl TEXT,
    fileName TEXT,
    deletedAt TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
];

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  dbPromise ??= (async () => {
    const db = await Database.load("sqlite:lodestar.db");
    for (const stmt of SCHEMA) await db.execute(stmt);
    return db;
  })();
  return dbPromise;
}
