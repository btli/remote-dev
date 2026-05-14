import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/smart_key_strip.dart';

void main() {
  Widget wrap(SmartKeyHandler handler) => MaterialApp(
        home: Scaffold(body: SmartKeyStrip(onKeyPress: handler)),
      );

  // Adapter for tests that only care about (name, mods). Drops the
  // optional `bytes` arg the new SmartKeyHandler exposes for composed
  // sequences (^C, ^D, shell punctuation, ⇧↵).
  SmartKeyHandler nameMods(void Function(String, Map<String, bool>) cb) {
    return (name, mods, {String? bytes}) => cb(name, mods);
  }

  testWidgets('renders the original 13-key set in default (keys) mode',
      (tester) async {
    await tester.pumpWidget(wrap(nameMods((_, __) {})));
    await tester.pumpAndSettle();
    // Default mode = keys; ESC, Tab, modifiers, and the punctuation row
    // are visible. Nav arrows + PgUp/PgDn/Home/End are behind the
    // NAV mode toggle and asserted in the mode-switch test below.
    for (final label in [
      'Esc',
      'Tab',
      'Ctrl',
      'Alt',
      'Shift',
      '^C',
      '^D',
      '|',
      '/',
      '~',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'missing $label');
    }
  });

  testWidgets("tap Tab fires onKeyPress('Tab', {})", (tester) async {
    String? captured;
    Map<String, bool>? mods;
    await tester.pumpWidget(
      wrap(
        nameMods((name, m) {
          captured = name;
          mods = m;
        }),
      ),
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
      wrap(
        nameMods((name, m) {
          keys.add(name);
          modsLog.add(Map.of(m));
        }),
      ),
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
    await tester.pumpWidget(
      wrap(nameMods((_, m) => modsLog.add(Map.of(m)))),
    );
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

  testWidgets('^C dispatches as raw bytes', (tester) async {
    String? capturedName;
    String? capturedBytes;
    await tester.pumpWidget(
      wrap((name, _, {String? bytes}) {
        capturedName = name;
        capturedBytes = bytes;
      }),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('^C'));
    expect(capturedName, '__bytes__');
    expect(capturedBytes, '\x03');
  });

  testWidgets('NAV toggle reveals arrows + page nav keys', (tester) async {
    await tester.pumpWidget(wrap(nameMods((_, __) {})));
    await tester.pumpAndSettle();
    // Tap the mode toggle (labelled "NAV" while in keys mode).
    await tester.tap(find.text('NAV'));
    await tester.pumpAndSettle();
    for (final label in [
      '↑',
      '↓',
      '←',
      '→',
      'PgUp',
      'PgDn',
      'Home',
      'End',
      'Enter',
      '⇧↵',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'missing $label in NAV');
    }
    // Now switching back hides them again.
    await tester.tap(find.text('KEYS'));
    await tester.pumpAndSettle();
    expect(find.text('PgUp'), findsNothing);
  });
}
