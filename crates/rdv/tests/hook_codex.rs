use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
#[cfg(unix)]
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

use assert_cmd::Command;

fn serve_one_request_with_status(status: &str) -> (u16, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock terminal server");
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    let status = status.to_string();

    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept hook request");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut chunk = [0_u8; 2048];
        loop {
            let read = stream.read(&mut chunk).expect("read hook request");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        sender
            .send(String::from_utf8_lossy(&request).into_owned())
            .unwrap();
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: 2\r\nconnection: close\r\n\r\n{{}}",
        );
        stream.write_all(response.as_bytes()).unwrap();
    });

    (port, receiver)
}

fn serve_one_request() -> (u16, mpsc::Receiver<String>) {
    serve_one_request_with_status("200 OK")
}

fn serve_stalled_request() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind stalled terminal server");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept stalled hook request");
        let mut request = [0_u8; 2048];
        let _ = stream.read(&mut request);
        thread::sleep(Duration::from_secs(5));
    });
    port
}

fn read_http_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = Vec::new();
    let mut chunk = [0_u8; 2048];
    loop {
        let read = stream.read(&mut chunk).expect("read mock request");
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8_lossy(&request).into_owned()
}

fn write_json_response(stream: &mut TcpStream, body: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len(),
    );
    stream.write_all(response.as_bytes()).unwrap();
}

fn serve_status_then_stalled_digest() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock terminal server");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        let (mut status_stream, _) = listener.accept().expect("accept status request");
        let _ = read_http_request(&mut status_stream);
        write_json_response(&mut status_stream, "{}");

        // The fixed handler skips ancillary peer work once the guard denies.
        // The old handler reaches this request first and loses its policy budget here.
        let Ok((mut digest_stream, _)) = listener.accept() else {
            return;
        };
        let _ = read_http_request(&mut digest_stream);
        thread::sleep(Duration::from_secs(5));
    });
    port
}

fn serve_blocking_git_guard() -> (u16, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock API server");
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for body in [
            r#"{"projectId":"project-sensitive"}"#,
            r#"{"risk":"block","reason":"wrong identity"}"#,
        ] {
            let (mut stream, _) = listener.accept().expect("accept git guard request");
            let request = read_http_request(&mut stream);
            sender.send(request).unwrap();
            write_json_response(&mut stream, body);
        }
    });
    (port, receiver)
}

fn serve_digest_with_stalled_ack() -> (u16, mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock terminal server");
    let port = listener.local_addr().unwrap().port();
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let responses = [
            "{}",
            "{}",
            r#"{"messages":[{"id":"message-1","fromSessionName":"peer","body":"heads up","toSessionId":null}]}"#,
        ];
        for body in responses {
            let (mut stream, _) = listener.accept().expect("accept digest request");
            let request = read_http_request(&mut stream);
            sender.send(request).unwrap();
            write_json_response(&mut stream, body);
        }

        let (mut ack_stream, _) = listener.accept().expect("accept digest ack");
        let request = read_http_request(&mut ack_stream);
        sender.send(request).unwrap();
        thread::sleep(Duration::from_secs(5));
    });
    (port, receiver)
}

#[test]
fn codex_permission_request_reports_waiting_without_stdout() {
    let (port, request) = serve_one_request();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-codex-test")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_HOOK_DELIVERY_ID", "delivery-123")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "permission-request"])
        .write_stdin(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);

    command.assert().success().stdout("");

    let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
    let request_line = request.lines().next().unwrap_or_default();
    assert!(request_line.starts_with("POST /internal/agent-status?"));
    assert!(request_line.contains("sessionId=session-codex-test"));
    assert!(request_line.contains("generation=4"));
    assert!(request_line.contains("status=waiting"));
    assert!(request_line.contains("deliveryId=delivery-123"));
    assert!(request
        .lines()
        .any(|line| line.eq_ignore_ascii_case("authorization: Bearer rdv_test_callback_key")));
}

