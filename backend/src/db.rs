use crate::error::{ApiError, Result};
use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Shared JSON documents synced between devices.
pub const DOC_KEYS: &[&str] = &["settings", "status"];
const DOC_MAX_BYTES: usize = 16 * 1024;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Activity {
    Sit,
    Stand,
    Walk,
    Eat,
    Break,
    /// Recorded automatically while the user is idle or the screen is locked.
    Away,
    /// Done for the day; time after this is not tracked.
    Off,
}
impl Activity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Sit => "sit",
            Self::Stand => "stand",
            Self::Walk => "walk",
            Self::Eat => "eat",
            Self::Break => "break",
            Self::Away => "away",
            Self::Off => "off",
        }
    }
    fn parse(value: &str) -> Self {
        match value {
            "stand" => Self::Stand,
            "walk" => Self::Walk,
            "eat" => Self::Eat,
            "break" => Self::Break,
            "away" => Self::Away,
            "off" => Self::Off,
            _ => Self::Sit,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// The user picked the activity.
    Manual,
    /// Idle detection recorded it.
    Idle,
    /// The app resumed or inferred it (e.g. after coming back from idle).
    Auto,
}
impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Idle => "idle",
            Self::Auto => "auto",
        }
    }
    fn parse(value: &str) -> Self {
        match value {
            "idle" => Self::Idle,
            "auto" => Self::Auto,
            _ => Self::Manual,
        }
    }
}

/// A change of activity. Each one lasts until the next, so devices merge
/// their changes by union without conflicts.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    /// Local wall-clock time of the change, with its UTC offset.
    pub at: String,
    pub activity: Activity,
    pub source: Source,
    pub updated_at: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventInput {
    pub at: String,
    pub activity: Activity,
    #[serde(default = "manual")]
    pub source: Source,
    /// When the client made this edit. Older edits replayed from an offline
    /// queue never overwrite a newer saved version.
    pub updated_at: Option<String>,
}
fn manual() -> Source {
    Source::Manual
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub value: Value,
    pub updated_at: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocInput {
    pub value: Value,
    pub updated_at: Option<String>,
}

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let mut db = Connection::open(path)?;
    db.busy_timeout(std::time::Duration::from_secs(10))?;
    let mode = std::env::var("STRETCH_SQLITE_JOURNAL_MODE").unwrap_or("WAL".into());
    if !["WAL", "DELETE"].contains(&mode.as_str()) {
        return Err(ApiError::bad("Unsupported journal mode."));
    }
    db.pragma_update(None, "journal_mode", mode)?;
    db.pragma_update(None, "synchronous", "FULL")?;
    migrate(&mut db)?;
    Ok(db)
}

pub fn migrate(db: &mut Connection) -> Result<()> {
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > 1 {
        return Err(ApiError::bad(
            "This database needs a newer Stretch release.",
        ));
    }
    if version == 0 {
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute_batch(
            "CREATE TABLE events(
               id TEXT PRIMARY KEY,
               at TEXT NOT NULL,
               at_utc TEXT NOT NULL,
               activity TEXT NOT NULL CHECK(activity IN ('sit','stand','walk','eat','break','away','off')),
               source TEXT NOT NULL CHECK(source IN ('manual','idle','auto')),
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL,
               deleted_at TEXT
             );
             CREATE INDEX events_at ON events(at_utc);
             CREATE TABLE docs(
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        )?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    Ok(())
}

fn event_row(r: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        at: r.get(1)?,
        activity: Activity::parse(&r.get::<_, String>(2)?),
        source: Source::parse(&r.get::<_, String>(3)?),
        updated_at: r.get(4)?,
    })
}

const EVENT_COLUMNS: &str = "id,at,activity,source,updated_at";

fn utc(value: &DateTime<FixedOffset>) -> String {
    value
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn timestamp(value: &str) -> Result<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| ApiError::bad("Times must be RFC 3339 timestamps."))
}

