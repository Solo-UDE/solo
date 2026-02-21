//! Session Manager - High-level API for managing agent sessions
//!
//! Wraps the bridge and provides a clean API for the Tauri commands.

use super::bridge::{AgentBridge, BridgeError, EventCallback, Result};
use super::protocol::{
    AttachmentContentBlock, BridgeRequest, CommandResponse, Model, PermissionResponse,
    SessionConfig,
};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::PathBuf;

/// Session Manager - manages the agent bridge and sessions
#[derive(Debug)]
pub struct SessionManager {
    /// The agent bridge (mutex for thread-safe access)
    bridge: Mutex<AgentBridge>,
    /// Path to the sidecar script
    sidecar_path: PathBuf,
    /// Active session IDs
    active_sessions: Mutex<HashSet<String>>,
}

impl SessionManager {
    /// Create a new session manager
    pub fn new(sidecar_path: PathBuf) -> Self {
        Self {
            bridge: Mutex::new(AgentBridge::new()),
            sidecar_path,
            active_sessions: Mutex::new(HashSet::new()),
        }
    }

    /// Set the event callback for handling async events
    pub fn set_event_callback(&self, callback: EventCallback) {
        let mut bridge = self.bridge.lock();
        bridge.set_event_callback(callback);
    }

    /// Ensure the bridge is running
    fn ensure_running(&self) -> Result<()> {
        let mut bridge = self.bridge.lock();
        if !bridge.is_running() {
            let path = self.sidecar_path.to_str().unwrap_or("agent-bridge");
            bridge.spawn(path)?;
        }
        Ok(())
    }

    /// Check response for errors, returning Ok(()) on success
    fn check_response(response: CommandResponse) -> Result<()> {
        match response {
            CommandResponse::Error { error, .. } => Err(BridgeError::SidecarError(error)),
            _ => Ok(()),
        }
    }

    /// Check response for bool value
    fn check_response_bool(response: CommandResponse) -> Result<bool> {
        match response {
            CommandResponse::Error { error, .. } => Err(BridgeError::SidecarError(error)),
            CommandResponse::Boolean { value, .. } => Ok(value),
            _ => Err(BridgeError::ReceiveError(
                "Unexpected response type".to_owned(),
            )),
        }
    }

    /// Check response for optional string value
    fn check_response_string(response: CommandResponse) -> Result<Option<String>> {
        match response {
            CommandResponse::Error { error, .. } => Err(BridgeError::SidecarError(error)),
            CommandResponse::String { value, .. } => Ok(value),
            _ => Err(BridgeError::ReceiveError(
                "Unexpected response type".to_owned(),
            )),
        }
    }

    /// Create a new session
    pub fn create_session(&self, session_id: &str, config: Option<SessionConfig>) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::CreateSession {
            session_id: session_id.to_owned(),
            config,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)?;

        // Track session
        let _ = self.active_sessions.lock().insert(session_id.to_owned());

