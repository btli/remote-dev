use assert_cmd::Command;

#[test]
fn group_help_shows_subcommands() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    cmd.args(["group", "--help"]);
    cmd.assert()
        .success()
        .stdout(predicates::str::contains("list"))
        .stdout(predicates::str::contains("create"))
        .stdout(predicates::str::contains("move"))
        .stdout(predicates::str::contains("delete"));
}

#[test]
fn group_list_requires_server() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    // Point to an unreachable port + blank API key to force failure.
    cmd.env_remove("RDV_API_KEY")
        .env_remove("RDV_API_SOCKET")
        .env("RDV_API_PORT", "1")
        .args(["group", "list"]);
    cmd.assert().failure();
}

#[test]
fn group_create_help_shows_flags() {
    let mut cmd = Command::cargo_bin("rdv").unwrap();
    cmd.args(["group", "create", "--help"]);
    cmd.assert()
        .success()
        .stdout(predicates::str::contains("--name"))
        .stdout(predicates::str::contains("--parent-group-id"));
}
