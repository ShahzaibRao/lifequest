import * as SQLite from "expo-sqlite";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("lifequest.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS local_sessions (
          session_uuid TEXT PRIMARY KEY NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          total_steps INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_points (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_uuid TEXT NOT NULL,
          seq INTEGER NOT NULL,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          accuracy_m REAL,
          recorded_at TEXT NOT NULL,
          UNIQUE(session_uuid, seq)
        );
      `);
      // M3 columns. Each ALTER fails harmlessly if the column already exists.
      const migrations = [
        "ALTER TABLE local_sessions ADD COLUMN server_status TEXT",
        "ALTER TABLE local_sessions ADD COLUMN last_uploaded_seq INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE local_sessions ADD COLUMN server_result TEXT",
      ];
      for (const sql of migrations) {
        try {
          await db.execAsync(sql);
        } catch {
          // Column already exists — nothing to do.
        }
      }
      return db;
    });
  }
  return dbPromise;
}
