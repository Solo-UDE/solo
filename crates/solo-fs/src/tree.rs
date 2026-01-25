//! Directory tree building with lazy loading support

use crate::errors::{FsError, FsResult};
use solo_protocol::FileTreeEntry;
use std::fs;
use std::path::Path;
use tracing::debug;

/// Read a directory and return its contents as FileTreeEntry structures.
///
/// # Arguments
/// * `path` - Path to the directory to read
/// * `depth` - How deep to recurse (0 = no children, 1 = immediate children only)
///
/// # Returns
/// A FileTreeEntry with children populated up to the specified depth
pub fn read_directory(path: &Path, depth: u32) -> FsResult<FileTreeEntry> {
    if !path.exists() {
        return Err(FsError::NotFound(path.display().to_string()));
    }

    if !path.is_dir() {
        return Err(FsError::NotADirectory(path.display().to_string()));
    }

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string());

    let path_str = path.display().to_string();

    debug!(path = %path_str, depth, "Reading directory");

    let children = if depth > 0 {
        Some(read_directory_children(path, depth - 1)?)
    } else {
        None
    };

    Ok(FileTreeEntry {
        name,
        path: path_str,
        is_dir: true,
        children,
        size: None,
        modified: None,
    })
}

/// Read the children of a directory
fn read_directory_children(path: &Path, remaining_depth: u32) -> FsResult<Vec<FileTreeEntry>> {
    let entries = fs::read_dir(path).map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;

    let mut children: Vec<FileTreeEntry> = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| FsError::Io(e))?;
        let entry_path = entry.path();
        let metadata = entry.metadata().map_err(|e| FsError::Io(e))?;

        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let path_str = entry_path.display().to_string();
        let is_dir = metadata.is_dir();

        // For directories, recursively read children if we have remaining depth
        let entry_children = if is_dir && remaining_depth > 0 {
            match read_directory_children(&entry_path, remaining_depth - 1) {
                Ok(c) => Some(c),
                Err(e) => {
                    // Log permission errors but continue
                    debug!(path = %path_str, error = %e, "Failed to read directory children");
                    None
                }
            }
        } else if is_dir {
            // Directory but no depth remaining - mark as not loaded
            None
        } else {
            // File - no children
            None
        };

        // Get file metadata for size and modified time
        let (size, modified) = if !is_dir {
            let size = Some(metadata.len());
            let modified = metadata
                .modified()
                .ok()
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

    // Sort: directories first, then alphabetically by name (case-insensitive)
    children.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(children)
}

/// Get file metadata (size and modified time)
pub fn get_file_metadata(path: &Path) -> FsResult<FileMetadata> {
    let metadata = fs::metadata(path)
        .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;

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

/// Count total files in a directory (for progress indication)
pub fn count_entries(path: &Path) -> FsResult<u32> {
    let mut count = 0u32;

    for _entry in walkdir::WalkDir::new(path)
        .min_depth(1)
        .max_depth(10) // Limit depth for performance
        .into_iter()
        .filter_map(|e| e.ok())
    {
        count = count.saturating_add(1);
    }

    Ok(count)
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
}
