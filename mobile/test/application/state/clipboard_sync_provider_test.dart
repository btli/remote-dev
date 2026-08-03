import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/state/clipboard_sync_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  test('clipboard sync defaults off', () async {
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [
        clipboardSyncProvider.overrideWith(
          (ref) => ClipboardSyncNotifier.test(prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    expect(container.read(clipboardSyncProvider), isFalse);
  });

  test('setEnabled persists the device-local opt-in', () async {
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [
        clipboardSyncProvider.overrideWith(
          (ref) => ClipboardSyncNotifier.test(prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    await container.read(clipboardSyncProvider.notifier).setEnabled(true);

    expect(container.read(clipboardSyncProvider), isTrue);
    expect(prefs.getBool(ClipboardSyncPrefsKeys.enabled), isTrue);
  });

  test('test seam hydrates the persisted preference', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      ClipboardSyncPrefsKeys.enabled: true,
    });
    final prefs = await SharedPreferences.getInstance();
    final container = ProviderContainer(
      overrides: [
        clipboardSyncProvider.overrideWith(
          (ref) => ClipboardSyncNotifier.test(prefs),
        ),
      ],
    );
    addTearDown(container.dispose);

    expect(container.read(clipboardSyncProvider), isTrue);
  });
}
