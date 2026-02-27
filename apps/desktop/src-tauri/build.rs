fn main() {
    // Embed Info.plist into the Mach-O binary so macOS TCC can read
    // NSMicrophoneUsageDescription even when running unbundled (cargo tauri dev).
    #[cfg(target_os = "macos")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
        let plist_path = std::path::Path::new(&manifest_dir).join("Info.plist");
        println!(
            "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist_path.display()
        );
    }

    tauri_build::build()
}
