use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Manager, State};

const MAX_LOG_LINES: usize = 120;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    backend_port: String,
    backend_api_url: String,
    worker_auth_mode: String,
    worker_username: String,
    worker_password: String,
    worker_device_name: String,
    worker_workspace_dir: String,
    codex_command: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceSnapshot {
    label: String,
    status: String,
    pid: Option<u32>,
    started_at: Option<String>,
    stopped_at: Option<String>,
    exit_code: Option<i32>,
    logs: Vec<String>,
}

struct RuntimeService {
    label: String,
    status: String,
    pid: Option<u32>,
    started_at: Option<String>,
    stopped_at: Option<String>,
    exit_code: Option<i32>,
    logs: Vec<String>,
    child: Option<Arc<Mutex<Child>>>,
}

#[derive(Clone)]
struct RuntimeState {
    services: Arc<Mutex<HashMap<String, RuntimeService>>>,
    config: Arc<Mutex<Option<DesktopConfig>>>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn default_config() -> DesktopConfig {
    let backend_port = std::env::var("BACKEND_PORT").unwrap_or_else(|_| "3002".to_string());
    DesktopConfig {
        backend_port: backend_port.clone(),
        backend_api_url: std::env::var("AIH_BACKEND_URL")
            .unwrap_or_else(|_| format!("http://127.0.0.1:{}/api", backend_port)),
        worker_auth_mode: std::env::var("AIH_AUTH_MODE").unwrap_or_else(|_| "mock".to_string()),
        worker_username: std::env::var("AIH_USERNAME").unwrap_or_else(|_| "admin".to_string()),
        worker_password: std::env::var("AIH_PASSWORD").unwrap_or_else(|_| "admin123".to_string()),
        worker_device_name: std::env::var("AIH_DEVICE_NAME")
            .unwrap_or_else(|_| "AIInHouse 桌面工作站".to_string()),
        worker_workspace_dir: std::env::var("AIH_WORKSPACE_DIR").unwrap_or_default(),
        codex_command: std::env::var("AIH_CODEX_COMMAND")
            .unwrap_or_else(|_| "node ../codex-worker/src/index.js".to_string()),
    }
}

fn append_log(service: &mut RuntimeService, message: impl Into<String>) {
    service.logs.push(format!("[{}] {}", now(), message.into()));
    if service.logs.len() > MAX_LOG_LINES {
        service.logs = service.logs.split_off(service.logs.len() - MAX_LOG_LINES);
    }
}

fn runtime_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("desktop-runtime.json"))
        .map_err(|error| error.to_string())
}

fn project_root(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf()
    } else {
        app.path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn runtime_path(app: &AppHandle, segments: &[&str]) -> PathBuf {
    let mut root = project_root(app);
    for segment in segments {
        root.push(segment);
    }
    root
}

fn get_config(app: &AppHandle, state: &RuntimeState) -> Result<DesktopConfig, String> {
    let mut cached = state.config.lock().map_err(|error| error.to_string())?;
    if let Some(config) = cached.clone() {
        return Ok(config);
    }

    let path = runtime_config_path(app)?;
    let config = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<DesktopConfig>(&content).ok())
            .unwrap_or_else(default_config)
    } else {
        default_config()
    };

    *cached = Some(config.clone());
    Ok(config)
}

fn node_command() -> String {
    std::env::var("AIH_NODE").unwrap_or_else(|_| "node".to_string())
}

