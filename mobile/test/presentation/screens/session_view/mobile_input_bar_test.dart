import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/mobile_input_bar.dart';

void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('renders TextField + send button', (tester) async {
    await tester.pumpWidget(wrap(MobileInputBar(onSend: (_) {})));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);
    expect(find.byIcon(Icons.send), findsOneWidget);
  });

  testWidgets('send button disabled while field is empty', (tester) async {
    await tester.pumpWidget(wrap(MobileInputBar(onSend: (_) {})));
    await tester.pumpAndSettle();
    final btn = tester.widget<IconButton>(find.byType(IconButton));
    expect(btn.onPressed, isNull);
  });

  testWidgets('typing text enables the send button', (tester) async {
    await tester.pumpWidget(wrap(MobileInputBar(onSend: (_) {})));
    await tester.enterText(find.byType(TextField), 'ls');
    await tester.pumpAndSettle();
    final btn = tester.widget<IconButton>(find.byType(IconButton));
    expect(btn.onPressed, isNotNull);
  });

  testWidgets('tap send fires onSend with the field text and clears', (tester) async {
    String? sent;
    await tester.pumpWidget(wrap(MobileInputBar(onSend: (s) => sent = s)));
    await tester.enterText(find.byType(TextField), 'echo hello');
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();
    expect(sent, 'echo hello');
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '');
  });

  testWidgets('Enter submits the field', (tester) async {
    String? sent;
    await tester.pumpWidget(wrap(MobileInputBar(onSend: (s) => sent = s)));
    await tester.enterText(find.byType(TextField), 'pwd');
    await tester.testTextInput.receiveAction(TextInputAction.send);
    await tester.pumpAndSettle();
    expect(sent, 'pwd');
  });

  testWidgets('long-press on send button calls onPasteWithoutExecute', (tester) async {
    // The paste-without-execute affordance is a long-press on the send
    // button. Long-press on the TextField itself is reserved for the OS
    // text-selection / clipboard menu (preserving native behavior).
    var called = false;
    await tester.pumpWidget(
      wrap(
        MobileInputBar(
          onSend: (_) {},
          onPasteWithoutExecute: (setText) async {
            called = true;
            setText('clip-text');
          },
        ),
      ),
    );
    await tester.longPress(find.byIcon(Icons.send));
    await tester.pumpAndSettle();
    expect(called, isTrue);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      contains('clip-text'),
    );
  });
}
