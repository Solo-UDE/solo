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

pub mod context;
pub mod deny_list;
pub mod error;
pub mod schedule_preview;
pub mod scheduler;
pub mod store;

pub use context::{ContextFragment, render_prompt, trim_to_budget, DEFAULT_BUNDLE, DEFAULT_TOKEN_BUDGET};
pub use deny_list::{is_denied, DEFAULT_DENY_LIST};
pub use error::{TaskError, TaskResult};
pub use schedule_preview::next_fires;
pub use scheduler::{Scheduler, FireOrder};
pub use store::TaskStore;