        Ok(())
    }

    /// Delete a session
    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        let request = BridgeRequest::DeleteSession {
            session_id: session_id.to_owned(),
        };

        let bridge = self.bridge.lock();
        if bridge.is_running() {
            let response = bridge.send_request(&request)?;
            Self::check_response(response)?;
        }

        // Untrack session
        let _ = self.active_sessions.lock().remove(session_id);

        Ok(())
    }

    /// Send a message to a session
    pub fn send_message(
        &self,
        session_id: &str,
        message: &str,
        attachments: Option<Vec<AttachmentContentBlock>>,
    ) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SendMessage {
            session_id: session_id.to_owned(),
            message: message.to_owned(),
            attachments,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Interrupt a session
    pub fn interrupt(&self, session_id: &str) -> Result<()> {
        let request = BridgeRequest::Interrupt {
            session_id: session_id.to_owned(),
        };

        let bridge = self.bridge.lock();
        if bridge.is_running() {
            let response = bridge.send_request(&request)?;
            Self::check_response(response)?;
        }

        Ok(())
    }

    /// Respond to a permission request
    pub fn respond_to_permission(&self, response: PermissionResponse) -> Result<()> {
        let request = BridgeRequest::PermissionResponse { response };

        let bridge = self.bridge.lock();
        if bridge.is_running() {
            let resp = bridge.send_request(&request)?;
            Self::check_response(resp)?;
        }

        Ok(())
    }

    /// Set thinking mode for a session
    pub fn set_thinking_mode(
        &self,
        session_id: &str,
        enabled: bool,
        max_tokens: Option<u32>,
    ) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SetThinkingMode {
            session_id: session_id.to_owned(),
            enabled,
            max_tokens,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Get thinking mode for a session
    pub fn get_thinking_mode(&self, session_id: &str) -> Result<bool> {
        self.ensure_running()?;

        let request = BridgeRequest::GetThinkingMode {
            session_id: session_id.to_owned(),
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response_bool(response)
    }

    /// Set model for a session
    pub fn set_model(&self, session_id: &str, model: Model) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SetModel {
            session_id: session_id.to_owned(),
            model,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Set plan mode for a session
    pub fn set_plan_mode(&self, session_id: &str, enabled: bool) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SetPlanMode {
            session_id: session_id.to_owned(),
            enabled,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Get plan mode for a session
    pub fn get_plan_mode(&self, session_id: &str) -> Result<bool> {
        self.ensure_running()?;

        let request = BridgeRequest::GetPlanMode {
            session_id: session_id.to_owned(),
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response_bool(response)
    }

    /// Set accept mode for a session
    pub fn set_accept_mode(&self, session_id: &str, enabled: bool) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SetAcceptMode {
            session_id: session_id.to_owned(),
            enabled,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Set tool permission policy for a session
    pub fn set_tool_policy(
        &self,
        session_id: &str,
        mode: &str,
        is_worktree_session: bool,
    ) -> Result<()> {
        self.ensure_running()?;

        let request = BridgeRequest::SetToolPolicy {
            session_id: session_id.to_owned(),
            mode: mode.to_owned(),
            is_worktree_session,
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response(response)
    }

    /// Get accept mode for a session
    pub fn get_accept_mode(&self, session_id: &str) -> Result<bool> {
        self.ensure_running()?;

        let request = BridgeRequest::GetAcceptMode {
            session_id: session_id.to_owned(),
        };

        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        Self::check_response_bool(response)
    }

    /// Check if a session is ready
    pub fn is_session_ready(&self, session_id: &str) -> Result<bool> {
        let bridge = self.bridge.lock();
        if !bridge.is_running() {
            return Ok(false);
        }

        let request = BridgeRequest::IsSessionReady {
            session_id: session_id.to_owned(),
        };

        let response = bridge.send_request(&request)?;
        Self::check_response_bool(response)
    }

    /// Get the SDK session ID
    pub fn get_sdk_session_id(&self, session_id: &str) -> Result<Option<String>> {
        let bridge = self.bridge.lock();
        if !bridge.is_running() {
            return Ok(None);
        }

        let request = BridgeRequest::GetSdkSessionId {
            session_id: session_id.to_owned(),
        };

        let response = bridge.send_request(&request)?;
        Self::check_response_string(response)
    }

    /// Generate a commit message from a diff using the AI bridge
    pub fn generate_commit_message(&self, diff: &str) -> Result<String> {
        self.ensure_running()?;
        let request = BridgeRequest::GenerateCommitMessage {
            diff: diff.to_owned(),
        };
        let bridge = self.bridge.lock();
        let response = bridge.send_request(&request)?;
        let value = Self::check_response_string(response)?;
        value.ok_or_else(|| {
            BridgeError::ReceiveError("Bridge returned null commit message".to_owned())
        })
    }

    /// Check if a session exists
    #[allow(dead_code)]
    pub fn has_session(&self, session_id: &str) -> bool {
        self.active_sessions.lock().contains(session_id)
    }

    /// Get all active session IDs
    #[allow(dead_code)]
    pub fn get_active_sessions(&self) -> Vec<String> {
        self.active_sessions.lock().iter().cloned().collect()
    }

    /// Shutdown the session manager
    #[allow(dead_code)]
    pub fn shutdown(&self) -> Result<()> {
        let mut bridge = self.bridge.lock();
        bridge.shutdown()?;
        self.active_sessions.lock().clear();
        Ok(())
    }
}
