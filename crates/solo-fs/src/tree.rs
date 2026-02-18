//! Directory tree building with lazy loading support
//!
//! # Learning Resources for this module:
//!
//! 1. **Rust std::fs module**: https://doc.rust-lang.org/std/fs/index.html
//!    - `read_dir()` - iterate directory entries
//!    - `metadata()` - get file info (size, modified time)
//!
//! 2. **walkdir crate**: https://docs.rs/walkdir/latest/walkdir/
//!    - Used for recursive directory traversal
//!    - `WalkDir::new(path).max_depth(n)` - limit recursion depth
//!
//! 3. **ignore crate** (for future improvement): https://docs.rs/ignore/latest/ignore/
//!    - Respects .gitignore files automatically
//!    - Parallel walking with `WalkBuilder::build_parallel()`
//!    - Used by ripgrep (rg) for fast file searching
//!
//! 4. **Error handling in Rust**: https://doc.rust-lang.org/book/ch09-00-error-handling.html
//!    - `Result<T, E>` type for recoverable errors
//!    - `?` operator for error propagation
//!    - `map_err()` for transforming error types

use crate::errors::{FsError, FsResult};
use ignore::WalkBuilder;
use solo_protocol::FileTreeEntry;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};
use tracing::debug;

/// Read a directory and return its contents as FileTreeEntry structures.
///
/// # How this works:
/// 1. Validate the path exists and is a directory
/// 2. Extract the directory name from the path
/// 3. If depth > 0, recursively read children
/// 4. Return a FileTreeEntry struct with all the info
///
/// # Why depth parameter?
/// - Prevents loading entire file trees at once (could be millions of files)
/// - Enables "lazy loading" - only load what user expands
/// - depth=1 means "load this dir + immediate children names only"
///
/// # Arguments
/// * `path` - Path to the directory to read
/// * `depth` - How deep to recurse (0 = no children, 1 = immediate children only)
///
/// # Returns
/// A FileTreeEntry with children populated up to the specified depth
pub fn read_directory(path: &Path, depth: u32) -> FsResult<FileTreeEntry> {
    // WHY: Early return pattern - fail fast if path is invalid
    // DOCS: https://doc.rust-lang.org/std/path/struct.Path.html#method.exists
    if !path.exists() {
        return Err(FsError::NotFound(path.display().to_string()));
    }

    // WHY: Ensure we're reading a directory, not a file
    // DOCS: https://doc.rust-lang.org/std/path/struct.Path.html#method.is_dir
    if !path.is_dir() {
        return Err(FsError::NotADirectory(path.display().to_string()));
    }

    // WHY: Extract just the folder name (e.g., "/Users/foo/bar" -> "bar")
    // DOCS: https://doc.rust-lang.org/std/path/struct.Path.html#method.file_name
    // The `file_name()` returns Option<&OsStr>, so we need to handle None case
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());

    let path_str = path.display().to_string();

    // WHY: Logging helps debug issues in production
    // DOCS: https://docs.rs/tracing/latest/tracing/
    debug!(path = %path_str, depth, "Reading directory");

    // WHY: Only load children if depth allows - this is the "lazy loading" part
    // If depth=0, children=None signals "not loaded yet" to the frontend
    let children = if depth > 0 {
        Some(read_directory_children(path, depth - 1)?)
    } else {
        None
    };

    // WHY: Return a struct that can be serialized to JSON for the frontend
    // DOCS: See solo_protocol crate for FileTreeEntry definition
    Ok(FileTreeEntry {
        name,
        path: path_str,
        is_dir: true,
        children,
        size: None,     // Directories don't have a meaningful "size"
        modified: None, // Could add this if needed
    })
}

