PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS fs_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fs_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, encrypted BLOB NOT NULL);
INSERT OR IGNORE INTO fs_migrations VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
