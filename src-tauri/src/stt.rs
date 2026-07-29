// 받아쓰기 — sherpa-onnx(오프라인 whisper + Silero VAD)로 완전 오프라인 동작.
// 구 WinRT 경로 대체. 두 가지 모드:
//  - 준실시간: 브라우저가 16kHz mono PCM을 stt_feed로 흘려보내면, 워커 스레드가
//    Silero VAD로 발화를 분할하고 각 발화를 whisper로 인식해 "stt" 이벤트(final)로 emit.
//    단어별 스트리밍이 아니라 문장 단위(발화 끝나면 1~2초 내 텍스트). 한국어 스트리밍
//    zipformer가 손상(upstream #2886)이라 VAD+오프라인 방식을 택함.
//  - 정밀 전사: 녹음 전체 샘플을 stt_transcribe로 받아 whisper로 한 번에 전사.
// 모델은 앱데이터에 개별 다운로드(int8). 네이티브 lib는 정적 링크(배포 DLL 없음).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use sherpa_onnx::{
    OfflineRecognizer, OfflineRecognizerConfig, OfflineWhisperModelConfig,
    VadModelConfig, VoiceActivityDetector,
};

pub struct SttState(pub Mutex<Option<Sender<Vec<f32>>>>);

impl Default for SttState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

// ----- 모델 경로 --------------------------------------------------------

fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("앱 데이터 경로를 찾을 수 없습니다: {e}"))?
        .join("models");
    Ok(dir)
}

/// whisper 모델의 (encoder, decoder, tokens) 경로(int8). model = "small" | "turbo".
fn whisper_paths(app: &AppHandle, model: &str) -> Result<(String, String, String), String> {
    let dir = models_root(app)?.join(format!("whisper-{model}"));
    let enc = dir.join(format!("{model}-encoder.int8.onnx"));
    let dec = dir.join(format!("{model}-decoder.int8.onnx"));
    let tok = dir.join(format!("{model}-tokens.txt"));
    for p in [&enc, &dec, &tok] {
        if !p.exists() {
            return Err(format!("모델 파일이 없습니다: {}", p.display()));
        }
    }
    Ok((s(&enc), s(&dec), s(&tok)))
}

fn vad_path(app: &AppHandle) -> Result<String, String> {
    let p = models_root(app)?.join("silero_vad.onnx");
    if !p.exists() {
        return Err("VAD 모델이 없습니다(설정에서 받아쓰기 모델을 설치하세요).".into());
    }
    Ok(s(&p))
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn build_whisper(enc: &str, dec: &str, tok: &str) -> Result<OfflineRecognizer, String> {
    let mut cfg = OfflineRecognizerConfig::default();
    cfg.model_config.whisper = OfflineWhisperModelConfig {
        encoder: Some(enc.to_string()),
        decoder: Some(dec.to_string()),
        language: Some("ko".to_string()),
        task: Some("transcribe".to_string()),
        tail_paddings: 0,
        enable_token_timestamps: false,
        enable_segment_timestamps: false,
    };
    cfg.model_config.tokens = Some(tok.to_string());
    cfg.model_config.provider = Some("cpu".to_string());
    OfflineRecognizer::create(&cfg).ok_or_else(|| "whisper 모델 로드 실패".to_string())
}

fn transcribe_samples(rec: &OfflineRecognizer, sample_rate: i32, samples: &[f32]) -> String {
    let stream = rec.create_stream();
    stream.accept_waveform(sample_rate, samples);
    rec.decode(&stream);
    stream
        .get_result()
        .map(|r| r.text.trim().to_string())
        .unwrap_or_default()
}

// ----- 이벤트 payload ---------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum SttEvent {
    Ready,
    Decoding,
    Final { text: String },
    Error { text: String },
    Stopped,
}

fn emit(app: &AppHandle, ev: SttEvent) {
    let _ = app.emit("stt", ev);
}

// ----- 준실시간(VAD + whisper 워커 스레드) ------------------------------

