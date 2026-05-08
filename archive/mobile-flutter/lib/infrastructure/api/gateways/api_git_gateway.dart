import 'package:remote_dev/application/ports/git_gateway.dart';
import 'package:remote_dev/domain/errors/app_error.dart';
import 'package:remote_dev/infrastructure/api/remote_dev_client.dart';

/// API-backed implementation of [GitGateway].
class ApiGitGateway implements GitGateway {
  ApiGitGateway({required RemoteDevClient client}) : _client = client;
  final RemoteDevClient _client;

  @override
  Future<Result<GitValidationResult>> validateAndListBranches(
    String path,
  ) async {
    try {
      final data = await _client.validateGitPath(path);
      return Success(
        GitValidationResult(
          isGitRepo: data['isGitRepo'] as bool? ?? false,
          branches: (data['branches'] as List?)?.cast<String>() ?? [],
        ),
      );
    } on AppError catch (e) {
      return Failure(e);
    } on Object catch (e) {
      return Failure(
        ApiError(
          'Failed to validate git path: $e',
          code: 'PARSE_ERROR',
          statusCode: 0,
        ),
      );
    }
  }
}