fn service_command(app: &AppHandle, config: &DesktopConfig, service_name: &str) -> Result<(PathBuf, String, Vec<String>, HashMap<String, String>), String> {
    match service_name {
        "backend" => Ok((
            runtime_path(app, &["backend"]),
            node_command(),
            vec![runtime_path(app, &["backend", "server.js"]).to_string_lossy().to_string()],
            HashMap::from([
                ("PORT".to_string(), config.backend_port.clone()),
                ("NODE_ENV".to_string(), "production".to_string()),
            ]),
        )),
        "worker" => Ok((
            project_root(app),
            node_command(),
            vec![runtime_path(app, &["desktop-worker", "src", "index.js"]).to_string_lossy().to_string()],
            HashMap::from([
                ("AIH_BACKEND_URL".to_string(), config.backend_api_url.clone()),
                ("AIH_AUTH_MODE".to_string(), config.worker_auth_mode.clone()),
                ("AIH_USERNAME".to_string(), config.worker_username.clone()),
                ("AIH_PASSWORD".to_string(), config.worker_password.clone()),
                ("AIH_DEVICE_NAME".to_string(), config.worker_device_name.clone()),
                ("AIH_WORKSPACE_DIR".to_string(), config.worker_workspace_dir.clone()),
                ("AIH_CODEX_COMMAND".to_string(), config.codex_command.clone()),
                ("NODE_ENV".to_string(), "production".to_string()),
            ]),
        )),
        _ => Err(format!("未知服务: {}", service_name)),
    }
}

fn snapshot(app: &AppHandle, state: &RuntimeState) -> Result<Value, String> {
    let services = state.services.lock().map_err(|error| error.to_string())?;
    let mut value = serde_json::Map::new();

    for (name, service) in services.iter() {
        value.insert(name.clone(), serde_json::to_value(ServiceSnapshot {
            label: service.label.clone(),
            status: service.status.clone(),
            pid: service.pid,
            started_at: service.started_at.clone(),
            stopped_at: service.stopped_at.clone(),
            exit_code: service.exit_code,
            logs: service.logs.clone(),
        }).map_err(|error| error.to_string())?);
    }

    value.insert("isDesktop".to_string(), json!(true));
    value.insert("isPackaged".to_string(), json!(!cfg!(debug_assertions)));
    value.insert("runtime".to_string(), json!("tauri"));
    value.insert(
        "config".to_string(),
        serde_json::to_value(get_config(app, state)?).map_err(|error| error.to_string())?,
    );
    Ok(Value::Object(value))
}

#[tauri::command]
fn runtime_get_status(app: AppHandle, state: State<RuntimeState>) -> Result<Value, String> {
    snapshot(&app, &state)
}

#[tauri::command]
fn runtime_get_config(app: AppHandle, state: State<RuntimeState>) -> Result<DesktopConfig, String> {
    get_config(&app, &state)
}

#[tauri::command]
fn runtime_save_config(app: AppHandle, state: State<RuntimeState>, config: DesktopConfig) -> Result<Value, String> {
    let path = runtime_config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    *state.config.lock().map_err(|error| error.to_string())? = Some(config.clone());
    Ok(json!({ "success": true, "config": config }))
}

#[tauri::command]
fn runtime_start_service(app: AppHandle, state: State<RuntimeState>, service_name: String) -> Result<Value, String> {
    let config = get_config(&app, &state)?;
    let (cwd, command, args, envs) = service_command(&app, &config, &service_name)?;

    let mut services = state.services.lock().map_err(|error| error.to_string())?;
    let service = services.get_mut(&service_name).ok_or_else(|| format!("未知服务: {}", service_name))?;

    if service.child.is_some() {
        return snapshot(&app, &state);
    }

    let mut child_command = Command::new(command);
    child_command.args(args).current_dir(cwd).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in envs {
        child_command.env(key, value);
    }

    let mut child = child_command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child_ref = Arc::new(Mutex::new(child));

    service.child = Some(child_ref.clone());
    service.status = "starting".to_string();
    service.pid = Some(pid);
    service.started_at = Some(now());
    service.stopped_at = None;
    service.exit_code = None;
    append_log(service, format!("{} 启动中", service.label));

    if let Some(mut stdout) = stdout {
        let state_ref = state.inner().clone();
        let service_key = service_name.clone();
        thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(&mut stdout).lines().flatten() {
                if let Ok(mut services) = state_ref.services.lock() {
                    if let Some(service) = services.get_mut(&service_key) {
                        append_log(service, line);
                        if service.status == "starting" {
                            service.status = "running".to_string();
                        }
                    }
                }
            }
        });
    }

    if let Some(mut stderr) = stderr {
        let state_ref = state.inner().clone();
        let service_key = service_name.clone();
        thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(&mut stderr).lines().flatten() {
                if let Ok(mut services) = state_ref.services.lock() {
                    if let Some(service) = services.get_mut(&service_key) {
                        append_log(service, format!("[stderr] {}", line));
                        if service.status == "starting" {
                            service.status = "running".to_string();
                        }
                    }
                }
            }
        });
    }

    let state_ref = state.inner().clone();
    let service_key = service_name.clone();
    thread::spawn(move || {
        let code = child_ref.lock().ok().and_then(|mut child| child.wait().ok()).and_then(|status| status.code());
        if let Ok(mut services) = state_ref.services.lock() {
            if let Some(service) = services.get_mut(&service_key) {
                service.child = None;
                service.pid = None;
                service.status = if code.unwrap_or(1) == 0 { "stopped" } else { "failed" }.to_string();
                service.stopped_at = Some(now());
                service.exit_code = code;
                append_log(service, format!("{} 已退出，退出码 {}", service.label, code.unwrap_or(-1)));
            }
        }
    });

    drop(services);
    snapshot(&app, &state)
}

