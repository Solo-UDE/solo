#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc
)]

//! solo-tasks — Task allocator core.
//!
//! Phase 1 ships `store` only (SQLite-backed CRUD + FTS search). Later
//! phases add `context`, `planner`, `scheduler`, `executor`.

pub mod deny_list;
pub mod error;
pub mod store;

pub use deny_list::{is_denied, DEFAULT_DENY_LIST};
pub use error::{TaskError, TaskResult};
pub use store::TaskStore;
