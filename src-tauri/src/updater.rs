//! Manual-first updates. The app quietly *checks* GitHub Releases at startup
//! and every 12 hours so the menu can say "Update available…", but nothing
//! is downloaded or installed until someone clicks "Install and restart".

use std::{sync::Mutex, thread, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    date: Option<String>,
}

impl UpdateInfo {
    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn info_for(app: &AppHandle, update: Option<&Update>) -> UpdateInfo {
    UpdateInfo {
        current_version: app.package_info().version.to_string(),
        version: update.map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body.clone()),
        date: update.and_then(|u| u.date.map(|d| d.to_string())),
    }
}

async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    let info = info_for(app, update.as_ref());
    if let Some(state) = app.try_state::<UpdateState>() {
        *state.pending.lock().unwrap() = update;
    }
    crate::set_update_menu_label(app, info.version.as_deref());
    let _ = app.emit("update-status", &info);
    Ok(info)
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateInfo, String> {
    check(&app).await
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateInfo {
    let state = app.state::<UpdateState>();
    let pending = state.pending.lock().unwrap();
    info_for(&app, pending.as_ref())
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let pending = app.state::<UpdateState>().pending.lock().unwrap().clone();
    let update = match pending {
        Some(update) => update,
        None => app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("You're already on the latest version")?,
    };

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("The update didn't install: {e}"))?;

    // On Windows the installer has already taken over and exited us by now.
    app.restart();
}

/// Check once shortly after launch, then every 12 hours. Only checks.
pub fn spawn_background_checks(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(FIRST_CHECK_DELAY);
        loop {
            let _ = tauri::async_runtime::block_on(check(&app));
            thread::sleep(CHECK_INTERVAL);
        }
    });
}
