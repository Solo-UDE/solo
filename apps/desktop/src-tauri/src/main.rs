//! Solo IDE - Main entry point
//!
//! This is the Tauri application entry point that delegates to the
//! library crate for all setup and configuration.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    solo_desktop_lib::run();
}
