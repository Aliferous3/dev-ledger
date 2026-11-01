use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// OS credential-store identifier. Keys are whitelisted to a narrow pattern
// so the webview can only ever read/write its own desktop-auth entries —
// the store holds nothing else belonging to this app.
const KEYRING_SERVICE: &str = "site.devledger.desktop";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty()
        || key.len() > 64
        || !key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("invalid key".into());
    }
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_set(key: String, value: String) -> Result<(), String> {
    keyring_entry(&key)?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_get(key: String) -> Result<Option<String>, String> {
    match keyring_entry(&key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn keyring_delete(key: String) -> Result<(), String> {
    match keyring_entry(&key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// SHA-256 for the desktop-auth PKCE challenge — computed natively so the
// frontend never depends on crypto.subtle availability inside the webview.
#[tauri::command]
fn sha256_hex(input: String) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

// Only the bundled app origin may navigate inside the webview. On Windows
// the production origin is http(s)://tauri.localhost; everywhere else it is
// tauri://localhost. In debug builds the Vite devUrl origin is allowed too.
// External links never reach this point — the frontend intercepts clicks
// and sends them to the system browser via the opener plugin.
fn is_app_origin(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost") || is_dev_origin(url),
        _ => false,
    }
}

#[cfg(debug_assertions)]
fn is_dev_origin(url: &tauri::Url) -> bool {
    matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
}

#[cfg(not(debug_assertions))]
fn is_dev_origin(_url: &tauri::Url) -> bool {
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux deliver dev-ledger:// URLs by launching a second process.
    // Tauri requires single-instance to be the FIRST registered plugin, with
    // its "deep-link" feature enabled, to forward URLs to the running app.
    // Registering it later in setup() cannot reliably intercept that launch.
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // The plugin's deep-link feature forwards the URL automatically
        // before calling this callback. Do not parse or log credential-bearing
        // URLs from argv; the JS handler performs flow+PKCE validation.
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            keyring_set,
            keyring_get,
            keyring_delete,
            sha256_hex
        ])
        .setup(|app| {
            // The main window is created in code (not tauri.conf.json) so the
            // on_navigation guard can be attached: only bundled-app origins may
            // navigate inside the webview.
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("/".into()))
                .title("Dev Ledger")
                .inner_size(1320.0, 860.0)
                .min_inner_size(960.0, 600.0)
                .resizable(true)
                .fullscreen(false)
                .center()
                .on_navigation(is_app_origin);
            // Reject OS file drops so a dragged file cannot navigate the
            // webview to a file:// URL. The builder method is Windows-only in
            // Tauri 2; other platforms also can't navigate because the guard
            // rejects the file: scheme.
            #[cfg(windows)]
            let builder = builder.drag_and_drop(false);
            builder.build()?;

            // Scheme registration: macOS gets dev-ledger:// from the bundled
            // Info.plist; Windows and Linux register at runtime (AppImage cannot
            // install a system handler, so Linux registration is unconditional).
            #[cfg(target_os = "linux")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            #[cfg(target_os = "windows")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("dev-ledger");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
