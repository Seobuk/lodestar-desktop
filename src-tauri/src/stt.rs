// 실시간 받아쓰기 — Windows 내장 음성 인식(WinRT SpeechRecognizer)을 연속 딕테이션
// 모드로 돌려 파셜(가설)·확정 문장을 "stt" 이벤트로 웹뷰에 쏜다. 한국어 음성 팩이
// 설치된 Windows에서 오프라인으로 동작한다(모델 다운로드·외부 서버 없음).
// 실패(음성 팩 없음·개인정보 설정 차단)는 사용자 안내 문자열로 돌려주고,
// 녹음(MediaRecorder)은 이와 무관하게 계속된다.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionCompletedEventArgs,
    SpeechContinuousRecognitionResultGeneratedEventArgs,
    SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognizer,
};

pub struct SttState(pub Mutex<Option<SpeechRecognizer>>);

impl Default for SttState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

const HELP: &str = " — Windows 설정 > 시간 및 언어 > 음성에서 한국어 음성 팩, 개인정보 > 음성 인식 허용, 마이크 권한을 확인하세요.";

#[tauri::command]
pub fn stt_start(app: AppHandle, state: State<'_, SttState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Ok(()); // 이미 실행 중
    }

    // 한국어 우선, 안 되면 시스템 기본 언어로 폴백
    let recognizer = Language::CreateLanguage(&HSTRING::from("ko-KR"))
        .ok()
        .and_then(|l| SpeechRecognizer::Create(&l).ok())
        .or_else(|| SpeechRecognizer::new().ok())
        .ok_or_else(|| format!("음성 인식기를 만들 수 없습니다{HELP}"))?;

    recognizer
        .CompileConstraintsAsync()
        .map_err(|e| format!("음성 인식 준비 실패: {e}{HELP}"))?
        .get()
        .map_err(|e| format!("음성 인식 준비 실패: {e}{HELP}"))?;

    // 파셜(가설) — 실시간 자막 표시용
    let app_partial = app.clone();
    recognizer
        .HypothesisGenerated(&TypedEventHandler::<
            SpeechRecognizer,
            SpeechRecognitionHypothesisGeneratedEventArgs,
        >::new(move |_, args| {
            if let Some(a) = args.as_ref() {
                if let Ok(text) = a.Hypothesis().and_then(|h| h.Text()) {
                    let _ = app_partial.emit(
                        "stt",
                        serde_json::json!({ "kind": "partial", "text": text.to_string() }),
                    );
                }
            }
            Ok(())
        }))
        .map_err(|e| e.to_string())?;

    let session = recognizer
        .ContinuousRecognitionSession()
        .map_err(|e| e.to_string())?;

    // 확정 문장 — 본문 삽입용
    let app_final = app.clone();
    session
        .ResultGenerated(&TypedEventHandler::<
            _,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        >::new(move |_, args| {
            if let Some(a) = args.as_ref() {
                if let Ok(text) = a.Result().and_then(|r| r.Text()) {
                    let t = text.to_string();
                    if !t.is_empty() {
                        let _ = app_final
                            .emit("stt", serde_json::json!({ "kind": "final", "text": t }));
                    }
                }
            }
            Ok(())
        }))
        .map_err(|e| e.to_string())?;

    // 세션 종료(침묵 자동 정지 포함) 통지 — UI가 상태를 되돌릴 수 있게
    let app_done = app.clone();
    session
        .Completed(&TypedEventHandler::<
            _,
            SpeechContinuousRecognitionCompletedEventArgs,
        >::new(move |_, _| {
            let _ = app_done.emit("stt", serde_json::json!({ "kind": "stopped" }));
            Ok(())
        }))
        .map_err(|e| e.to_string())?;

    // 회의 중 침묵으로 끊기지 않게 자동 정지를 넉넉히(20분)
    let _ = session.SetAutoStopSilenceTimeout(TimeSpan {
        Duration: 20 * 60 * 10_000_000i64,
    });

    session
        .StartAsync()
        .map_err(|e| format!("받아쓰기 시작 실패: {e}{HELP}"))?
        .get()
        .map_err(|e| format!("받아쓰기 시작 실패: {e}{HELP}"))?;

    *guard = Some(recognizer);
    Ok(())
}

#[tauri::command]
pub fn stt_stop(state: State<'_, SttState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(rec) = guard.take() {
        if let Ok(session) = rec.ContinuousRecognitionSession() {
            if let Ok(op) = session.StopAsync() {
                let _ = op.get();
            }
        }
        let _ = rec.Close(); // 마이크 즉시 해제
    }
    Ok(())
}
