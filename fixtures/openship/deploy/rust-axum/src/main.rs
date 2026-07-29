use axum::{routing::get, Router};
use std::env;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/", get(|| async { "hello from axum\n" }));
    let port: u16 = env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
