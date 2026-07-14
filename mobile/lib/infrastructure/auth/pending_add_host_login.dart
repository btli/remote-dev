import 'dart:convert';

import 'package:flutter/foundation.dart' show immutable;

import '../../application/ports/secure_storage_port.dart';

/// A persisted "pending interactive add-host login".
///
/// The Add-host flow is STATE-INDEPENDENT: `AddHostScreen` writes one of these
/// BEFORE launching the system browser, then the app-global
/// `AddHostLoginCompleter` (which survives the activity recreation / GoRouter
/// rebuild that disposes `AddHostScreen.State`) reads it back when the
/// `remotedev://auth/callback` deep link returns and finishes the whole flow
/// (persist host → detect → activate/navigate).
///
/// [state] is the per-attempt anti-forgery nonce appended to the
/// `/auth/mobile-callback?state=…` URL. The completer honours a callback ONLY
/// when its echoed `state` EXACTLY matches this record's [state] — so a
/// forged/unsolicited/replayed callback can never complete the add. This is the
/// same anti-CSRF property the in-launcher nonce provided, relocated to a
/// durable record so it works across recreation.
@immutable
class PendingAddHostLogin {
  const PendingAddHostLogin({
    required this.origin,
    required this.label,
    required this.state,
    required this.createdAtMs,
  });

  /// Normalised `scheme://host[:port]` origin the user entered.
  final String origin;

  /// The user-entered host label (becomes the workspace display name).
  final String label;

  /// Single-use anti-forgery nonce echoed by the server on the callback.
  final String state;

  /// Wall-clock ms at write time, used to expire a stale record (user
  /// cancelled the browser and never returned) via [PendingAddHostLoginStore].
  final int createdAtMs;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'origin': origin,
        'label': label,
        'state': state,
        'createdAtMs': createdAtMs,
      };

  static PendingAddHostLogin? fromJson(Map<String, dynamic> json) {
    final origin = json['origin'];
    final label = json['label'];
    final state = json['state'];
    final createdAtMs = json['createdAtMs'];
    if (origin is! String ||
        label is! String ||
        state is! String ||
        state.isEmpty) {
      return null;
    }
    return PendingAddHostLogin(
      origin: origin,
      label: label,
      state: state,
      createdAtMs: createdAtMs is int
          ? createdAtMs
          : (createdAtMs is num ? createdAtMs.toInt() : 0),
    );
  }
}

/// Secure-storage-backed persistence for the single in-flight
/// [PendingAddHostLogin]. At most one add-host login is pending at a time; a new
/// [save] overwrites any previous record.
class PendingAddHostLoginStore {
  PendingAddHostLoginStore(
    this._storage, {
    Duration ttl = const Duration(minutes: 10),
    DateTime Function()? clock,
  })  : _ttl = ttl,
        _clock = clock ?? DateTime.now;

  final SecureStoragePort _storage;
  final Duration _ttl;
  final DateTime Function() _clock;

  /// Fixed namespace/key under which the single pending record lives. Chosen to
  /// not collide with the `host.<id>` / `workspace.<id>` / legacy `server.<id>`
  /// namespaces used elsewhere.
  static const _namespace = '__pending__';
  static const _key = 'add_host_login';

  Future<void> save(PendingAddHostLogin pending) =>
      _storage.write(_namespace, _key, jsonEncode(pending.toJson()));

  /// Read the pending record, or `null` when there is none, it is malformed, or
  /// it has expired past the [ttl] (an expired record is cleared as a side
  /// effect so it can't shadow a later attempt).
  Future<PendingAddHostLogin?> read() async {
    final raw = await _storage.read(_namespace, _key);
    if (raw == null || raw.isEmpty) return null;
    PendingAddHostLogin? pending;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        pending = PendingAddHostLogin.fromJson(decoded);
      }
    } catch (_) {
      pending = null;
    }
    if (pending == null) {
      await clear();
      return null;
    }
    final ageMs = _clock().millisecondsSinceEpoch - pending.createdAtMs;
    if (ageMs > _ttl.inMilliseconds) {
      await clear();
      return null;
    }
    return pending;
  }

  Future<void> clear() => _storage.delete(_namespace, _key);
}
