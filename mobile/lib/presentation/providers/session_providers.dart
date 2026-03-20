import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:remote_dev/domain/entities/session.dart';
import 'package:remote_dev/domain/repositories/session_repository.dart';
import 'package:remote_dev/infrastructure/api/repositories/api_session_repository.dart';
import 'package:remote_dev/presentation/providers/server_config_providers.dart';

/// Session repository backed by the API client.
final sessionRepositoryProvider = Provider<SessionRepository?>((ref) {
  final client = ref.watch(remoteDevClientProvider);
  if (client == null) return null;
  return ApiSessionRepository(client: client);
});

/// Async list of sessions, auto-refreshed when the repository changes.
class SessionListNotifier extends AsyncNotifier<List<Session>> {
  @override
  Future<List<Session>> build() async {
    final repo = ref.watch(sessionRepositoryProvider);
    if (repo == null) return [];
    final result = await repo.findAll();
    return result.valueOrThrow;
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() => build());
  }

  Future<Session?> createSession(CreateSessionInput input) async {
    final repo = ref.read(sessionRepositoryProvider);
    if (repo == null) return null;
    final result = await repo.create(input);
    final session = result.valueOrNull;
    if (session != null) {
      state = AsyncValue.data([...state.valueOrNull ?? [], session]);
    }
    return session;
  }

  Future<void> suspendSession(String id) async {
    final repo = ref.read(sessionRepositoryProvider);
    if (repo == null) return;
    final result = await repo.suspend(id);
    if (result.isSuccess) await refresh();
  }

  Future<void> resumeSession(String id) async {
    final repo = ref.read(sessionRepositoryProvider);
    if (repo == null) return;
    final result = await repo.resume(id);
    if (result.isSuccess) await refresh();
  }

  Future<void> closeSession(String id) async {
    final repo = ref.read(sessionRepositoryProvider);
    if (repo == null) return;
    final result = await repo.close(id);
    if (result.isSuccess) {
      state = AsyncValue.data(
        (state.valueOrNull ?? []).where((s) => s.id != id).toList(),
      );
    }
  }
}

final sessionListProvider =
    AsyncNotifierProvider<SessionListNotifier, List<Session>>(
  SessionListNotifier.new,
);

/// Currently selected session ID.
final activeSessionIdProvider = StateProvider<String?>((ref) => null);

/// Derived provider for the currently active session object.
final activeSessionProvider = Provider<Session?>((ref) {
  final activeId = ref.watch(activeSessionIdProvider);
  if (activeId == null) return null;
  final sessions = ref.watch(sessionListProvider).valueOrNull;
  return sessions?.firstWhereOrNull((s) => s.id == activeId);
});