#[test]
fn codex_status_without_session_id_exits_nonzero_for_tmux_fallback() {
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_SESSION_ID")
        .args(["hook", "codex", "permission-request"])
        .write_stdin(r#"{"hook_event_name":"PermissionRequest"}"#);

    command.assert().failure().stdout("");
}

#[test]
fn codex_status_delivery_failure_exits_nonzero_for_shell_fallback() {
    let (port, request) = serve_one_request_with_status("503 Service Unavailable");
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-codex-test")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "permission-request"])
        .write_stdin(r#"{"hook_event_name":"PermissionRequest","tool_name":"Bash"}"#);

    command.assert().failure().stdout("");
    request.recv_timeout(Duration::from_secs(5)).unwrap();
}

#[test]
fn codex_status_delivery_timeout_exits_promptly_for_shell_fallback() {
    let port = serve_stalled_request();
    let started = Instant::now();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-codex-test")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "permission-request"])
        .write_stdin(r#"{"hook_event_name":"PermissionRequest"}"#);

    command.assert().failure().stdout("");
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "lifecycle delivery must yield promptly to the shell fallback"
    );
}

#[test]
fn codex_pre_tool_git_guard_runs_before_stalled_peer_work() {
    let terminal_port = serve_status_then_stalled_digest();
    let (api_port, api_requests) = serve_blocking_git_guard();
    let started = Instant::now();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_API_SOCKET")
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_API_PORT", api_port.to_string())
        .env("RDV_TERMINAL_PORT", terminal_port.to_string())
        .env("RDV_SESSION_ID", "session-codex-guard-priority")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "pre-tool-use"])
        .write_stdin(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push"}}"#,
        );

    let assertion = command.assert().success();
    let stdout = String::from_utf8_lossy(&assertion.get_output().stdout);
    assert!(stdout.contains(r#""permissionDecision":"deny""#));
    assert!(stdout.contains(r#""permissionDecisionReason":"wrong identity""#));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "ancillary peer work must not consume the git guard deadline",
    );

    let session_request = api_requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(session_request.starts_with("GET /api/sessions/session-codex-guard-priority "));
    let guard_request = api_requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(guard_request.starts_with("POST /api/folders/project-sensitive/git-guard "));
}

#[cfg(unix)]
#[test]
fn codex_pre_tool_bounds_stalled_peer_digest_ack() {
    let session_id = format!(
        "session-codex-ack-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    );
    let sentinel = PathBuf::from(format!("/tmp/rdv-peer-start-{session_id}"));
    fs::write(&sentinel, "1").unwrap();
    let (terminal_port, requests) = serve_digest_with_stalled_ack();
    let started = Instant::now();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("RDV_API_SOCKET")
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", terminal_port.to_string())
        .env("RDV_SESSION_ID", &session_id)
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "pre-tool-use"])
        .write_stdin(
            r#"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pwd"}}"#,
        );

    let assertion = command.assert().success();
    let _ = fs::remove_file(&sentinel);
    let stdout = String::from_utf8_lossy(&assertion.get_output().stdout);
    assert!(stdout.contains("heads up"));
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "a stalled digest acknowledgement must not consume the Codex hook deadline",
    );

    let requests: Vec<String> = (0..4)
        .map(|_| requests.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect();
    assert!(requests[0].starts_with("POST /internal/agent-status?"));
    assert!(requests[1].starts_with("GET /internal/peers/digest?"));
    assert!(requests[2].starts_with("GET /internal/peers/messages/poll?"));
    assert!(requests[3].starts_with("POST /internal/peers/ack-batch "));
}

#[test]
fn hook_validation_uses_the_authenticated_non_mutating_health_endpoint() {
    let (port, request) = serve_one_request();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-codex-test")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "validate"]);

    command.assert().success();
    let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
    let request_line = request.lines().next().unwrap_or_default();
    assert!(request_line.starts_with("GET /internal/agent-hook-health?"));
    assert!(request_line.contains("sessionId=session-codex-test"));
    assert!(request_line.contains("generation=4"));
    assert!(!request_line.contains("status="));
}

#[cfg(unix)]
#[test]
fn codex_stop_bounds_a_stalled_beads_check_before_delivering_idle() {
    let unique = format!(
        "rdv-hook-bd-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    );
    let root: PathBuf = std::env::temp_dir().join(unique);
    let bin = root.join("bin");
    fs::create_dir_all(root.join(".beads")).unwrap();
    fs::create_dir_all(&bin).unwrap();
    let bd = bin.join("bd");
    fs::write(&bd, "#!/bin/sh\nexec sleep 5\n").unwrap();
    let mut permissions = fs::metadata(&bd).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&bd, permissions).unwrap();

    let (port, request) = serve_one_request();
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let started = Instant::now();
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .current_dir(&root)
        .env("PATH", path)
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-codex-test")
        .env("RDV_AGENT_GENERATION", "4")
        .env("RDV_HOOK_DELIVERY_ID", "delivery-stop")
        .env("RDV_API_KEY", "rdv_test_callback_key")
        .args(["hook", "codex", "stop"])
        .write_stdin(r#"{"hook_event_name":"Stop"}"#);

    command.assert().success();
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "stalled bd must not consume the outer Codex hook deadline",
    );
    let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
    let request_line = request.lines().next().unwrap_or_default();
    assert!(request_line.contains("/internal/agent-status?"));
    assert!(request_line.contains("status=idle"));
    let _ = fs::remove_dir_all(root);
}
