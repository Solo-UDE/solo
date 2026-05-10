use crate::error::Result;
use rusqlite::{params, Connection};
use std::path::Path;

pub struct History {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct HistoryRow {
    pub id: String,
    pub mode: String, // "Dictation" | "Dispatch"
    pub raw_transcript: String,
    pub formatted: String,
    pub target_app_bundle_id: Option<String>,
    pub target_app_name: Option<String>,
    pub duration_ms: u32,
    pub linked_session_id: Option<String>,
    pub created_at: i64,
}

impl History {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS voice_transcripts (
                id                    TEXT PRIMARY KEY,
                mode                  TEXT NOT NULL,
                raw_transcript        TEXT NOT NULL,
                formatted             TEXT NOT NULL,
                target_app_bundle_id  TEXT,
                target_app_name       TEXT,
                duration_ms           INTEGER NOT NULL,
                linked_session_id     TEXT,
                created_at            INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_voice_transcripts_created_at
                ON voice_transcripts(created_at DESC);
            "#,
        )?;
        Ok(())
    }

    pub fn insert(&self, row: &HistoryRow) -> Result<()> {
        self.conn.execute(
            r#"INSERT INTO voice_transcripts
               (id, mode, raw_transcript, formatted, target_app_bundle_id,
                target_app_name, duration_ms, linked_session_id, created_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)"#,
            params![
                row.id,
                row.mode,
                row.raw_transcript,
                row.formatted,
                row.target_app_bundle_id,
                row.target_app_name,
                row.duration_ms,
                row.linked_session_id,
                row.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn list(&self, limit: u32) -> Result<Vec<HistoryRow>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, mode, raw_transcript, formatted, target_app_bundle_id,
                      target_app_name, duration_ms, linked_session_id, created_at
               FROM voice_transcripts
               ORDER BY created_at DESC
               LIMIT ?1"#,
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(HistoryRow {
                    id: r.get(0)?,
                    mode: r.get(1)?,
                    raw_transcript: r.get(2)?,
                    formatted: r.get(3)?,
                    target_app_bundle_id: r.get(4)?,
                    target_app_name: r.get(5)?,
                    duration_ms: r.get(6)?,
                    linked_session_id: r.get(7)?,
                    created_at: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM voice_transcripts WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row() -> HistoryRow {
        HistoryRow {
            id: "abc".into(),
            mode: "Dictation".into(),
            raw_transcript: "hello".into(),
            formatted: "Hello.".into(),
            target_app_bundle_id: Some("com.slack.Slack".into()),
            target_app_name: Some("Slack".into()),
            duration_ms: 1500,
            linked_session_id: None,
            created_at: 1_700_000_000_000,
        }
    }

    #[test]
    fn insert_and_list() {
        let h = History::in_memory().unwrap();
        h.insert(&sample_row()).unwrap();
        let rows = h.list(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "abc");
    }

    #[test]
    fn delete_removes() {
        let h = History::in_memory().unwrap();
        h.insert(&sample_row()).unwrap();
        h.delete("abc").unwrap();
        assert_eq!(h.list(10).unwrap().len(), 0);
    }

    #[test]
    fn list_is_ordered_by_created_at_desc() {
        let h = History::in_memory().unwrap();
        let mut r1 = sample_row();
        r1.id = "old".into();
        r1.created_at = 1_000;
        let mut r2 = sample_row();
        r2.id = "new".into();
        r2.created_at = 9_999;
        h.insert(&r1).unwrap();
        h.insert(&r2).unwrap();
        let rows = h.list(10).unwrap();
        assert_eq!(rows[0].id, "new");
        assert_eq!(rows[1].id, "old");
    }
}
