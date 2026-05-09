import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/smart_key_strip.dart';

void main() {
  Widget wrap(SmartKeyHandler handler) => MaterialApp(
        home: Scaffold(body: SmartKeyStrip(onKeyPress: handler)),
      );

  testWidgets('renders all 13 keys', (tester) async {
    await tester.pumpWidget(wrap((_, __) {}));
    await tester.pumpAndSettle();
    for (final label in [
      'Esc',
      'Tab',
      'Ctrl',
      'Alt',
      'Shift',
      '↑',
      '↓',
      '←',
      '→',
      'PgUp',
      'PgDn',
      'Home',
      'End',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'missing $label');
    }
  });

  testWidgets("tap Tab fires onKeyPress('Tab', {})", (tester) async {
    String? captured;
    Map<String, bool>? mods;
    await tester.pumpWidget(
      wrap((name, m) {
        captured = name;
        mods = m;
      }),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tab'));
    expect(captured, 'Tab');
    expect(mods, isEmpty);
  });

  testWidgets('Ctrl single-shot is consumed by next key', (tester) async {
    final keys = <String>[];
    final modsLog = <Map<String, bool>>[];
    await tester.pumpWidget(
      wrap((name, m) {
        keys.add(name);
        modsLog.add(Map.of(m));
      }),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ctrl'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tab'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tab')); // second tap — Ctrl already consumed

    expect(keys, ['Tab', 'Tab']);
    expect(modsLog[0], {'ctrl': true});
    expect(modsLog[1], isEmpty);
  });

  testWidgets('Ctrl double-tap locks', (tester) async {
    final modsLog = <Map<String, bool>>[];
    await tester.pumpWidget(wrap((_, m) => modsLog.add(Map.of(m))));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Ctrl'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ctrl')); // now locked
    await tester.pumpAndSettle();
    await tester.tap(find.text('Tab'));
    await tester.tap(find.text('Tab')); // still locked

    expect(modsLog, [
      {'ctrl': true},
      {'ctrl': true},
    ]);
  });
}
