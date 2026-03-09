use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::config::ServerConfig;

/// Thin wrapper around [`reqwest::Client`] that knows the server base URL.
#[derive(Clone)]
pub struct Client {
    inner: reqwest::Client,
    base_url: String,
}

impl Client {
    pub fn new(cfg: &ServerConfig) -> Self {
        Self {
            inner: reqwest::Client::new(),
            base_url: cfg.base_url(),
        }
    }

    /// Build a full URL from a path like `/api/sessions`.
    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base_url)
    }

    // ── generic verbs ────────────────────────────────────────────────

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, Box<dyn std::error::Error>> {
        let resp = self.inner.get(self.url(path)).send().await?;
        handle_response(resp).await
    }

    pub async fn get_with_query<T, Q>(&self, path: &str, query: &Q) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        Q: Serialize + ?Sized,
    {
        let resp = self.inner.get(self.url(path)).query(query).send().await?;
        handle_response(resp).await
    }

    pub async fn post<T, B>(&self, path: &str, body: &B) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let resp = self.inner.post(self.url(path)).json(body).send().await?;
        handle_response(resp).await
    }

    pub async fn post_empty(&self, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.inner.post(self.url(path)).send().await?;
        handle_response(resp).await
    }

    pub async fn post_empty_with_query<Q>(&self, path: &str, query: &Q) -> Result<serde_json::Value, Box<dyn std::error::Error>>
    where
        Q: Serialize + ?Sized,
    {
        let resp = self.inner.post(self.url(path)).query(query).send().await?;
        handle_response(resp).await
    }

    pub async fn patch<T, B>(&self, path: &str, body: &B) -> Result<T, Box<dyn std::error::Error>>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let resp = self.inner.patch(self.url(path)).json(body).send().await?;
        handle_response(resp).await
    }

    pub async fn delete(&self, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.inner.delete(self.url(path)).send().await?;
        handle_response(resp).await
    }

    pub async fn delete_with_body<B: Serialize + ?Sized>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.inner.delete(self.url(path)).json(body).send().await?;
        handle_response(resp).await
    }

    /// POST with a raw JSON value body, returning raw JSON.
    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self.inner.post(self.url(path)).json(body).send().await?;
        handle_response(resp).await
    }

    /// POST reading body bytes from stdin (for `task sync`).
    pub async fn post_raw_bytes(
        &self,
        path: &str,
        bytes: Vec<u8>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
        let resp = self
            .inner
            .post(self.url(path))
            .header("content-type", "application/json")
            .body(bytes)
            .send()
            .await?;
        handle_response(resp).await
    }
}

/// Turn an HTTP response into a deserialized value or a descriptive error.
async fn handle_response<T: DeserializeOwned>(resp: reqwest::Response) -> Result<T, Box<dyn std::error::Error>> {
    let status = resp.status();
    if status.is_success() {
        let body = resp.text().await?;
        if body.is_empty() {
            // Try to deserialize from `null` – works for serde_json::Value.
            return Ok(serde_json::from_str("null")?);
        }
        Ok(serde_json::from_str(&body)?)
    } else {
        let code = status.as_u16();
        let reason = status.canonical_reason().unwrap_or("Unknown");
        let body = resp.text().await.unwrap_or_default();
        if body.is_empty() {
            Err(format!("HTTP {code} {reason}").into())
        } else {
            Err(format!("HTTP {code} {reason}: {body}").into())
        }
    }
}
