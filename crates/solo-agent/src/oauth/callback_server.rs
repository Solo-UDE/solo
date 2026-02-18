//! OAuth callback server
//!
//! A one-shot HTTP server that handles OAuth redirects from the browser.

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Default callback port for Solo OAuth
pub const CALLBACK_PORT: u16 = 19877;

/// Result from OAuth callback
#[derive(Debug, Clone)]
pub struct CallbackResult {
    /// Authorization code from OAuth provider
    pub code: String,
    /// State parameter for verification
    pub state: String,
}

/// Error type for callback server
#[derive(Debug, thiserror::Error)]
pub enum CallbackError {
    #[error("Server bind error: {0}")]
    BindError(String),
    #[error("Timeout waiting for callback")]
    Timeout,
    #[error("Missing authorization code")]
    MissingCode,
    #[error("Missing state parameter")]
    MissingState,
    #[error("OAuth error: {0}")]
    OAuthError(String),
    #[error("Server error: {0}")]
    ServerError(String),
}

/// Parse query string into key-value pairs
fn parse_query_string(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let key = parts.next()?;
            let value = parts.next().unwrap_or("");
            Some((
                urlencoding::decode(key).ok()?.into_owned(),
                urlencoding::decode(value).ok()?.into_owned(),
            ))
        })
        .collect()
}

/// HTML response for successful authentication
fn success_html() -> &'static str {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful - Solo IDE</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e2e8f0;
        }
        .container {
            text-align: center;
            padding: 3rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 400px;
        }
        .checkmark {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
        .checkmark svg {
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
            fill: none;
        }
        h1 {
            font-size: 1.5rem;
            margin-bottom: 0.75rem;
            color: #f1f5f9;
        }
        p {
            color: #94a3b8;
            font-size: 0.95rem;
            line-height: 1.6;
        }
        .logo {
            margin-top: 2rem;
            opacity: 0.6;
            font-size: 0.85rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">
            <svg viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        </div>
        <h1>Authentication Successful</h1>
        <p>You can close this window and return to Solo IDE.</p>
        <p class="logo">Solo IDE</p>
    </div>
    <script>
        // Auto-close after 3 seconds
        setTimeout(() => window.close(), 3000);
    </script>
</body>
</html>"#
}

/// HTML response for error
fn error_html(error: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Failed - Solo IDE</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #e2e8f0;
        }}
        .container {{
            text-align: center;
            padding: 3rem;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 400px;
        }}
        .error-icon {{
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .error-icon svg {{
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
            fill: none;
        }}
        h1 {{
            font-size: 1.5rem;
            margin-bottom: 0.75rem;
            color: #f1f5f9;
        }}
        p {{
            color: #94a3b8;
            font-size: 0.95rem;
            line-height: 1.6;
        }}
        .error-message {{
            margin-top: 1rem;
            padding: 0.75rem;
            background: rgba(239, 68, 68, 0.1);
            border-radius: 8px;
            color: #fca5a5;
            font-family: monospace;
            font-size: 0.85rem;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">
            <svg viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </div>
        <h1>Authentication Failed</h1>
        <p>Please try again or use a different authentication method.</p>
        <div class="error-message">{}</div>
    </div>
</body>
</html>"#,
        error
    )
}

/// Handle incoming HTTP request
#[allow(clippy::needless_pass_by_value, clippy::unnecessary_wraps)]
fn handle_request(
    req: Request<Incoming>,
    tx: oneshot::Sender<Result<CallbackResult, CallbackError>>,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    let uri = req.uri();
    let query = uri.query().unwrap_or("");
    let params = parse_query_string(query);

    // Check for OAuth error
    if let Some(error) = params.get("error") {
        let description = params
            .get("error_description")
            .map(|s| s.as_str())
            .unwrap_or("Unknown error");

        let _ = tx.send(Err(CallbackError::OAuthError(format!(
            "{}: {}",
            error, description
        ))));

        let html = error_html(description);
        return Ok(Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header("Content-Type", "text/html; charset=utf-8")
            .body(Full::new(Bytes::from(html)))
            .unwrap());
    }

    // Extract code and state
    let code = match params.get("code") {
        Some(c) => c.clone(),
        None => {
            let _ = tx.send(Err(CallbackError::MissingCode));
            let html = error_html("Missing authorization code");
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "text/html; charset=utf-8")
                .body(Full::new(Bytes::from(html)))
                .unwrap());
        }
    };

    let state = match params.get("state") {
        Some(s) => s.clone(),
        None => {
            let _ = tx.send(Err(CallbackError::MissingState));
            let html = error_html("Missing state parameter");
            return Ok(Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .header("Content-Type", "text/html; charset=utf-8")
                .body(Full::new(Bytes::from(html)))
                .unwrap());
        }
    };

    // Send successful result
    let _ = tx.send(Ok(CallbackResult { code, state }));

    // Return success page
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/html; charset=utf-8")
        .body(Full::new(Bytes::from(success_html())))
        .unwrap())
}