/// Read the children of a directory
///
/// # How this works:
/// 1. Call fs::read_dir() to get an iterator of directory entries
/// 2. For each entry, get metadata (is_dir, size, modified)
/// 3. If it's a directory and we have depth remaining, recurse
/// 4. Sort results: directories first, then alphabetically
///
/// # Why separate function?
/// - Keeps code modular and testable
/// - Recursive function needs to be separate for clarity
fn read_directory_children(path: &Path, remaining_depth: u32) -> FsResult<Vec<FileTreeEntry>> {
    // WHY: read_dir returns an iterator, not a vector
    // This is memory-efficient for large directories
    // DOCS: https://doc.rust-lang.org/std/fs/fn.read_dir.html
    let entries =
        fs::read_dir(path).map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;

    let mut children: Vec<FileTreeEntry> = Vec::new();

    for entry in entries {
        // WHY: Each entry in the iterator is a Result, so we need to handle errors
        // This handles cases like permission denied on individual files
        let entry = entry.map_err(FsError::Io)?;
        let entry_path = entry.path();

        // WHY: metadata() gives us file type, size, and modification time
        // DOCS: https://doc.rust-lang.org/std/fs/struct.Metadata.html
        let metadata = entry.metadata().map_err(FsError::Io)?;

        // WHY: OsStr -> String conversion needed for JSON serialization
        // to_string_lossy() replaces invalid UTF-8 with replacement characters
        let name = entry.file_name().to_string_lossy().to_string();

        let path_str = entry_path.display().to_string();
        let is_dir = metadata.is_dir();

        // WHY: Recursive call for subdirectories, but only if depth allows
        // This prevents infinite recursion and allows lazy loading
        let entry_children = if is_dir && remaining_depth > 0 {
            // WHY: Use match instead of ? to gracefully handle permission errors
            // We don't want one unreadable folder to fail the entire operation
            match read_directory_children(&entry_path, remaining_depth - 1) {
                Ok(c) => Some(c),
                Err(e) => {
                    // Log but continue - graceful degradation
                    debug!(path = %path_str, error = %e, "Failed to read directory children");
                    None
                }
            }
        } else if is_dir {
            // Directory but no depth remaining - mark as "not loaded yet"
            // Frontend will see children=None and know to load on expand
            None
        } else {
            // Files don't have children
            None
        };

        // WHY: Only get size/modified for files, not directories
        // Directory "size" is meaningless (would need to sum all contents)
        let (size, modified) = if !is_dir {
            let size = Some(metadata.len());
            // WHY: Convert SystemTime to Unix timestamp for JSON serialization
            // DOCS: https://doc.rust-lang.org/std/time/struct.SystemTime.html
            let modified = metadata
                .modified()
                .ok() // Ignore errors (not all filesystems support this)
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());
            (size, modified)
        } else {
            (None, None)
        };

        children.push(FileTreeEntry {
            name,
            path: path_str,
            is_dir,
            children: entry_children,
            size,
            modified,
        });
    }

    // WHY: Sort for consistent display - directories first, then alphabetical
    // This matches what users expect from file explorers (Finder, VS Code, etc.)
    // DOCS: https://doc.rust-lang.org/std/vec/struct.Vec.html#method.sort_by
    children.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less, // dirs before files
            (false, true) => std::cmp::Ordering::Greater, // files after dirs
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()), // alphabetical
        }
    });

    Ok(children)
}

/// Get file metadata (size and modified time)
pub fn get_file_metadata(path: &Path) -> FsResult<FileMetadata> {
    let metadata =
        fs::metadata(path).map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    Ok(FileMetadata {
        size: metadata.len(),
        is_dir: metadata.is_dir(),
        is_file: metadata.is_file(),
        modified,
    })
}

/// File metadata structure
#[derive(Debug, Clone)]
pub struct FileMetadata {
    /// File size in bytes
    pub size: u64,
    /// Whether this is a directory
    pub is_dir: bool,
    /// Whether this is a regular file
    pub is_file: bool,
    /// Last modified time (Unix timestamp)
    pub modified: Option<u64>,
}

// =============================================================================
// ROBUST FILE COUNTING IMPLEMENTATION
// =============================================================================
//
// This implementation uses the `ignore` crate (same as ripgrep) to provide:
// 1. Parallel directory walking (uses all CPU cores)
// 2. Automatic .gitignore support
// 3. Configurable timeout to prevent blocking
// 4. Configurable max count to prevent counting millions of files
//
// DOCS:
// - ignore crate: https://docs.rs/ignore/latest/ignore/
// - Atomics: https://doc.rust-lang.org/std/sync/atomic/
// =============================================================================

/// Configuration for counting directory entries.
///
/// # Why use a config struct?
/// - Easier to add new options without breaking existing code
/// - Self-documenting with sensible defaults
/// - Can be reused across different counting scenarios
///
/// # Example
/// ```ignore
/// let config = CountConfig {
///     max_count: 50_000,
///     timeout: Duration::from_millis(200),
///     respect_gitignore: true,
/// };
/// let result = count_entries_with_config(path, &config)?;
/// ```
#[derive(Debug, Clone)]
pub struct CountConfig {
    /// Maximum number of entries to count before stopping.
    /// This prevents counting millions of files in huge directories.
    /// Default: 100,000
    pub max_count: u32,

    /// Maximum time to spend counting before stopping.
    /// This prevents blocking the UI for too long.
    /// Default: 500ms
    pub timeout: Duration,

