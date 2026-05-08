/// Type-safe session status with exhaustive pattern matching.
sealed class SessionStatus {
  const SessionStatus();

  String get value;

  static SessionStatus fromString(String value) => switch (value) {
        'active' => const Active(),
        'suspended' => const Suspended(),
        'closed' => const Closed(),
        'trashed' => const Trashed(),
        _ => const Closed(),
      };
}

final class Active extends SessionStatus {
  const Active();
  @override
  String get value => 'active';
}

final class Suspended extends SessionStatus {
  const Suspended();
  @override
  String get value => 'suspended';
}

final class Closed extends SessionStatus {
  const Closed();
  @override
  String get value => 'closed';
}

final class Trashed extends SessionStatus {
  const Trashed();
  @override
  String get value => 'trashed';
}
