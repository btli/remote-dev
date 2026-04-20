use assert_cmd::Command;

#[test]
fn project_help_shows_subcommands() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    cmd.args(["project", "--help"]);
    cmd.assert()
        .success()
        .stdout(predicates::str::contains("list"))
        .stdout(predicates::str::contains("create"))
        .stdout(predicates::str::contains("move"));
}

#[test]
fn project_list_requires_server() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    // Point to an unreachable port to force failure regardless of local dev server.
    cmd.env_remove("RDV_API_KEY")
        .env_remove("RDV_API_SOCKET")
        .env("RDV_API_PORT", "1")
        .args(["project", "list"]);
    cmd.assert().failure();
}

#[test]
fn project_create_help_shows_flags() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    cmd.args(["project", "create", "--help"]);
    cmd.assert()
        .success()
        .stdout(predicates::str::contains("--group-id"))
        .stdout(predicates::str::contains("--name"));
}