/// Events at or after `from` (and before `to`, if given), plus the last event
/// before `from` so the activity in progress at `from` is known.
pub fn events(
    db: &Connection,
    from: &DateTime<FixedOffset>,
    to: Option<&DateTime<FixedOffset>>,
) -> Result<Vec<Event>> {
    let from = utc(from);
    let to = to.map(utc).unwrap_or_else(|| "9999".into());
    let mut stmt = db.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM (
           SELECT * FROM (SELECT * FROM events WHERE deleted_at IS NULL AND at_utc < ?1 ORDER BY at_utc DESC LIMIT 1)
           UNION ALL
           SELECT * FROM events WHERE deleted_at IS NULL AND at_utc >= ?1 AND at_utc < ?2
         ) ORDER BY at_utc, created_at"
    ))?;
    let rows = stmt.query_map(params![from, to], event_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn all_events(db: &Connection) -> Result<Vec<Event>> {
    let mut stmt = db.prepare(&format!(
        "SELECT {EVENT_COLUMNS} FROM events WHERE deleted_at IS NULL ORDER BY at_utc, created_at"
    ))?;
    let rows = stmt.query_map([], event_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn event(db: &Connection, id: &str) -> Result<Option<Event>> {
    Ok(db
        .query_row(
            &format!("SELECT {EVENT_COLUMNS} FROM events WHERE id=?1 AND deleted_at IS NULL"),
            [id],
            event_row,
        )
        .optional()?)
}

fn valid_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Err(ApiError::bad("Invalid id."))
    } else {
        Ok(())
    }
}

/// The client's edit time, never later than now so a skewed clock cannot
/// pin a value forever.
fn edit_time(value: Option<&str>) -> Result<String> {
    let now = Utc::now();
    let updated = match value {
        Some(value) => timestamp(value)?.with_timezone(&Utc).min(now),
        None => now,
    };
    Ok(updated.to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// Inserts or updates an activity change. Saving is idempotent, so clients
/// can retry queued offline saves safely with the same id.
pub fn save_event(db: &mut Connection, id: &str, input: EventInput) -> Result<Event> {
    valid_id(id)?;
    let at = timestamp(&input.at)?;
    let updated_at = edit_time(input.updated_at.as_deref())?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT updated_at, deleted_at FROM events WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match existing {
        Some((_, Some(_))) => return Err(ApiError::not_found()),
        Some((saved, None)) if saved > updated_at => {
            // A newer edit already arrived; keep it.
        }
        Some(_) => {
            tx.execute(
                "UPDATE events SET at=?2,at_utc=?3,activity=?4,source=?5,updated_at=?6 WHERE id=?1",
                params![
                    id,
                    at.to_rfc3339(),
                    utc(&at),
                    input.activity.as_str(),
                    input.source.as_str(),
                    updated_at
                ],
            )?;
        }
        None => {
            tx.execute(
                "INSERT INTO events(id,at,at_utc,activity,source,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",
                params![
                    id,
                    at.to_rfc3339(),
                    utc(&at),
                    input.activity.as_str(),
                    input.source.as_str(),
                    updated_at
                ],
            )?;
        }
    }
    let saved = event(&tx, id)?.ok_or_else(ApiError::not_found)?;
    tx.commit()?;
    Ok(saved)
}

/// Deletes are tombstones so a delayed offline save cannot resurrect them.
pub fn delete_event(db: &Connection, id: &str) -> Result<()> {
    valid_id(id)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    db.execute(
        "UPDATE events SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    Ok(())
}

pub fn docs(db: &Connection) -> Result<serde_json::Map<String, Value>> {
    let mut stmt = db.prepare("SELECT key,value,updated_at FROM docs ORDER BY key")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut out = serde_json::Map::new();
    for row in rows {
        let (key, value, updated_at) = row?;
        let doc = Doc {
            value: serde_json::from_str(&value).unwrap_or(Value::Null),
            updated_at,
        };
        out.insert(key, serde_json::to_value(doc)?);
    }
    Ok(out)
}

/// Saves a shared document with last-writer-wins on the client edit time.
/// The client owns the shape; the server only checks it is a small object.
pub fn save_doc(db: &mut Connection, key: &str, input: DocInput) -> Result<Doc> {
    if !DOC_KEYS.contains(&key) {
        return Err(ApiError::bad("Unknown document."));
    }
    if !input.value.is_object() {
        return Err(ApiError::bad("Documents must be JSON objects."));
    }
    let value = serde_json::to_string(&input.value)?;
    if value.len() > DOC_MAX_BYTES {
        return Err(ApiError::bad("That document is too large."));
    }
    let updated_at = edit_time(input.updated_at.as_deref())?;
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute(
        "INSERT INTO docs(key,value,updated_at) VALUES(?1,?2,?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
         WHERE excluded.updated_at >= docs.updated_at",
        params![key, value, updated_at],
    )?;
    let (value, updated_at): (String, String) = tx.query_row(
        "SELECT value,updated_at FROM docs WHERE key=?1",
        [key],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    tx.commit()?;
    Ok(Doc {
        value: serde_json::from_str(&value)?,
        updated_at,
    })
}

/// One row per activity span: when it started, when the next change came and
/// how many minutes it lasted. The last span is left open.
pub fn export_csv(db: &Connection) -> Result<String> {
    let events = all_events(db)?;
    let mut out = String::from("start,end,minutes,activity,source\n");
    for (i, e) in events.iter().enumerate() {
        let next = events.get(i + 1);
        let minutes = match next {
            Some(n) => {
                let span = timestamp(&n.at)? - timestamp(&e.at)?;
                format!("{:.1}", span.num_seconds() as f64 / 60.0)
            }
            None => String::new(),
        };
        out.push_str(&format!(
            "{},{},{},{},{}\n",
            e.at,
            next.map_or("", |n| n.at.as_str()),
            minutes,
            e.activity.as_str(),
            e.source.as_str()
        ));
    }
    Ok(out)
}
