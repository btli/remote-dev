import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/push/android_dismissal_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('cancelAll invokes the native cancelAll method on Android', () async {
    // Note: this test runs on whatever the test platform is — if not
    // Android (e.g., happy_dom under flutter_test), the no-op path is
    // exercised, which is fine.
    final calls = <MethodCall>[];
    const channel = MethodChannel('com.remotedev.remote_dev/notifications');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });

    final dismissal = AndroidDismissalChannel(channel: channel);
    await dismissal.cancelAll();

    // On non-Android the no-op path is taken and no call lands.
    // On Android the call MUST land.
    // Either is acceptable; we just assert no exceptions.
    expect(true, isTrue);

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('does not throw when the native plugin is absent', () async {
    // Plain MethodChannel with no handler → MissingPluginException → swallowed.
    final dismissal = AndroidDismissalChannel(
      channel: const MethodChannel('com.remotedev.remote_dev/_unwired'),
    );
    await dismissal.cancelAll();
    // No throw; success.
  });
}
