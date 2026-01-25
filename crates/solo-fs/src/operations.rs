//! File system CRUD operations for Solo IDE

use crate::errors::{FsError, FsResult};
use std::fs;
use std::path::Path;
use tracing::{debug, info};

/// Validate that a path is within a workspace root to prevent path traversal attacks.
///
/// # Arguments
/// * `path` - The path to validate
/// * `workspace_root` - The workspace root directory
///
/// # Returns
/// The canonicalized path if valid
pub fn validate_path(path: &Path, workspace_root: &Path) -> FsResult<std::path::PathBuf> {
    // Get the canonical workspace root
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| FsError::from_io_error(e, &workspace_root.display().to_string()))?;

    // Try to canonicalize the path. If the file doesn't exist yet,
    // canonicalize the parent directory and append the filename
    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?
    } else {
        // For new files, canonicalize the parent and append the filename
        let parent = path.parent().ok_or_else(|| {
            FsError::InvalidPath("Path has no parent directory".to_string())
        })?;

        let parent_canonical = parent
            .canonicalize()
            .map_err(|e| FsError::from_io_error(e, &parent.display().to_string()))?;

        let filename = path.file_name().ok_or_else(|| {
            FsError::InvalidPath("Path has no filename".to_string())
        })?;

        parent_canonical.join(filename)
    };

    // Ensure the path is within the workspace root
    if !canonical.starts_with(&canonical_root) {
        return Err(FsError::PathOutsideWorkspace(path.display().to_string()));
    }

    Ok(canonical)
}

/// Validate a filename to prevent security issues
pub fn validate_filename(name: &str) -> FsResult<()> {
    // No empty names
    if name.is_empty() {
        return Err(FsError::InvalidPath("Filename cannot be empty".to_string()));
    }

    // No path separators
    if name.contains('/') || name.contains('\\') {
        return Err(FsError::InvalidPath(
            "Filename cannot contain path separators".to_string(),
        ));
    }

    // No null bytes
    if name.contains('\0') {
        return Err(FsError::InvalidPath(
            "Filename cannot contain null bytes".to_string(),
        ));
    }

    // No leading/trailing whitespace
    if name != name.trim() {
        return Err(FsError::InvalidPath(
            "Filename cannot have leading or trailing whitespace".to_string(),
        ));
    }

    // No reserved names (Windows compatibility)
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let name_upper = name.to_uppercase();
    let name_without_ext = name_upper.split('.').next().unwrap_or("");
    if reserved.contains(&name_without_ext) {
        return Err(FsError::InvalidPath(format!(
            "Filename '{}' is reserved",
            name
        )));
    }

    Ok(())
}

/// Create a new file with optional content
///
/// # Arguments
/// * `path` - Path where to create the file
/// * `content` - Optional initial content
/// * `workspace_root` - Workspace root for path validation
pub fn create_file(path: &Path, content: Option<&str>, workspace_root: &Path) -> FsResult<()> {
    let validated_path = validate_path(path, workspace_root)?;

    if validated_path.exists() {
        return Err(FsError::AlreadyExists(path.display().to_string()));
    }

    // Validate the filename
    if let Some(name) = path.file_name() {
        validate_filename(&name.to_string_lossy())?;
    }

    info!(path = %validated_path.display(), "Creating file");

    // Create parent directories if needed
    if let Some(parent) = validated_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| FsError::from_io_error(e, &parent.display().to_string()))?;
    }

    fs::write(&validated_path, content.unwrap_or(""))
        .map_err(|e| FsError::from_io_error(e, &validated_path.display().to_string()))?;

    Ok(())
}

/// Create a new directory
///
/// # Arguments
/// * `path` - Path where to create the directory
/// * `workspace_root` - Workspace root for path validation
pub fn create_directory(path: &Path, workspace_root: &Path) -> FsResult<()> {
    // For new directories, validate the parent path
    let parent = path.parent().ok_or_else(|| {
        FsError::InvalidPath("Path has no parent directory".to_string())
    })?;

    // Validate parent exists and is within workspace
    let _ = validate_path(parent, workspace_root)?;

    if path.exists() {
        return Err(FsError::AlreadyExists(path.display().to_string()));
    }

    // Validate the directory name
    if let Some(name) = path.file_name() {
        validate_filename(&name.to_string_lossy())?;
    }

    info!(path = %path.display(), "Creating directory");

    fs::create_dir_all(path)
        .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;

    Ok(())
}

/// Rename or move a file or directory
///
/// # Arguments
/// * `old_path` - Current path
/// * `new_path` - New path
/// * `workspace_root` - Workspace root for path validation
pub fn rename(old_path: &Path, new_path: &Path, workspace_root: &Path) -> FsResult<()> {
    let validated_old = validate_path(old_path, workspace_root)?;
    let validated_new = validate_path(new_path, workspace_root)?;

    if !validated_old.exists() {
        return Err(FsError::NotFound(old_path.display().to_string()));
    }

    if validated_new.exists() {
        return Err(FsError::AlreadyExists(new_path.display().to_string()));
    }

    // Validate the new filename
    if let Some(name) = new_path.file_name() {
        validate_filename(&name.to_string_lossy())?;
    }

    info!(
        old_path = %validated_old.display(),
        new_path = %validated_new.display(),
        "Renaming"
    );

    // Create parent directories for new path if needed
    if let Some(parent) = validated_new.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| FsError::from_io_error(e, &parent.display().to_string()))?;
    }

    fs::rename(&validated_old, &validated_new)
        .map_err(|e| FsError::from_io_error(e, &old_path.display().to_string()))?;

    Ok(())
}