    /// Whether to respect .gitignore files.
    /// When true, files in .gitignore, .git/info/exclude, and global gitignore are skipped.
    /// Default: true
    pub respect_gitignore: bool,

    /// Whether to include hidden files (starting with .) in the count.
    /// Default: true (count hidden files)
    pub include_hidden: bool,
}

impl Default for CountConfig {
    fn default() -> Self {
        Self {
            max_count: 100_000,
            timeout: Duration::from_millis(500),
            respect_gitignore: true,
            include_hidden: true,
        }
    }
}

impl CountConfig {
    /// Create a config optimized for quick UI feedback.
    /// Lower limits for faster response.
    pub fn quick() -> Self {
        Self {
            max_count: 10_000,
            timeout: Duration::from_millis(100),
            respect_gitignore: true,
            include_hidden: true,
        }
    }

    /// Create a config for thorough counting.
    /// Higher limits for more accurate counts.
    pub fn thorough() -> Self {
        Self {
            max_count: 1_000_000,
            timeout: Duration::from_secs(5),
            respect_gitignore: true,
            include_hidden: true,
        }
    }
}

/// Result of counting directory entries.
///
/// # Why return more than just a count?
/// - The caller needs to know if the count is exact or truncated
/// - The truncation reason helps the UI show appropriate messages
/// - Enables the UI to show "10,000+" instead of just "10000"
#[derive(Debug, Clone)]
pub struct CountResult {
    /// The number of entries counted.
    pub count: u32,

    /// Whether the count is exact or was truncated.
    /// `false` if we hit max_count or timeout.
    pub is_exact: bool,

    /// Reason for truncation, if any.
    /// Examples: "Exceeded 100000 entries", "Timeout after 500ms"
    pub truncation_reason: Option<String>,
}

impl CountResult {
    /// Get a display string for the count, showing "+" if truncated.
    /// Example: "1234" or "10000+"
    pub fn display(&self) -> String {
        if self.is_exact {
            self.count.to_string()
        } else {
            format!("{}+", self.count)
        }
    }
}

/// Count entries in a directory with configurable limits and gitignore support.
///
/// Uses the `ignore` crate for parallel walking with automatic .gitignore support.
/// This is the same library used by ripgrep, so it's well-tested and fast.
///
/// # How it works
/// 1. Creates a parallel walker using all available CPU cores
/// 2. Each thread increments an atomic counter
/// 3. Checks for max_count and timeout limits after each entry
/// 4. Signals all threads to stop if a limit is reached
///
/// # Arguments
/// * `path` - The directory to count entries in
/// * `config` - Configuration for counting behavior
///
/// # Returns
/// A `CountResult` with the count and whether it's exact or truncated.
///
/// # Example
/// ```ignore
/// let result = count_entries_with_config(Path::new("."), &CountConfig::default())?;
/// println!("Found {} files", result.display()); // "1234" or "10000+"
/// ```
pub fn count_entries_with_config(path: &Path, config: &CountConfig) -> FsResult<CountResult> {
    // Record start time for timeout checking
    let start = Instant::now();

    // Atomic counter for thread-safe counting
    // WHY: AtomicU32 allows multiple threads to increment without locks
    // Ordering::Relaxed is sufficient because we don't need ordering guarantees,
    // just atomic increments
    let count = AtomicU32::new(0);

    // Track if we were truncated and why
    let was_truncated = AtomicBool::new(false);
    let hit_max_count = AtomicBool::new(false);
    let hit_timeout = AtomicBool::new(false);

    // Build the parallel walker
    // WHY: WalkBuilder provides all the configuration options
    // build_parallel() creates a walker that uses all CPU cores
    let walker = WalkBuilder::new(path)
        .hidden(!config.include_hidden) // hidden(true) = skip hidden files
        .git_ignore(config.respect_gitignore)
        .git_global(config.respect_gitignore)
        .git_exclude(config.respect_gitignore)
        .build_parallel();

    // Clone config values for use in the closure
    let max_count = config.max_count;
    let timeout = config.timeout;

    // Run the parallel walker
    // WHY: run() takes a factory closure that returns a visitor closure
    // This is because each thread needs its own visitor instance
    walker.run(|| {
        // Each thread gets its own references to the shared atomics
        let count_ref = &count;
        let was_truncated_ref = &was_truncated;
        let hit_max_count_ref = &hit_max_count;
        let hit_timeout_ref = &hit_timeout;

        Box::new(move |entry_result| {
            // Only count successful entries
            if entry_result.is_ok() {
                // Increment counter and get previous value
                // fetch_add returns the old value, so we add 1 to get current count
                let current = count_ref.fetch_add(1, Ordering::Relaxed) + 1;

                // Check max_count limit
                if current >= max_count {
                    was_truncated_ref.store(true, Ordering::Relaxed);
                    hit_max_count_ref.store(true, Ordering::Relaxed);
                    return ignore::WalkState::Quit;
                }

                // Check timeout limit
                // WHY: Instant::elapsed() is monotonic, immune to system clock changes
                if start.elapsed() > timeout {
                    was_truncated_ref.store(true, Ordering::Relaxed);
                    hit_timeout_ref.store(true, Ordering::Relaxed);
                    return ignore::WalkState::Quit;
                }
            }

            ignore::WalkState::Continue
        })
    });

    // Build the result
    let final_count = count.load(Ordering::Relaxed);
    let is_exact = !was_truncated.load(Ordering::Relaxed);

    let truncation_reason = if hit_max_count.load(Ordering::Relaxed) {
        Some(format!("Exceeded {} entries", max_count))
    } else if hit_timeout.load(Ordering::Relaxed) {
        Some(format!("Timeout after {}ms", timeout.as_millis()))
    } else {
        None
    };

    Ok(CountResult {
        count: final_count,
        is_exact,
        truncation_reason,
    })
}

