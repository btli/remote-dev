/// Base error type for all application errors.
/// Carries a machine-readable [code] for error handling and a human-readable [message].
sealed class AppError implements Exception {
  const AppError(this.message, {this.code});

  final String message;
  final String? code;

  @override
  String toString() => 'AppError($code: $message)';
}

/// Authentication failed or session expired.
class AuthError extends AppError {
  const AuthError(super.message, {super.code});
}

/// Network request failed (timeout, DNS, connection refused).
class NetworkError extends AppError {
  const NetworkError(super.message, {super.code});
}

/// Server returned an error response (4xx/5xx).
class ApiError extends AppError {
  const ApiError(super.message, {super.code, required this.statusCode});
  final int statusCode;
}

/// Resource not found (404).
class NotFoundError extends AppError {
  const NotFoundError(super.message, {super.code});
}

/// WebSocket connection error.
class ConnectionError extends AppError {
  const ConnectionError(super.message, {super.code, this.closeCode});
  final int? closeCode;
}

/// Result type for use case return values.
/// Prevents throwing across layer boundaries.
sealed class Result<T> {
  const Result();

  bool get isSuccess => this is Success<T>;
  bool get isFailure => this is Failure<T>;

  T get valueOrThrow => switch (this) {
        Success(:final value) => value,
        Failure(:final error) => throw error,
      };

  T? get valueOrNull => switch (this) {
        Success(:final value) => value,
        Failure() => null,
      };

  AppError? get errorOrNull => switch (this) {
        Success() => null,
        Failure(:final error) => error,
      };
}

final class Success<T> extends Result<T> {
  const Success(this.value);
  final T value;
}

final class Failure<T> extends Result<T> {
  const Failure(this.error);
  final AppError error;
}
