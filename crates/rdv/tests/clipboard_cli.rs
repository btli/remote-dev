use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;

use assert_cmd::Command;
use serde_json::Value;

fn read_http_request(mut stream: &TcpStream) -> Vec<u8> {
    let mut request = Vec::new();
    let mut buf = [0_u8; 4096];
    let mut header_end = None;
    let mut content_length = 0_usize;

    loop {
        let read = stream.read(&mut buf).expect("read request");
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buf[..read]);

        if header_end.is_none() {
            if let Some(index) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                let end = index + 4;
                let headers = String::from_utf8_lossy(&request[..end]);
                content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                header_end = Some(end);
            }
        }

        if let Some(end) = header_end {
            if request.len() >= end + content_length {
                break;
            }
        }
    }

    request
}

fn spawn_one_shot_server(
    status: &str,
    content_type: &str,
    body: Vec<u8>,
) -> (u16, mpsc::Receiver<Vec<u8>>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel();
    let status = status.to_owned();
    let content_type = content_type.to_owned();

    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        let request = read_http_request(&stream);
        tx.send(request).expect("send captured request");
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len(),
        )
        .expect("write response headers");
        stream.write_all(&body).expect("write response body");
    });

    (port, rx, handle)
}

fn clipboard_command(port: u16) -> Command {
    let mut command = Command::cargo_bin("rdv").unwrap();
    command
        .env_remove("RDV_TERMINAL_SOCKET")
        .env("RDV_TERMINAL_PORT", port.to_string())
        .env("RDV_SESSION_ID", "session-a");
    command
}

#[test]
fn clipboard_help_shows_copy_and_paste() {
    let mut command = Command::cargo_bin("rdv").unwrap();
    command.args(["clipboard", "--help"]);
    command
        .assert()
        .success()
        .stdout(predicates::str::contains("copy"))
        .stdout(predicates::str::contains("paste"));
}

#[test]
fn clipboard_copy_reads_utf8_stdin_and_posts_it_for_the_current_session() {
    let (port, request_rx, handle) = spawn_one_shot_server(
        "200 OK",
        "application/json",
        br#"{"revision":1,"delivered":false}"#.to_vec(),
    );
    let input = "line one\nemoji 😀\n";

    clipboard_command(port)
        .args(["clipboard", "copy"])
        .write_stdin(input)
        .assert()
        .success()
        .stdout("");

    let request = request_rx.recv().expect("captured request");
    handle.join().unwrap();
    let header_end = request
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap()
        + 4;
    let headers = String::from_utf8_lossy(&request[..header_end]);
    assert!(headers.starts_with("POST /internal/clipboard HTTP/1.1\r\n"));
    let body: Value = serde_json::from_slice(&request[header_end..]).unwrap();
    assert_eq!(body["sessionId"], "session-a");
    assert_eq!(body["data"], input);
}

#[test]
fn clipboard_paste_writes_the_exact_response_without_a_trailing_newline() {
    let clipboard = "line one\nemoji 😀\0tail".as_bytes().to_vec();
    let (port, request_rx, handle) =
        spawn_one_shot_server("200 OK", "text/plain; charset=utf-8", clipboard.clone());

    let output = clipboard_command(port)
        .args(["clipboard", "paste"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    assert_eq!(output, clipboard);
    let request = request_rx.recv().expect("captured request");
    handle.join().unwrap();
    let headers = String::from_utf8_lossy(&request);
    assert!(headers.starts_with("GET /internal/clipboard?sessionId=session-a HTTP/1.1\r\n"));
}