/// Start the callback server and wait for the OAuth redirect
///
/// This is a one-shot server that:
/// 1. Binds to 127.0.0.1:19877
/// 2. Waits for a single OAuth callback request
/// 3. Extracts code and state parameters
/// 4. Returns success/error HTML to the browser
/// 5. Shuts down automatically
///
/// # Arguments
/// * `timeout` - Maximum time to wait for callback (default 5 minutes)
///
/// # Returns
/// * `Ok(CallbackResult)` - The authorization code and state
/// * `Err(CallbackError)` - If binding, timeout, or OAuth error occurs
pub async fn start_callback_server(
    timeout: Option<Duration>,
) -> Result<CallbackResult, CallbackError> {
    let timeout = timeout.unwrap_or(Duration::from_secs(300)); // 5 minutes default

    let addr = SocketAddr::from(([127, 0, 0, 1], CALLBACK_PORT));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| CallbackError::BindError(e.to_string()))?;

    tracing::info!("OAuth callback server listening on http://{}", addr);

    // Create oneshot channel for result
    let (tx, rx) = oneshot::channel();

    // Wrap tx in Option so we can take it once
    let tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(tx)));

    // Accept one connection with timeout
    let result = tokio::time::timeout(timeout, async {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let io = TokioIo::new(stream);
                let tx = tx.clone();

                // Create a service that handles the request
                let service = service_fn(move |req| {
                    let tx = tx.clone();
                    async move {
                        let tx = tx.lock().await.take();
                        match tx {
                            Some(tx) => handle_request(req, tx),
                            None => {
                                // Already handled, return simple response
                                Ok(Response::builder()
                                    .status(StatusCode::OK)
                                    .body(Full::new(Bytes::from("Already processed")))
                                    .unwrap())
                            }
                        }
                    }
                });

                // Serve the connection
                if let Err(e) = http1::Builder::new().serve_connection(io, service).await {
                    tracing::warn!("Error serving connection: {}", e);
                }
            }
            Err(e) => {
                tracing::error!("Failed to accept connection: {}", e);
            }
        }
    })
    .await;

    // Check if we timed out
    if result.is_err() {
        return Err(CallbackError::Timeout);
    }

    // Get the result from the handler
    rx.await
        .map_err(|_| CallbackError::ServerError("Failed to receive callback result".to_string()))?
}

/// Get the callback URL for OAuth redirects
pub fn get_callback_url() -> String {
    format!("http://127.0.0.1:{}/callback", CALLBACK_PORT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_query_string() {
        let query = "code=abc123&state=xyz789";
        let params = parse_query_string(query);
        assert_eq!(params.get("code"), Some(&"abc123".to_string()));
        assert_eq!(params.get("state"), Some(&"xyz789".to_string()));
    }

    #[test]
    fn test_parse_query_string_encoded() {
        let query = "code=abc%20123&state=xyz%3D789";
        let params = parse_query_string(query);
        assert_eq!(params.get("code"), Some(&"abc 123".to_string()));
        assert_eq!(params.get("state"), Some(&"xyz=789".to_string()));
    }

    #[test]
    fn test_callback_url() {
        assert_eq!(
            get_callback_url(),
            format!("http://127.0.0.1:{}/callback", CALLBACK_PORT)
        );
    }
}