#[tauri::command]
fn runtime_stop_service(app: AppHandle, state: State<RuntimeState>, service_name: String) -> Result<Value, String> {
    let mut services = state.services.lock().map_err(|error| error.to_string())?;
    let service = services.get_mut(&service_name).ok_or_else(|| format!("未知服务: {}", service_name))?;
    let child_ref = service.child.clone();
    if let Some(child) = child_ref {
        service.status = "stopping".to_string();
        append_log(service, "收到停止指令");
        if let Ok(mut child) = child.lock() {
            child.kill().map_err(|error| error.to_string())?;
        }
    }
    drop(services);
    snapshot(&app, &state)
}

#[tauri::command]
fn runtime_restart_service(app: AppHandle, state: State<RuntimeState>, service_name: String) -> Result<Value, String> {
    let _ = runtime_stop_service(app.clone(), state.clone(), service_name.clone());
    thread::sleep(std::time::Duration::from_millis(800));
    runtime_start_service(app, state, service_name)
}

fn initial_state() -> RuntimeState {
    RuntimeState {
        config: Arc::new(Mutex::new(None)),
        services: Arc::new(Mutex::new(HashMap::from([
            ("backend".to_string(), RuntimeService {
                label: "后台服务".to_string(),
                status: "stopped".to_string(),
                pid: None,
                started_at: None,
                stopped_at: None,
                exit_code: None,
                logs: Vec::new(),
                child: None,
            }),
            ("worker".to_string(), RuntimeService {
                label: "桌面 Worker".to_string(),
                status: "stopped".to_string(),
                pid: None,
                started_at: None,
                stopped_at: None,
                exit_code: None,
                logs: Vec::new(),
                child: None,
            }),
        ]))),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(initial_state())
        .invoke_handler(tauri::generate_handler![
            runtime_get_status,
            runtime_get_config,
            runtime_save_config,
            runtime_start_service,
            runtime_stop_service,
            runtime_restart_service
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = handle.state::<RuntimeState>();
            let _ = runtime_start_service(handle.clone(), state.clone(), "backend".to_string());
            let handle_for_worker = handle.clone();
            thread::spawn(move || {
                thread::sleep(std::time::Duration::from_millis(1800));
                let state_for_worker = handle_for_worker.state::<RuntimeState>();
                let _ = runtime_start_service(handle_for_worker.clone(), state_for_worker, "worker".to_string());
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let handle = window.app_handle().clone();
                let state = handle.state::<RuntimeState>();
                let _ = runtime_stop_service(handle.clone(), state.clone(), "worker".to_string());
                let backend_handle = handle.clone();
                let state = backend_handle.state::<RuntimeState>();
                let _ = runtime_stop_service(handle, state, "backend".to_string());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
