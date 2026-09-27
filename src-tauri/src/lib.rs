use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

mod updater;

use serde_json::Value;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::{Effect, EffectsBuilder},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const WIDGET: &str = "widget";
const SETTINGS: &str = "settings";
const USER_AGENT: &str = concat!("StrifeDelivery/", env!("CARGO_PKG_VERSION"));

/// Menu handles shared by the tray icon and the widget's right-click menu.
struct AppMenu {
    menu: Menu<Wry>,
    lock: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
    update: MenuItem<Wry>,
}

/// "Check for updates…" becomes "Update available (vX)…" once a check finds one.
pub(crate) fn set_update_menu_label(app: &AppHandle, version: Option<&str>) {
    if let Some(menu) = app.try_state::<AppMenu>() {
        let label = match version {
            Some(v) => format!("Update available (v{v})…"),
            None => "Check for updates…".to_string(),
        };
        let _ = menu.update.set_text(label);
    }
}

fn data_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_config_dir()
        .expect("no config directory available");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn state_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("state.json")
}

fn read_state(app: &AppHandle) -> Option<Value> {
    let raw = fs::read_to_string(state_path(app)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_state(app: &AppHandle, state: &Value) -> Result<(), String> {
    let path = state_path(app);
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;

    if let Some(menu) = app.try_state::<AppMenu>() {
        let locked = state
            .get("lockPosition")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let _ = menu.lock.set_checked(locked);
    }
    app.emit("state-changed", state).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn load_state(app: AppHandle) -> Option<Value> {
    read_state(&app)
}

#[tauri::command]
fn save_state(app: AppHandle, state: Value) -> Result<(), String> {
    write_state(&app, &state)
}

async fn steam_get(url: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach Steam: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Steam said no: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("Steam sent something odd: {e}"))
}

#[tauri::command]
async fn steam_search(term: String) -> Result<Value, String> {
    let term: String = term.trim().chars().take(100).collect();
    if term.is_empty() {
        return Ok(Value::Array(vec![]));
    }
    let url = reqwest::Url::parse_with_params(
        "https://store.steampowered.com/api/storesearch/",
        &[("term", term.as_str()), ("cc", "us"), ("l", "en")],
    )
    .map_err(|e| e.to_string())?;
    let body = steam_get(url.as_str()).await?;
    Ok(body.get("items").cloned().unwrap_or(Value::Array(vec![])))
}

#[tauri::command]
async fn steam_details(appid: u64) -> Result<Value, String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={appid}&cc=us&l=en"
    );
    let body = steam_get(&url).await?;
    // Steam doesn't always key the response by the id we asked for (Hollow
    // Knight comes back under one of its DLC ids), so match on steam_appid and
    // fall back to the only entry.
    let entries = body.as_object().ok_or("Steam didn't return that game")?;
    let entry = entries
        .values()
        .find(|e| e.pointer("/data/steam_appid").and_then(Value::as_u64) == Some(appid))
        .or_else(|| (entries.len() == 1).then(|| entries.values().next()).flatten())
        .ok_or("Steam didn't return that game")?;
    if entry.get("success").and_then(Value::as_bool) != Some(true) {
        return Err("Steam doesn't have details for that game (it may be region-locked or delisted)".into());
    }
    let data = entry.get("data").cloned().unwrap_or(Value::Null);
    let screenshots: Vec<Value> = data
        .get("screenshots")
        .and_then(Value::as_array)
        .map(|shots| {
            shots
                .iter()
                .take(12)
                .map(|s| {
                    serde_json::json!({
                        "thumb": s.get("path_thumbnail"),
                        "full": s.get("path_full"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(serde_json::json!({
        "appid": appid,
        "name": data.get("name"),
        "headerImage": data.get("header_image"),
        "capsuleImage": data.get("capsule_image"),
        "background": data.get("background"),
        "backgroundRaw": data.get("background_raw"),
        "screenshots": screenshots,
        "releaseDate": data.get("release_date"),
    }))
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    show_settings(&app);
}

#[tauri::command]
fn show_widget(app: AppHandle) {
    if let Some(w) = app.get_webview_window(WIDGET) {
        let _ = w.show();
        let _ = w.set_always_on_bottom(true);
    }
}

#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn show_context_menu(app: AppHandle, window: WebviewWindow) {
    if let Some(menu) = app.try_state::<AppMenu>() {
        let _ = window.popup_menu(&menu.menu);
    }
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| e.to_string())?;
    if let Some(menu) = app.try_state::<AppMenu>() {
        let _ = menu.autostart.set_checked(enabled);
    }
    let _ = app.emit("autostart-changed", enabled);
    Ok(())
}

// ---------------------------------------------------------------------------
// Windows, tray, menu
// ---------------------------------------------------------------------------

fn show_settings(app: &AppHandle) {
    show_settings_page(app, None, false);
}

/// Open (or focus) the settings window, optionally on a specific page.
/// `check_updates` asks the About page to run an update check when it opens.
fn show_settings_page(app: &AppHandle, page: Option<&str>, check_updates: bool) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if page.is_some() {
            let _ = app.emit_to(
                SETTINGS,
                "open-page",
                serde_json::json!({ "page": page, "check": check_updates }),
            );
        }
        return;
    }
    let backdrop = settings_backdrop();
    let mut url = format!("settings.html?backdrop={}", backdrop.unwrap_or("none"));
    if let Some(page) = page {
        url.push_str(&format!("&page={page}"));
    }
    if check_updates {
        url.push_str("&check=1");
    }
    let mut builder = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App(url.into()))
        .title("Strife Delivery")
        .inner_size(880.0, 640.0)
        .min_inner_size(520.0, 480.0)
        .center();
    if let Some(effect) = backdrop_effect() {
        builder = builder
            .transparent(true)
            .effects(EffectsBuilder::new().effect(effect).build());
    }
    let _ = builder.build();
}

/// Which translucent backdrop the settings window gets, if any: Mica on
/// Windows 11, native vibrancy on macOS, a solid background everywhere else.
fn settings_backdrop() -> Option<&'static str> {
    #[cfg(windows)]
    {
        if windows_version::OsVersion::current().build >= 22000 {
            return Some("mica");
        }
    }
    #[cfg(target_os = "macos")]
    {
        return Some("vibrancy");
    }
    #[allow(unreachable_code)]
    None
}

fn backdrop_effect() -> Option<Effect> {
    match settings_backdrop()? {
        "mica" => Some(Effect::Mica),
        "vibrancy" => Some(Effect::Sidebar),
        _ => None,
    }
}

fn reset_widget_position(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WIDGET) {
        let _ = w.center();
        let _ = w.show();
        let _ = app.save_window_state(StateFlags::POSITION);
    }
}

