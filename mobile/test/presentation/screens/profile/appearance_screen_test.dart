import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/state/appearance_provider.dart';
import 'package:remote_dev/domain/appearance_settings.dart';
import 'package:remote_dev/presentation/screens/profile/appearance_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

Future<ProviderContainer> _pump(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    overrides: [
      appearanceSettingsProvider.overrideWith(
        (ref) => AppearanceNotifier.test(prefs),
      ),
    ],
  );
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: AppearanceScreen()),
    ),
  );
  return container;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders title and all three controls', (tester) async {
    final container = await _pump(tester);
    addTearDown(container.dispose);

    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Font scale'), findsOneWidget);
    expect(find.text('Reduce motion'), findsOneWidget);
    expect(find.text('Cursor blink'), findsOneWidget);
    expect(find.byType(Slider), findsOneWidget);
    expect(find.byType(SwitchListTile), findsNWidgets(2));
  });

  testWidgets('defaults match AppearanceSettings defaults', (tester) async {
    final container = await _pump(tester);
    addTearDown(container.dispose);

    final state = container.read(appearanceSettingsProvider);
    expect(state.fontScale, AppearanceSettings.defaultFontScale);
    expect(state.reduceMotion, isFalse);
    expect(state.cursorBlink, isTrue);

    // Default switch states reflect those values in the UI.
    final reduceMotion = tester.widget<SwitchListTile>(
      find.descendant(
        of: find.byKey(const Key('appearance.reduceMotion')),
        matching: find.byType(SwitchListTile),
      ),
    );
    expect(reduceMotion.value, isFalse);

    final cursorBlink = tester.widget<SwitchListTile>(
      find.descendant(
        of: find.byKey(const Key('appearance.cursorBlink')),
        matching: find.byType(SwitchListTile),
      ),
    );
    expect(cursorBlink.value, isTrue);
  });

  testWidgets('toggling reduce motion writes to provider state',
      (tester) async {
    final container = await _pump(tester);
    addTearDown(container.dispose);

    expect(
      container.read(appearanceSettingsProvider).reduceMotion,
      isFalse,
    );

    await tester.tap(find.byKey(const Key('appearance.reduceMotion')));
    await tester.pumpAndSettle();

    expect(
      container.read(appearanceSettingsProvider).reduceMotion,
      isTrue,
    );
  });

  testWidgets('toggling cursor blink writes to provider state',
      (tester) async {
    final container = await _pump(tester);
    addTearDown(container.dispose);

    expect(
      container.read(appearanceSettingsProvider).cursorBlink,
      isTrue,
    );

    await tester.tap(find.byKey(const Key('appearance.cursorBlink')));
    await tester.pumpAndSettle();

    expect(
      container.read(appearanceSettingsProvider).cursorBlink,
      isFalse,
    );
  });

  testWidgets('dragging the slider updates the font scale', (tester) async {
    final container = await _pump(tester);
    addTearDown(container.dispose);

    final initial = container.read(appearanceSettingsProvider).fontScale;
    expect(initial, AppearanceSettings.defaultFontScale);

    // Drag right to increase scale. The exact magnitude depends on layout
    // but a positive drag must monotonically increase font scale.
    await tester.drag(
      find.byKey(const Key('appearance.fontScale')),
      const Offset(200, 0),
    );
    await tester.pumpAndSettle();

    final after = container.read(appearanceSettingsProvider).fontScale;
    expect(after, greaterThan(initial));
    expect(
      after,
      lessThanOrEqualTo(AppearanceSettings.maxFontScale),
    );
  });
}
