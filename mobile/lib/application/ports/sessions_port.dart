import '../../domain/session_summary.dart';

abstract class SessionsPort {
  Future<List<SessionSummary>> list();
  Future<void> suspend(String id);
  Future<void> close(String id);
  Future<SessionSummary> create({
    required String name,
    required String terminalType,
    String? projectId,
    String? initialCommand,
    String? agentProvider,
    bool? autoLaunchAgent,
  });
}
