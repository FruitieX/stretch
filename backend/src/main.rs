mod db;
mod error;
#[cfg(test)]
mod tests;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderValue, header},
    response::{
        IntoResponse,
        sse::{Event as SseEvent, KeepAlive, Sse},
    },
    routing::{get, put},
};
use error::{ApiError, Result};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    convert::Infallible,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tokio::sync::broadcast;
use tokio_stream::{Stream, StreamExt, wrappers::BroadcastStream};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

#[derive(Clone)]
pub struct Server {
    db: Arc<Mutex<Connection>>,
    /// Tells connected devices that something changed so they refetch.
    changes: broadcast::Sender<()>,
}
impl Server {
    pub fn new(db: Connection) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
            changes: broadcast::channel(16).0,
        }
    }
    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(ApiError::internal)
    }
    fn changed(&self) {
        // No receivers just means no device is listening right now.
        let _ = self.changes.send(());
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}
async fn ready(State(s): State<Server>) -> Result<Json<Value>> {
    s.conn()?.query_row("SELECT 1", [], |_| Ok(()))?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct Range {
    from: String,
    to: Option<String>,
}

/// Shared documents plus the events from `from` on, enough to render today.
async fn state(State(s): State<Server>, Query(range): Query<Range>) -> Result<Json<Value>> {
    let from = db::timestamp(&range.from)?;
    let db = s.conn()?;
    Ok(Json(json!({
        "events": db::events(&db, &from, None)?,
        "docs": db::docs(&db)?,
    })))
}
async fn events(State(s): State<Server>, Query(range): Query<Range>) -> Result<Json<Value>> {
    let from = db::timestamp(&range.from)?;
    let to = range.to.as_deref().map(db::timestamp).transpose()?;
    Ok(Json(json!(db::events(&*s.conn()?, &from, to.as_ref())?)))
}
async fn save_event(
    State(s): State<Server>,
    Path(id): Path<String>,
    Json(input): Json<db::EventInput>,
) -> Result<Json<db::Event>> {
    let saved = db::save_event(&mut *s.conn()?, &id, input)?;
    s.changed();
    Ok(Json(saved))
}
async fn delete_event(State(s): State<Server>, Path(id): Path<String>) -> Result<Json<Value>> {
    db::delete_event(&*s.conn()?, &id)?;
    s.changed();
    Ok(Json(json!({ "ok": true })))
}
async fn save_doc(
    State(s): State<Server>,
    Path(key): Path<String>,
    Json(input): Json<db::DocInput>,
) -> Result<Json<db::Doc>> {
    let saved = db::save_doc(&mut *s.conn()?, &key, input)?;
    s.changed();
    Ok(Json(saved))
}
async fn live(
    State(s): State<Server>,
) -> Sse<impl Stream<Item = std::result::Result<SseEvent, Infallible>>> {
    // A lagged receiver still only needs to know that something changed.
    let stream = BroadcastStream::new(s.changes.subscribe())
        .map(|_| Ok(SseEvent::default().event("changed").data("{}")));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(20)))
}
async fn export(State(s): State<Server>) -> Result<impl IntoResponse> {
    let csv = db::export_csv(&*s.conn()?)?;
    let name = format!(
        "attachment; filename=\"stretch-{}.csv\"",
        chrono::Local::now().format("%Y-%m-%d")
    );
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, name),
        ],
        csv,
    ))
}

pub fn app(server: Server, static_dir: PathBuf) -> Router {
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/ready", get(ready))
        .route("/api/state", get(state))
        .route("/api/events", get(events))
        .route("/api/events/{id}", put(save_event).delete(delete_event))
        .route("/api/docs/{key}", put(save_doc))
        .route("/api/live", get(live))
        .route("/api/export.csv", get(export))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        ))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(server);
    api.fallback_service(
        ServeDir::new(&static_dir).fallback(ServeFile::new(static_dir.join("index.html"))),
    )
    .layer(SetResponseHeaderLayer::if_not_present(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    ))
    .layer(SetResponseHeaderLayer::if_not_present(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    ))
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let data = PathBuf::from(std::env::var("STRETCH_DATA_DIR").unwrap_or("data".into()));
    std::fs::create_dir_all(&data)?;
    let path = data.join("stretch.sqlite3");
    let db = db::open(&path).map_err(|e| e.1)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    if std::env::args().nth(1).as_deref() == Some("--backup") {
        let dest = std::env::args()
            .nth(2)
            .ok_or("Supply a destination for --backup")?;
        if std::path::Path::new(&dest).exists() {
            return Err("The backup destination already exists".into());
        }
        db.backup("main", &dest, None::<fn(rusqlite::backup::Progress)>)?;
        return Ok(());
    }
    let bind = std::env::var("STRETCH_BIND").unwrap_or("127.0.0.1:3005".into());
    let static_dir = PathBuf::from(std::env::var("STRETCH_STATIC_DIR").unwrap_or("dist".into()));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("Stretch listening on {bind}");
    axum::serve(listener, app(Server::new(db), static_dir))
        .with_graceful_shutdown(async {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        })
        .await?;
    Ok(())
}
