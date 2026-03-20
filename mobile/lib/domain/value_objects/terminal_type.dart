/// Terminal type determining session behavior and rendering.
enum TerminalType {
  shell('shell'),
  agent('agent'),
  file('file'),
  browser('browser');

  const TerminalType(this.value);
  final String value;

  static TerminalType fromString(String value) => switch (value) {
        'shell' => TerminalType.shell,
        'agent' => TerminalType.agent,
        'file' => TerminalType.file,
        'browser' => TerminalType.browser,
        _ => TerminalType.shell,
      };

  /// Whether this type renders a terminal emulator on mobile.
  bool get hasTerminal => this == shell || this == agent;
}