fn toggle_lock(app: &AppHandle) {
    let mut state = read_state(app).unwrap_or_else(|| serde_json::json!({}));
    let locked = state
        .get("lockPosition")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if let Some(obj) = state.as_object_mut() {
        obj.insert("lockPosition".into(), Value::Bool(!locked));
    }
    let _ = write_state(app, &state);
}

fn build_menu(app: &AppHandle) -> tauri::Result<AppMenu> {
    let manage = MenuItem::with_id(app, "manage", "Manage games…", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next game", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show widget", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset", "Reset widget position", true, None::<&str>)?;
    let locked = read_state(app)
        .and_then(|s| s.get("lockPosition").and_then(Value::as_bool))
        .unwrap_or(false);
    let lock = CheckMenuItem::with_id(app, "lock", "Lock position", true, locked, None::<&str>)?;
    let autostart_on = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start when I log in",
        true,
        autostart_on,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "update", "Check for updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Strife Delivery", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &manage,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &reset,
            &lock,
            &autostart,
            &PredefinedMenuItem::separator(app)?,
            &update,
            &quit,
        ],
    )?;
    Ok(AppMenu {
        menu,
        lock,
        autostart,
        update,
    })
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "manage" => show_settings(app),
        "next" => {
            let _ = app.emit_to(WIDGET, "next-game", ());
        }
        "show" => show_widget(app.clone()),
        "reset" => reset_widget_position(app),
        "lock" => toggle_lock(app),
        "autostart" => {
            let enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let _ = set_autostart(app.clone(), !enabled);
        }
        "update" => {
            // If a background check already found one, just show it; otherwise check now.
            let known = updater::update_status(app.clone());
            show_settings_page(app, Some("about"), known.version().is_none());
        }
        "quit" => {
            let _ = app.save_window_state(StateFlags::POSITION);
            app.exit(0);
        }
        _ => {}
    }
}

/// Enable start-at-login the very first time the app runs. Heather's whole
/// point was "I'd forget to open it", so it should just be there.
fn first_run_setup(app: &AppHandle) {
    let marker = data_dir(app).join(".first-run-done");
    if marker.exists() {
        return;
    }
    let _ = app.autolaunch().enable();
    let _ = fs::write(marker, b"1");
}

/// Save the widget position shortly after it stops moving, so it survives
/// shutdowns/logoffs where the app never gets a clean exit.
fn watch_widget_moves(app: &AppHandle) {
    let Some(widget) = app.get_webview_window(WIDGET) else {
        return;
    };
    let generation = Arc::new(AtomicU64::new(0));
    let handle = app.clone();
    widget.on_window_event(move |event| match event {
        WindowEvent::Moved(_) => {
            let current = generation.fetch_add(1, Ordering::SeqCst) + 1;
            let generation = generation.clone();
            let handle = handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(600));
                if generation.load(Ordering::SeqCst) == current {
                    let _ = handle.save_window_state(StateFlags::POSITION);
                }
            });
        }
        WindowEvent::CloseRequested { api, .. } => {
            // Alt+F4 on the widget shouldn't kill the whole thing.
            api.prevent_close();
            if let Some(w) = handle.get_webview_window(WIDGET) {
                let _ = w.hide();
            }
        }
        _ => {}
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_widget(app.clone());
            show_settings(app);
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::UpdateState::default())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .with_denylist(&[SETTINGS])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            steam_search,
            steam_details,
            open_settings,
            show_widget,
            start_drag,
            show_context_menu,
            get_autostart,
            set_autostart,
            updater::check_for_update,
            updater::update_status,
            updater::install_update,
        ])
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            first_run_setup(&handle);

            let menu = build_menu(&handle)?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Strife Delivery")
                .menu(&menu.menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_settings(tray.app_handle());
                    }
                })
                .build(app)?;
            app.manage(menu);

            watch_widget_moves(&handle);
            updater::spawn_background_checks(handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Strife Delivery")
        .run(|_app, event| {
            // Closing the settings window must not quit the app.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
