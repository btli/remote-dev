import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/state/clipboard_access_readiness_provider.dart';

void main() {
  test('clipboard access readiness fails closed and changes synchronously', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    expect(container.read(clipboardAccessReadyProvider), isFalse);

    container.read(clipboardAccessReadyProvider.notifier).markReady();
    expect(container.read(clipboardAccessReadyProvider), isTrue);

    container.read(clipboardAccessReadyProvider.notifier).markUnavailable();
    expect(container.read(clipboardAccessReadyProvider), isFalse);
  });
}
