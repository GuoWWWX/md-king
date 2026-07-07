fn main() {
    for path in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.ico",
        "tauri.conf.json",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }

    tauri_build::build()
}
