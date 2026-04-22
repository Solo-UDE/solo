//! SQLite-backed task store. Implementation lands in Task 4.

use std::path::PathBuf;
use crate::error::TaskResult;

pub struct TaskStore {
    _db_path: PathBuf,
}

impl TaskStore {
    pub fn open(_db_path: PathBuf) -> TaskResult<Self> {
        unimplemented!("implemented in Task 4")
    }
}
