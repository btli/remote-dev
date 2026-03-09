use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::config::{ConnectionMethod, ServerConfig};

/// Dual-client wrapper that routes requests to the correct server.
///
/// - `/internal/*` paths -> terminal server (agent status, todo sync, stop check)
/// - All other paths -> API server (sessions, tasks, notifications, browser, etc.)
#[derive(Clone)]
pub struct Client {
    api_client: reqwest::Client,
    api_base_url: String,
    terminal_client: reqwest::Client,
    terminal_base_url: String,
    api_key: Option<String>,
}

fn build_client(method: &ConnectionMethod) -> reqwest::Client {
    match method {
        ConnectionMethod::UnixSocket(path) => reqwest::Client::builder()
            .unix_socket(path.clone())
            .build()
            .expect("failed to build unix socket client"),
        ConnectionMethod::Tcp(_) => reqwest::Client::new(),
    }
}

impl Client {
    pub fn new(cfg: &ServerConfig) -> Self {
        Self {
            api_client: build_client(&cfg.api),
            api_base_url: cfg.api_base_url(),
            terminal_client: build_client(&cfg.terminal),
            terminal_base_url: cfg.terminal_base_url(),
            api_key: cfg.api_key.clone(),
        }
    }

    /// Build a request builder routed to the correct server with auth applied.
    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let is_internal = path.starts_with("/internal/");
        let (client, base) = if is_internal {
            (&self.terminal_client, &self.terminal_base_url)
        } else {
            (&self.api_client, &self.api_base_url)
        };
        let url = format!("{base}{path}");
        let builder = client.request(method, &url);
        if !is_internal {
            if let Some(ref key) = self.api_key {
                return builder.header("authorization", format!("Bearer {key}"));
            }
        }
        builder
    }

    // ── generic verbs ────────────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::GET, path).send().await?;
        handle_response(resp).await
    }

    pub async fn get_with_query<T, Q>(&self, path: &str, query: &Q) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        Q: Serialize + ?Sized,
    {
        let resp = self.request(reqwest::Method::GET, path).query(query).send().await?;
        handle_response(resp).await
    }

    pub async fn get_bytes(&self, path: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::GET, path).send().await?;
        if resp.status().is_success() {
            Ok(resp.bytes().await?.to_vec())
        } else {
            Err(format_http_error(resp).await.into())
        }
    }

    pub async fn post<T, B>(&self, path: &str, body: &B) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let resp = self.request(reqwest::Method::POST, path).json(body).send().await?;
        handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::POST, path).send().await?;
        handle_response(resp).await
    }

    pub async fn post_empty_with_query<Q>(&self, path: &str, query: &Q) -> Result<serde_json::Value, Box<dyn std::error::Error>>
    where
        Q: Serialize + ?Sized,
    {
        let resp = self.request(reqwest::Method::POST, path).query(query).send().await?;
        handle_response(resp).await
    }

    pub async fn patch<T, B>(&self, path: &str, body: &B) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let resp = self.request(reqwest::Method::PATCH, path).json(body).send().await?;
        handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::DELETE, path).send().await?;
        handle_response(resp).await
    }

    pub async fn delete_with_body<B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::DELETE, path).json(body).send().await?;
        handle_response(resp).await
    }

    /// POST with a raw JSON value body, returning raw JSON.
    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.request(reqwest::Method::POST, path).json(body).send().await?;
        handle_response(resp).await
    }

    /// POST reading body bytes from stdin (for `task sync`).
    pub async fn post_raw_bytes(
        &self,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self
            .request(reqwest::Method::POST, path)
            .header("content-type", "application/json")
            .body(bytes)
            .send()
            .await?;
        handle_response(resp).await
    }
}

/// Format an HTTP error response into a descriptive string.
async fn format_http_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let code = status.as_u16();
    let reason = status.canonical_reason().unwrap_or("Unknown");
    let body = resp.text().await.unwrap_or_default();
    if body.is_empty() {
        format!("HTTP {code} {reason}")
    } else {
        format!("HTTP {code} {reason}: {body}")
    }
}

/// Turn an HTTP response into a deserialized value or a descriptive error.
async fn handle_response<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, Box<dyn std::error::Error>> {
    let status = resp.status();
    if status.is_success() {
        let body = resp.text().await?;
        if body.is_empty() {
            // Try to deserialize from `null` -- works for serde_json::Value.
            return Ok(serde_json::from_str("null")?);
        }
        Ok(serde_json::from_str(&body)?)
    } else {
        Err(format_http_error(resp).await.into())
    }
}