#[tauri::command]
pub fn stt_realtime_start(
    app: AppHandle,
    state: State<'_, SttState>,
    model: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Ok(()); // 이미 실행 중
    }
    let (enc, dec, tok) = whisper_paths(&app, &model)?;
    let vad = vad_path(&app)?;

    let (tx, rx) = std::sync::mpsc::channel::<Vec<f32>>();
    let app2 = app.clone();
    thread::spawn(move || worker(app2, &enc, &dec, &tok, &vad, rx));
    *guard = Some(tx);
    Ok(())
}

#[tauri::command]
pub fn stt_feed(state: State<'_, SttState>, samples: Vec<f32>) {
    if let Some(tx) = state.0.lock().unwrap().as_ref() {
        let _ = tx.send(samples); // 워커가 끊겼으면 조용히 무시
    }
}

#[tauri::command]
pub fn stt_realtime_stop(state: State<'_, SttState>) {
    // Sender를 떨어뜨리면 채널이 끊겨 워커가 flush 후 종료한다.
    *state.0.lock().unwrap() = None;
}

const VAD_WINDOW: usize = 512; // Silero v5 window

fn worker(app: AppHandle, enc: &str, dec: &str, tok: &str, vad_model: &str, rx: Receiver<Vec<f32>>) {
    let rec = match build_whisper(enc, dec, tok) {
        Ok(r) => r,
        Err(e) => {
            emit(&app, SttEvent::Error { text: e });
            return;
        }
    };
    let mut vcfg = VadModelConfig::default();
    vcfg.silero_vad.model = Some(vad_model.to_string());
    vcfg.silero_vad.threshold = 0.5;
    vcfg.silero_vad.min_silence_duration = 0.25;
    vcfg.silero_vad.min_speech_duration = 0.25;
    vcfg.silero_vad.max_speech_duration = 15.0;
    vcfg.silero_vad.window_size = VAD_WINDOW as i32;
    vcfg.sample_rate = 16000;
    let mut vad = match VoiceActivityDetector::create(&vcfg, 30.0) {
        Some(v) => v,
        None => {
            emit(&app, SttEvent::Error { text: "VAD 모델 로드 실패".into() });
            return;
        }
    };
    emit(&app, SttEvent::Ready);

    let mut leftover: Vec<f32> = Vec::new();
    loop {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(samples) => {
                leftover.extend_from_slice(&samples);
                feed_windows(&mut vad, &mut leftover);
                drain(&app, &mut vad, &rec);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                drain(&app, &mut vad, &rec);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                if !leftover.is_empty() {
                    vad.accept_waveform(&leftover);
                    leftover.clear();
                }
                vad.flush();
                drain(&app, &mut vad, &rec);
                break;
            }
        }
    }
    emit(&app, SttEvent::Stopped);
}

/// leftover에서 VAD_WINDOW 배수만큼 잘라 넣고 나머지는 남긴다(Silero는 고정 창 선호).
fn feed_windows(vad: &mut VoiceActivityDetector, leftover: &mut Vec<f32>) {
    let mut i = 0;
    while i + VAD_WINDOW <= leftover.len() {
        vad.accept_waveform(&leftover[i..i + VAD_WINDOW]);
        i += VAD_WINDOW;
    }
    if i > 0 {
        leftover.drain(0..i);
    }
}

fn drain(app: &AppHandle, vad: &mut VoiceActivityDetector, rec: &OfflineRecognizer) {
    while !vad.is_empty() {
        if let Some(seg) = vad.front() {
            emit(app, SttEvent::Decoding);
            let text = transcribe_samples(rec, 16000, seg.samples());
            if !text.is_empty() {
                emit(app, SttEvent::Final { text });
            }
        }
        vad.pop();
    }
}

// ----- 정밀 전사(녹음 전체) ---------------------------------------------