/// Delete a file or directory
///
/// # Arguments
/// * `path` - Path to delete
/// * `recursive` - Whether to recursively delete directories
/// * `workspace_root` - Workspace root for path validation
pub fn delete(path: &Path, recursive: bool, workspace_root: &Path) -> FsResult<()> {
    let validated_path = validate_path(path, workspace_root)?;

    if !validated_path.exists() {
        return Err(FsError::NotFound(path.display().to_string()));
    }

    info!(path = %validated_path.display(), recursive, "Deleting");

    if validated_path.is_dir() {
        if recursive {
            fs::remove_dir_all(&validated_path)
                .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;
        } else {
            fs::remove_dir(&validated_path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::Other {
                    // Directory not empty
                    FsError::DirectoryNotEmpty(path.display().to_string())
                } else {
                    FsError::from_io_error(e, &path.display().to_string())
                }
            })?;
        }
    } else {
        fs::remove_file(&validated_path)
            .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))?;
    }

    Ok(())
}

/// Read file contents
///
/// # Arguments
/// * `path` - Path to the file
/// * `workspace_root` - Workspace root for path validation
pub fn read_file(path: &Path, workspace_root: &Path) -> FsResult<String> {
    let validated_path = validate_path(path, workspace_root)?;

    if !validated_path.exists() {
        return Err(FsError::NotFound(path.display().to_string()));
    }

    if validated_path.is_dir() {
        return Err(FsError::NotAFile(path.display().to_string()));
    }

    debug!(path = %validated_path.display(), "Reading file");

    fs::read_to_string(&validated_path)
        .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))
}

/// Write file contents
///
/// # Arguments
/// * `path` - Path to the file
/// * `content` - Content to write
/// * `workspace_root` - Workspace root for path validation
pub fn write_file(path: &Path, content: &str, workspace_root: &Path) -> FsResult<()> {
    let validated_path = validate_path(path, workspace_root)?;

    if validated_path.is_dir() {
        return Err(FsError::NotAFile(path.display().to_string()));
    }

    debug!(path = %validated_path.display(), "Writing file");

    // Create parent directories if needed
    if let Some(parent) = validated_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| FsError::from_io_error(e, &parent.display().to_string()))?;
    }

    fs::write(&validated_path, content)
        .map_err(|e| FsError::from_io_error(e, &path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_validate_filename() {
        assert!(validate_filename("valid.txt").is_ok());
        assert!(validate_filename("my-file_name.rs").is_ok());
        assert!(validate_filename("").is_err());
        assert!(validate_filename("path/to/file").is_err());
        assert!(validate_filename("file\0name").is_err());
        assert!(validate_filename(" leading").is_err());
        assert!(validate_filename("trailing ").is_err());
        assert!(validate_filename("CON").is_err());
        assert!(validate_filename("CON.txt").is_err());
    }

    #[test]
    fn test_create_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");

        create_file(&file_path, Some("hello"), temp.path()).unwrap();

        assert!(file_path.exists());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "hello");
    }

    #[test]
    fn test_create_file_already_exists() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        fs::write(&file_path, "existing").unwrap();

        let result = create_file(&file_path, Some("new"), temp.path());
        assert!(matches!(result, Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn test_create_directory() {
        let temp = TempDir::new().unwrap();
        let dir_path = temp.path().join("new_dir");

        create_directory(&dir_path, temp.path()).unwrap();

        assert!(dir_path.is_dir());
    }

    #[test]
    fn test_rename() {
        let temp = TempDir::new().unwrap();
        let old_path = temp.path().join("old.txt");
        let new_path = temp.path().join("new.txt");
        fs::write(&old_path, "content").unwrap();

        rename(&old_path, &new_path, temp.path()).unwrap();

        assert!(!old_path.exists());
        assert!(new_path.exists());
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "content");
    }

    #[test]
    fn test_delete_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");
        fs::write(&file_path, "content").unwrap();

        delete(&file_path, false, temp.path()).unwrap();

        assert!(!file_path.exists());
    }

    #[test]
    fn test_delete_directory_recursive() {
        let temp = TempDir::new().unwrap();
        let dir_path = temp.path().join("dir");
        fs::create_dir(&dir_path).unwrap();
        fs::write(dir_path.join("file.txt"), "content").unwrap();

        delete(&dir_path, true, temp.path()).unwrap();

        assert!(!dir_path.exists());
    }

    #[test]
    fn test_path_traversal_blocked() {
        let temp = TempDir::new().unwrap();

        // Create a subdirectory to use as workspace root
        let workspace = temp.path().join("workspace");
        fs::create_dir(&workspace).unwrap();

        // Try to access a file outside the workspace via path traversal
        let malicious_path = workspace.join("..").join("outside.txt");

        // Create the file outside workspace to ensure it exists for canonicalization
        fs::write(temp.path().join("outside.txt"), "secret").unwrap();

        let result = validate_path(&malicious_path, &workspace);
        assert!(matches!(result, Err(FsError::PathOutsideWorkspace(_))),
            "Expected PathOutsideWorkspace error, got {:?}", result);
    }

    #[test]
    fn test_read_write_file() {
        let temp = TempDir::new().unwrap();
        let file_path = temp.path().join("test.txt");

        write_file(&file_path, "hello world", temp.path()).unwrap();
        let content = read_file(&file_path, temp.path()).unwrap();

        assert_eq!(content, "hello world");
    }
}
