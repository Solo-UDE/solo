//! Absolute-path newtype and safe-relative-path resolver.
//!
//! Minimal subset of codex-rs/utils/absolute-path/src/lib.rs — Solo does not
//! need tilde expansion, a deserialize guard, or `dunce` canonicalization at
//! the foundation layer.

use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AbsolutePathBuf(PathBuf);

impl AbsolutePathBuf {
    /// Returns `Err(std::io::Error)` if `path` is not already absolute.
    pub fn try_from_absolute<P: AsRef<Path>>(path: P) -> std::io::Result<Self> {
        let p = path.as_ref();
        if !p.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("path is not absolute: {}", p.display()),
            ));
        }
        Ok(Self(p.to_path_buf()))
    }

    pub fn as_path(&self) -> &Path {
        &self.0
    }

    pub fn into_path_buf(self) -> PathBuf {
        self.0
    }

    pub fn join<P: AsRef<Path>>(&self, rel: P) -> std::io::Result<Self> {
        let joined = self.0.join(rel);
        if !joined.is_absolute() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "join result must remain absolute",
            ));
        }
        Ok(Self(joined))
    }

    pub fn display(&self) -> std::path::Display<'_> {
        self.0.display()
    }
}

impl AsRef<Path> for AbsolutePathBuf {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl TryFrom<PathBuf> for AbsolutePathBuf {
    type Error = std::io::Error;
    fn try_from(value: PathBuf) -> Result<Self, Self::Error> {
        Self::try_from_absolute(value)
    }
}

/// Resolve a manifest-declared relative path (`./foo/bar.png`) inside `root`,
/// rejecting empty paths, paths without the `./` prefix, and any `..` component.
///
/// Equivalent to codex-rs core-plugins/manifest.rs `resolve_manifest_path`,
/// lifted into a shared helper.
pub fn resolve_relative_inside(
    root: &Path,
    raw: &str,
) -> Result<AbsolutePathBuf, RelativePathError> {
    if raw.is_empty() {
        return Err(RelativePathError::Empty);
    }
    let relative = raw
        .strip_prefix("./")
        .ok_or(RelativePathError::MissingDotSlashPrefix)?;
    if relative.is_empty() {
        return Err(RelativePathError::Empty);
    }

    let mut normalized = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(c) => normalized.push(c),
            Component::ParentDir => return Err(RelativePathError::ContainsParentDir),
            _ => return Err(RelativePathError::EscapesRoot),
        }
    }

    let joined = root.join(normalized);
    AbsolutePathBuf::try_from_absolute(joined).map_err(RelativePathError::NotAbsolute)
}

#[derive(Debug, thiserror::Error)]
pub enum RelativePathError {
    #[error("path must not be empty")]
    Empty,
    #[error("path must start with './' relative to plugin root")]
    MissingDotSlashPrefix,
    #[error("path must not contain '..'")]
    ContainsParentDir,
    #[error("path must stay within the plugin root")]
    EscapesRoot,
    #[error("resolved path is not absolute: {0}")]
    NotAbsolute(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn absolute_constructs() {
        let tmp = tempdir().unwrap();
        let abs = AbsolutePathBuf::try_from_absolute(tmp.path()).unwrap();
        assert_eq!(abs.as_path(), tmp.path());
    }

    #[test]
    fn relative_rejected() {
        assert!(AbsolutePathBuf::try_from_absolute("relative/path").is_err());
    }

    #[test]
    fn resolve_relative_inside_ok() {
        let tmp = tempdir().unwrap();
        let out = resolve_relative_inside(tmp.path(), "./assets/logo.png").unwrap();
        assert_eq!(out.as_path(), tmp.path().join("assets/logo.png").as_path());
    }

    #[test]
    fn resolve_rejects_missing_prefix() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "assets/logo.png").unwrap_err();
        assert!(matches!(err, RelativePathError::MissingDotSlashPrefix));
    }

    #[test]
    fn resolve_rejects_parent_traversal() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "./../../etc/passwd").unwrap_err();
        assert!(matches!(err, RelativePathError::ContainsParentDir));
    }

    #[test]
    fn resolve_rejects_empty() {
        let tmp = tempdir().unwrap();
        let err = resolve_relative_inside(tmp.path(), "./").unwrap_err();
        assert!(matches!(err, RelativePathError::Empty));
    }
}