#[tauri::command]
pub fn stt_transcribe(
    app: AppHandle,
    model: String,
    samples: Vec<f32>,
    sample_rate: i32,
) -> Result<String, String> {
    let (enc, dec, tok) = whisper_paths(&app, &model)?;
    let rec = build_whisper(&enc, &dec, &tok)?;
    // 30초씩 잘라 순차 전사(whisper는 긴 오디오를 한 번에 잘 못 다룸).
    let win = (sample_rate as usize) * 30;
    let mut out = String::new();
    let mut i = 0;
    while i < samples.len() {
        let end = (i + win).min(samples.len());
        let t = transcribe_samples(&rec, sample_rate, &samples[i..end]);
        if !t.is_empty() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(&t);
        }
        i = end;
    }
    Ok(out)
}

// ----- 모델 다운로드/관리 -----------------------------------------------

#[derive(Serialize)]
pub struct ModelsStatus {
    small: bool,
    turbo: bool,
    vad: bool,
}

#[tauri::command]
pub fn stt_models_status(app: AppHandle) -> Result<ModelsStatus, String> {
    Ok(ModelsStatus {
        small: whisper_paths(&app, "small").is_ok(),
        turbo: whisper_paths(&app, "turbo").is_ok(),
        vad: vad_path(&app).is_ok(),
    })
}

/// (url, 상대저장경로) 목록. model = "small" | "turbo" | "vad".
fn model_files(model: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let hf = |repo: &str, f: &str| {
        format!("https://huggingface.co/csukuangfj/{repo}/resolve/main/{f}")
    };
    match model {
        "vad" => Ok(vec![(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx".to_string(),
            PathBuf::from("silero_vad.onnx"),
        )]),
        "small" | "turbo" => {
            let repo = format!("sherpa-onnx-whisper-{model}");
            let dir = PathBuf::from(format!("whisper-{model}"));
            Ok(vec![
                (hf(&repo, &format!("{model}-encoder.int8.onnx")), dir.join(format!("{model}-encoder.int8.onnx"))),
                (hf(&repo, &format!("{model}-decoder.int8.onnx")), dir.join(format!("{model}-decoder.int8.onnx"))),
                (hf(&repo, &format!("{model}-tokens.txt")), dir.join(format!("{model}-tokens.txt"))),
            ])
        }
        _ => Err(format!("알 수 없는 모델: {model}")),
    }
}

#[derive(Serialize, Clone)]
struct DownloadEvent {
    model: String,
    file: String,
    received: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

#[tauri::command]
pub fn stt_download_model(app: AppHandle, model: String) -> Result<(), String> {
    let root = models_root(&app)?;
    let files = model_files(&model)?;
    for (url, rel) in files {
        let dest = root.join(&rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let fname = rel.to_string_lossy().into_owned();
        if let Err(e) = download_file(&app, &model, &fname, &url, &dest) {
            let _ = app.emit(
                "stt-download",
                DownloadEvent { model: model.clone(), file: fname.clone(), received: 0, total: 0, done: false, error: Some(e.clone()) },
            );
            return Err(e);
        }
    }
    let _ = app.emit(
        "stt-download",
        DownloadEvent { model: model.clone(), file: String::new(), received: 0, total: 0, done: true, error: None },
    );
    Ok(())
}

fn download_file(app: &AppHandle, model: &str, fname: &str, url: &str, dest: &Path) -> Result<(), String> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("다운로드 실패({fname}): {e}"))?;
    let total: u64 = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut reader = resp.into_reader();
    let tmp = dest.with_extension("part");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 262144];
    let mut received: u64 = 0;
    let mut last_emit = 0u64;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        // 4MB마다 진행률 emit(이벤트 폭주 방지)
        if received - last_emit >= 4 * 1024 * 1024 {
            last_emit = received;
            let _ = app.emit(
                "stt-download",
                DownloadEvent { model: model.to_string(), file: fname.to_string(), received, total, done: false, error: None },
            );
        }
    }
    drop(file);
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stt_delete_model(app: AppHandle, model: String) -> Result<(), String> {
    let root = models_root(&app)?;
    match model.as_str() {
        "vad" => {
            let _ = fs::remove_file(root.join("silero_vad.onnx"));
        }
        "small" | "turbo" => {
            let _ = fs::remove_dir_all(root.join(format!("whisper-{model}")));
        }
        _ => return Err(format!("알 수 없는 모델: {model}")),
    }
    Ok(())
}
