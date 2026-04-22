//! Deny-list — block destructive / dangerous shell commands regardless of
//! the task's permission mode. Evaluated on every `agent:permission_request`.

/// Default global deny-list. Shipped with Solo. Additive with per-task
/// `deny_list` from `AgentConfig`.
pub const DEFAULT_DENY_LIST: &[&str] = &[
    "rm -rf /*",
    "rm -rf /",
    "sudo ",          // any sudo invocation
    "curl * | sh",
    "curl * | bash",
    "wget * | sh",
    "git push --force",
    "git push -f",
    "git reset --hard",
    ":(){:|:&};:",    // fork bomb
    "mkfs",
    "dd if=/dev",
];

/// Does `cmd` (the raw shell command string the agent wants to run) match
/// any pattern in `patterns`? Patterns containing `*` are treated as wildcards
/// at that position (simple `contains` semantics for now).
pub fn is_denied(cmd: &str, patterns: &[&str]) -> Option<String> {
    let cmd_trim = cmd.trim();
    for p in patterns {
        if matches_pattern(cmd_trim, p) {
            return Some((*p).to_string());
        }
    }
    None
}

fn matches_pattern(cmd: &str, pattern: &str) -> bool {
    // No wildcard → substring contains (matches `rm -rf /` within longer commands too)
    if !pattern.contains('*') {
        return cmd.contains(pattern);
    }
    // Split pattern by '*'; command must contain each piece in order
    let pieces: Vec<&str> = pattern.split('*').collect();
    let mut cursor = 0;
    for piece in &pieces {
        if piece.is_empty() { continue; }
        match cmd[cursor..].find(piece) {
            Some(i) => cursor += i + piece.len(),
            None => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_substring_matches() {
        assert!(is_denied("sudo apt install", &["sudo "]).is_some());
        assert!(is_denied("run git push --force origin main", &["git push --force"]).is_some());
    }

    #[test]
    fn wildcards_match_bracketing() {
        assert!(is_denied("curl https://x | sh", &["curl * | sh"]).is_some());
        assert!(is_denied("curl https://x | bash", &["curl * | sh"]).is_none());
    }

    #[test]
    fn benign_commands_pass() {
        assert!(is_denied("ls -la", DEFAULT_DENY_LIST).is_none());
        assert!(is_denied("git status", DEFAULT_DENY_LIST).is_none());
        assert!(is_denied("cargo test", DEFAULT_DENY_LIST).is_none());
    }

    #[test]
    fn dangerous_defaults_blocked() {
        assert!(is_denied("rm -rf /", DEFAULT_DENY_LIST).is_some());
        assert!(is_denied("sudo rm stuff", DEFAULT_DENY_LIST).is_some());
    }
}