/// Count total files in a directory (for progress indication).
///
/// This is a convenience wrapper around `count_entries_with_config`
/// that uses default configuration. For more control, use
/// `count_entries_with_config` directly.
///
/// # Features
/// - Parallel counting using all CPU cores
/// - Respects .gitignore files (skips node_modules, .git, etc.)
/// - Stops after 100,000 entries or 500ms timeout
/// - Never blocks the UI for long
///
/// # Arguments
/// * `path` - The directory to count entries in
///
/// # Returns
/// The number of entries (may be truncated for large directories)
pub fn count_entries(path: &Path) -> FsResult<u32> {
    let result = count_entries_with_config(path, &CountConfig::default())?;
    Ok(result.count)
}

/// Count entries with result details (for when you need to know if truncated).
///
/// Same as `count_entries` but returns the full `CountResult` with truncation info.
pub fn count_entries_detailed(path: &Path) -> FsResult<CountResult> {
    count_entries_with_config(path, &CountConfig::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_read_directory_empty() {
        let temp = TempDir::new().unwrap();
        let entry = read_directory(temp.path(), 1).unwrap();

        assert!(entry.is_dir);
        assert!(entry.children.unwrap().is_empty());
    }

    #[test]
    fn test_read_directory_with_files() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file1.txt"), "content").unwrap();
        fs::write(temp.path().join("file2.txt"), "content").unwrap();
        fs::create_dir(temp.path().join("subdir")).unwrap();

        let entry = read_directory(temp.path(), 1).unwrap();
        let children = entry.children.unwrap();

        assert_eq!(children.len(), 3);
        // Directories should come first
        assert!(children[0].is_dir);
        assert_eq!(children[0].name, "subdir");
    }

    #[test]
    fn test_read_directory_sorting() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("zebra.txt"), "").unwrap();
        fs::write(temp.path().join("apple.txt"), "").unwrap();
        fs::create_dir(temp.path().join("beta")).unwrap();
        fs::create_dir(temp.path().join("alpha")).unwrap();

        let entry = read_directory(temp.path(), 1).unwrap();
        let children = entry.children.unwrap();

        // Directories first (alphabetically), then files (alphabetically)
        assert_eq!(children[0].name, "alpha");
        assert_eq!(children[1].name, "beta");
        assert_eq!(children[2].name, "apple.txt");
        assert_eq!(children[3].name, "zebra.txt");
    }

    #[test]
    fn test_read_directory_depth_zero() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file.txt"), "content").unwrap();

        let entry = read_directory(temp.path(), 0).unwrap();

        // Children should be None when depth is 0
        assert!(entry.children.is_none());
    }

    #[test]
    fn test_read_nonexistent_directory() {
        let result = read_directory(Path::new("/nonexistent/path"), 1);
        assert!(matches!(result, Err(FsError::NotFound(_))));
    }

    #[test]
    fn test_file_metadata() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        fs::write(&file_path, "hello world").unwrap();

        let metadata = get_file_metadata(&file_path).unwrap();

        assert_eq!(metadata.size, 11); // "hello world" is 11 bytes
        assert!(metadata.is_file);
        assert!(!metadata.is_dir);
    }

    // =============================================================================
    // Tests for count_entries_with_config
    // =============================================================================

    #[test]
    fn test_count_entries_basic() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file1.txt"), "content").unwrap();
        fs::write(temp.path().join("file2.txt"), "content").unwrap();
        fs::create_dir(temp.path().join("subdir")).unwrap();
        fs::write(temp.path().join("subdir/file3.txt"), "content").unwrap();

        let result = count_entries(temp.path()).unwrap();

        // Should count: file1.txt, file2.txt, subdir, subdir/file3.txt = 4
        // Note: count may include the root directory depending on implementation
        assert!(result >= 3, "Expected at least 3 entries, got {}", result);
    }

    #[test]
    fn test_count_entries_respects_max_count() {
        let temp = TempDir::new().unwrap();

        // Create 100 files
        for i in 0..100 {
            fs::write(temp.path().join(format!("file{}.txt", i)), "content").unwrap();
        }

        // Count with max_count of 50
        let config = CountConfig {
            max_count: 50,
            timeout: Duration::from_secs(10),
            respect_gitignore: false,
            include_hidden: true,
        };

        let result = count_entries_with_config(temp.path(), &config).unwrap();

        // Should stop at or near 50
        assert!(
            result.count <= 51,
            "Expected ~50 entries, got {}",
            result.count
        );
        assert!(!result.is_exact, "Expected is_exact to be false");
        assert!(
            result.truncation_reason.is_some(),
            "Expected truncation reason"
        );
    }

    #[test]
    fn test_count_entries_respects_gitignore() {
        let temp = TempDir::new().unwrap();

        // Create a minimal .git directory - required for ignore crate to recognize .gitignore
        fs::create_dir(temp.path().join(".git")).unwrap();

        // Create .gitignore
        fs::write(temp.path().join(".gitignore"), "ignored/\n").unwrap();

        // Create some regular files
        fs::write(temp.path().join("included.txt"), "content").unwrap();

        // Create ignored directory with files
        fs::create_dir(temp.path().join("ignored")).unwrap();
        fs::write(temp.path().join("ignored/file1.txt"), "content").unwrap();
        fs::write(temp.path().join("ignored/file2.txt"), "content").unwrap();

        // Count with gitignore respected
        let config_with_gitignore = CountConfig {
            respect_gitignore: true,
            ..CountConfig::default()
        };
        let result_with = count_entries_with_config(temp.path(), &config_with_gitignore).unwrap();

        // Count without gitignore
        let config_without_gitignore = CountConfig {
            respect_gitignore: false,
            ..CountConfig::default()
        };
        let result_without =
            count_entries_with_config(temp.path(), &config_without_gitignore).unwrap();

        // The count without gitignore should be higher (includes ignored/ and its contents)
        assert!(
            result_without.count > result_with.count,
            "Expected count without gitignore ({}) > count with gitignore ({})",
            result_without.count,
            result_with.count
        );
    }

    #[test]
    fn test_count_entries_display() {
        // Test exact count display
        let exact = CountResult {
            count: 1234,
            is_exact: true,
            truncation_reason: None,
        };
        assert_eq!(exact.display(), "1234");

        // Test truncated count display
        let truncated = CountResult {
            count: 10000,
            is_exact: false,
            truncation_reason: Some("Exceeded 10000 entries".to_string()),
        };
        assert_eq!(truncated.display(), "10000+");
    }

    #[test]
    fn test_count_config_presets() {
        let quick = CountConfig::quick();
        assert_eq!(quick.max_count, 10_000);
        assert_eq!(quick.timeout, Duration::from_millis(100));

        let thorough = CountConfig::thorough();
        assert_eq!(thorough.max_count, 1_000_000);
        assert_eq!(thorough.timeout, Duration::from_secs(5));
    }

    #[test]
    fn test_count_entries_empty_directory() {
        let temp = TempDir::new().unwrap();

        let result = count_entries_with_config(temp.path(), &CountConfig::default()).unwrap();

        // Empty directory should have count of 0 or 1 (depending on whether root is counted)
        assert!(
            result.count <= 1,
            "Expected 0 or 1 for empty dir, got {}",
            result.count
        );
        assert!(result.is_exact, "Expected exact count for empty directory");
    }

    #[test]
    fn test_count_entries_detailed() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("file.txt"), "content").unwrap();

        let result = count_entries_detailed(temp.path()).unwrap();

        assert!(result.count >= 1);
        assert!(result.is_exact);
        assert!(result.truncation_reason.is_none());
    }
}
