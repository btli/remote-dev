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

  // Regression: the input bar lives in a FIXED 56px slot and the parent
  // (session_view_screen.dart) ALREADY reserves the bottom safe-area inset for
  // the whole floating chrome (bottomReserve = max(keyboardInset, padding.bottom),
  // Positioned(bottom: bottomReserve)). The bar must therefore NOT re-apply
  // MediaQuery.padding.bottom itself — a SafeArea inside the bar double-counted the
  // inset and, with the keyboard DOWN (padding.bottom = full safe area), crushed
  // the TextField to ~0 height inside its 56px slot. That is the "input field too
  // small on session load" bug (worst on devices with a tall bottom inset, e.g. the
  // Android 3-button nav bar / Pixel Fold). We assert the field height does NOT
  // depend on padding.bottom.
  testWidgets(
    'input field height is independent of the bottom safe-area inset '
    '(keyboard down) — not crushed by a double-counted inset',
    (tester) async {
      // inputBarHeight from session_view_screen.dart's chrome layout.
      const inputBarHeight = 56.0;

      // Keyboard DOWN: viewInsets.bottom = 0, so the framework floor makes
      // padding.bottom == viewPadding.bottom. We mount the bar in the exact 56px
      // slot the parent gives it; the SizedBox(width: 400) below pins the bar's
      // width so the test is independent of the flutter_test surface size.
      Widget framed(double padBottom) => MaterialApp(
            home: Scaffold(
              // The real screen owns its layout and never lets the Scaffold reflow
              // on the keyboard; mirror that so only our injected padding matters.
              resizeToAvoidBottomInset: false,
              body: MediaQuery(
                data: MediaQueryData(
                  viewPadding: EdgeInsets.only(bottom: padBottom),
                  padding: EdgeInsets.only(bottom: padBottom),
                ),
                child: Align(
                  alignment: Alignment.bottomCenter,
                  child: SizedBox(
                    height: inputBarHeight,
                    width: 400,
                    child: MobileInputBar(onSend: (_) {}),
                  ),
                ),
              ),
            ),
          );

      await tester.pumpWidget(framed(0));
      await tester.pumpAndSettle();
      final heightNoInset = tester.getSize(find.byType(TextField)).height;

      // A tall, realistic keyboard-down inset (Android 3-button system nav bar).
      await tester.pumpWidget(framed(48));
      await tester.pumpAndSettle();
      final heightWithInset = tester.getSize(find.byType(TextField)).height;

      // Sanity: with no inset the field occupies a substantial part of the 56px
      // slot (Container padding is 12px total → ~44px available). If this is tiny,
      // the test's framing is wrong, not the widget.
      expect(
        heightNoInset,
        greaterThan(30),
        reason:
            'Baseline field height should fill most of the 56px slot; got '
            '$heightNoInset.',
      );
      // The actual regression assertion: the bottom inset must NOT change the
      // field height. Before the fix the inner SafeArea ate 48px of the 56px slot
      // and this collapsed to ~0.
      expect(
        heightWithInset,
        closeTo(heightNoInset, 0.5),
        reason:
            'The input field height must NOT depend on the bottom safe-area inset '
            '— the parent already reserves it. A SafeArea inside the bar '
            'double-counts the inset and crushes the field when the keyboard is '
            'down. Found $heightNoInset (no inset) vs $heightWithInset (48px '
            'inset).',
      );
    },
  );
}
