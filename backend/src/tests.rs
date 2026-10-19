use crate::{Server, app, db};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

fn server() -> (axum::Router, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let db = db::open(&dir.path().join("test.sqlite3")).unwrap();
    (app(Server::new(db), dir.path().to_path_buf()), dir)
}

async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    let body = match body {
        Some(b) => {
            req = req.header("content-type", "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const FROM: &str = "/api/state?from=2026-10-19T00:00:00%2B03:00";

#[tokio::test]
async fn starts_empty() {
    let (app, _dir) = server();
    let (status, state) = call(&app, "GET", FROM, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(state, json!({ "events": [], "docs": {} }));
}

#[tokio::test]
async fn saves_edits_and_deletes_events() {
    let (app, _dir) = server();
    let sit = json!({
        "at": "2026-10-19T09:02:00+03:00",
        "activity": "sit",
        "updatedAt": "2026-10-01T09:00:00Z"
    });
    let (status, saved) = call(&app, "PUT", "/api/events/e1", Some(sit.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["activity"], "sit");
    assert_eq!(saved["source"], "manual");

    // Saving again with the same id is idempotent and edits in place.
    let stand = json!({
        "at": "2026-10-19T09:02:00+03:00",
        "activity": "stand",
        "updatedAt": "2026-10-01T09:10:00Z"
    });
    call(&app, "PUT", "/api/events/e1", Some(stand)).await;
    let (_, state) = call(&app, "GET", FROM, None).await;
    assert_eq!(state["events"].as_array().unwrap().len(), 1);
    assert_eq!(state["events"][0]["activity"], "stand");

    // A stale queued edit does not override the newer save.
    let stale = json!({
        "at": "2026-10-19T09:02:00+03:00",
        "activity": "walk",
        "updatedAt": "2026-10-01T09:05:00Z"
    });
    let (_, saved) = call(&app, "PUT", "/api/events/e1", Some(stale)).await;
    assert_eq!(saved["activity"], "stand");

    // Deleting leaves a tombstone that a delayed save cannot resurrect.
    let (status, _) = call(&app, "DELETE", "/api/events/e1", None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = call(&app, "PUT", "/api/events/e1", Some(sit)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, state) = call(&app, "GET", FROM, None).await;
    assert_eq!(state["events"], json!([]));
}

#[tokio::test]
async fn state_includes_the_activity_in_progress() {
    let (app, _dir) = server();
    for (id, at, activity) in [
        ("a", "2026-10-18T14:00:00+03:00", "sit"),
        ("b", "2026-10-18T15:40:00+03:00", "off"),
        ("c", "2026-10-19T09:00:00+03:00", "stand"),
        ("d", "2026-10-19T08:30:00Z", "walk"),
    ] {
        let body = json!({ "at": at, "activity": activity });
        call(&app, "PUT", &format!("/api/events/{id}"), Some(body)).await;
    }
    let (_, state) = call(&app, "GET", FROM, None).await;
    let ids: Vec<&str> = state["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap())
        .collect();
    // Yesterday's last change, then today's in time order across offsets.
    assert_eq!(ids, ["b", "c", "d"]);

    let (_, range) = call(
        &app,
        "GET",
        "/api/events?from=2026-10-18T00:00:00%2B03:00&to=2026-10-19T00:00:00%2B03:00",
        None,
    )
    .await;
    assert_eq!(range.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn rejects_invalid_events() {
    let (app, _dir) = server();
    let cases = [
        (
            "bad id!",
            json!({ "at": "2026-10-19T09:00:00+03:00", "activity": "sit" }),
        ),
        ("e1", json!({ "at": "yesterday", "activity": "sit" })),
        (
            "e1",
            json!({ "at": "2026-10-19T09:00:00+03:00", "activity": "nap" }),
        ),
        (
            "e1",
            json!({ "at": "2026-10-19T09:00:00+03:00", "activity": "sit", "x": 1 }),
        ),
    ];
    for (id, body) in cases {
        let path = format!("/api/events/{}", id.replace(' ', "%20"));
        let (status, _) = call(&app, "PUT", &path, Some(body.clone())).await;
        assert!(status.is_client_error(), "{body} should be rejected");
    }
}

#[tokio::test]
async fn docs_are_last_writer_wins() {
    let (app, _dir) = server();
    let newer = json!({ "value": { "workdayEnd": "15:40" }, "updatedAt": "2026-10-01T09:00:00Z" });
    let (status, _) = call(&app, "PUT", "/api/docs/settings", Some(newer)).await;
    assert_eq!(status, StatusCode::OK);
    let older = json!({ "value": { "workdayEnd": "17:00" }, "updatedAt": "2026-10-01T08:00:00Z" });
    let (_, saved) = call(&app, "PUT", "/api/docs/settings", Some(older)).await;
    assert_eq!(saved["value"]["workdayEnd"], "15:40");
    let (_, state) = call(&app, "GET", FROM, None).await;
    assert_eq!(state["docs"]["settings"]["value"]["workdayEnd"], "15:40");

    let (status, _) = call(&app, "PUT", "/api/docs/other", Some(json!({ "value": {} }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        "PUT",
        "/api/docs/status",
        Some(json!({ "value": [1] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn exports_spans_as_csv() {
    let (app, _dir) = server();
    for (id, at, activity) in [
        ("a", "2026-10-19T09:00:00+03:00", "sit"),
        ("b", "2026-10-19T09:45:00+03:00", "stand"),
    ] {
        let body = json!({ "at": at, "activity": activity });
        call(&app, "PUT", &format!("/api/events/{id}"), Some(body)).await;
    }
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/export.csv")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let text =
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "start,end,minutes,activity,source");
    assert_eq!(
        lines[1],
        "2026-10-19T09:00:00+03:00,2026-10-19T09:45:00+03:00,45.0,sit,manual"
    );
    assert_eq!(lines[2], "2026-10-19T09:45:00+03:00,,,stand,manual");
}

#[tokio::test]
async fn writes_notify_live_listeners() {
    let dir = tempfile::tempdir().unwrap();
    let server = Server::new(db::open(&dir.path().join("t.sqlite3")).unwrap());
    let mut rx = server.changes.subscribe();
    let app = app(server, dir.path().to_path_buf());
    let body = json!({ "at": "2026-10-19T09:00:00+03:00", "activity": "walk" });
    call(&app, "PUT", "/api/events/w", Some(body)).await;
    assert!(rx.try_recv().is_ok());
}
