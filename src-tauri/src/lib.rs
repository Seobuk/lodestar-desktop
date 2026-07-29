mod stt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(stt::SttState::default())
        .invoke_handler(tauri::generate_handler![
            stt::stt_realtime_start,
            stt::stt_feed,
            stt::stt_realtime_stop,
            stt::stt_transcribe,
            stt::stt_models_status,
            stt::stt_download_model,
            stt::stt_delete_model,
        ])
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
