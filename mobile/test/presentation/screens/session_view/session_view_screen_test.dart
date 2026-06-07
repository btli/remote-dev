// Smoke tests for SessionViewScreen.
//
// The real InAppWebView platform plugin is not available under the
// flutter_test renderer, so we cannot drive the bridge round-trip.
// We assert what we can:
//   1. The screen mounts in a Scaffold without throwing during the
//      first frame.
//   2. The keyed `webview-frame` SizedBox SHRINKS by the keyboard inset
//      when the soft keyboard rises — this is what triggers a
//      visualViewport resize inside xterm.js, which in turn refits the
//      grid and reflows tmux. (See `EmbeddedSessionView` + Terminal.tsx
//      `visualViewport` listener.)
//
// We suppress the expected `InAppWebViewPlatform.instance != null`
// assertion the same way `bridge_spike/keyboard_layout_test` does.
//
// Further regression tests (remote-dev-u5q5.1) pin the bottom-inset reserve
// `bottomReserve = max(keyboardInset, padding.bottom)` from both sides:
//   - WebView height reserves it — a 2-case loop over the two phone insets
//     (iOS home indicator 34, Android 3-button nav bar 48) plus a standalone
//     tablet/unfolded case (24 on a 1280x800 surface, proving the math is
//     geometry-independent);
//   - the floating chrome's bottom OFFSET equals it, so the chrome's top edge
//     is flush with the WebView's bottom edge (keyboard down AND up);
//   - it is read from `paddingOf`, not `viewPaddingOf` (a mid-dismissal fixture
//     where the two differ pins this exactly);
//   - it does NOT double-subtract when the keyboard is up; and
//   - it is continuous across the keyboard-dismiss crossover.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/domain/session_summary.dart';
import 'package:remote_dev/presentation/screens/session_view/activity_pip.dart';
import 'package:remote_dev/presentation/screens/session_view/session_view_screen.dart';
import 'package:remote_dev/presentation/screens/session_view/smart_key_strip.dart';

void main() {
  testWidgets('SessionViewScreen mounts in a Scaffold', (tester) async {
    final originalOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
        return;
      }
      originalOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = originalOnError);

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: SessionViewScreen(sessionId: 'test-session'),
        ),
      ),
    );
    // Don't pumpAndSettle — InAppWebView creates platform channels we
    // can't fulfill. A bounded number of pumps flushes the FutureBuilder
    // microtasks for the active-server lookup.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }

    expect(find.byType(Scaffold), findsAtLeast(1));
  });

  testWidgets(
    'seeds the status-bar pip from the initial summary activity',
    (tester) async {
      final originalOnError = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      // A session opened mid-subagent-run must show its real activity at once,
      // not flash 'Idle' until the next live hook transition (remote-dev-sguu).
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            home: SessionViewScreen(
              sessionId: 'test-session',
              initialSummary: const SessionSummary(
                id: 'test-session',
                name: 'Mid-run',
                tmuxSessionName: 'rdv-test-session',
                status: SessionStatus.active,
                activity: AgentActivityStatus.subagent,
              ),
            ),
          ),
        ),
      );
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      // The pip is the violet (subagent) circle, seeded before any onActivity
      // bridge transition fires.
      final pipFinder = find.byWidgetPredicate((w) {
        if (w is! Container) return false;
        final dec = w.decoration;
        if (dec is! BoxDecoration) return false;
        return dec.shape == BoxShape.circle &&
            dec.color == const Color(0xFFBB9AF7);
      });
      expect(pipFinder, findsOneWidget);
      expect(find.byType(ActivityPip), findsOneWidget);
    },
  );

  // This test injects NO bottom safe area, so its assertion (shrink-by-inset)
  // holds under BOTH the old `- keyboardInset` formula and the new
  // `- max(keyboardInset, padding.bottom)` one — it is NOT what guards the
  // safe-area fix (the `framedWithPad` suite below does that). What it DOES pin
  // is the keyboard-tracking half of the invariant: the WebView must still
  // shrink one-for-one with the keyboard inset (so xterm.js fires a
  // visualViewport resize and tmux reflows), guarding against a regression to a
  // fixed-height WebView like the one fixed in 6d12cc7e.
  testWidgets(
    'webview-frame shrinks by keyboard inset when keyboard rises',
    (tester) async {
      final originalOnError = FlutterError.onError;
      FlutterError.onError = (details) {
        if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
          return;
        }
        originalOnError?.call(details);
      };
      addTearDown(() => FlutterError.onError = originalOnError);

      Widget framed(double keyboardInset) => ProviderScope(
            child: MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(400, 800),
                  viewInsets: EdgeInsets.only(bottom: keyboardInset),
                ),
                child: const SessionViewScreen(sessionId: 'test-session'),
              ),
            ),
          );

      await tester.pumpWidget(framed(0));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }

      final keyFinder = find.byKey(const Key('webview-frame'));
      if (keyFinder.evaluate().isEmpty) {
        markTestSkipped(
          'SessionViewScreen did not render the keyed SizedBox under '
          'the test renderer. Manual verification required on devices.',
        );
        return;
      }
      final size0 = tester.getSize(keyFinder);

      const inset = 300.0;
      await tester.pumpWidget(framed(inset));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      final sizeKeyboard = tester.getSize(keyFinder);

      expect(
        sizeKeyboard.height,
        closeTo(size0.height - inset, 0.5),
        reason:
            'WebView MUST shrink by the keyboard inset so xterm.js fires '
            'a visualViewport resize and tmux reflows. Found '
            '${size0.height} → ${sizeKeyboard.height} (expected ~'
            '${size0.height - inset}).',
      );
    },
  );

  // Regression for remote-dev-u5q5.1: the floating chrome (smart keys + input
  // bar) is pinned at `Positioned(bottom: bottomReserve)` and the WebView gives
  // up that same `bottomReserve = max(keyboardInset, padding.bottom)`, so the
  // chrome's top edge meets the WebView's bottom edge flush. Before the fix the
  // WebView subtracted only `keyboardInset`, so with the keyboard DOWN the
  // chrome (lifted by a `SafeArea`) covered the bottom 1-3 terminal rows.
  //
  // DEVICE FIDELITY: on a real device `MediaQueryData.padding` is the framework-
  // computed `max(viewPadding - viewInsets, 0)` (see MediaQueryData.fromView).
  // So `viewInsets` and `padding` are NOT independent — when the keyboard is up
  // (large `viewInsets`) the bottom `padding` is floored to 0 even though the
  // home-indicator `viewPadding` is still 34. `MediaQueryData`'s constructor,
  // however, takes all three as independent fields (none is auto-derived), so we
  // must set them BY HAND to a physically-possible triple, or the test would
  // assert behaviour against an impossible MediaQuery. We mirror the framework's
  // floor in [framedWithPad].
  //
  // RENDERER NOTE: the `flutter_test` surface (default 800x600, overridable via
  // `tester.view.physicalSize`) lays out the screen, NOT `MediaQuery.size`, so
  // the WebView's ABSOLUTE height is not predictable from the injected
  // MediaQuery. What IS predictable — and is exactly what the fix changes — is
  // how the height responds to the bottom safe area. So each test pumps the SAME
  // keyboard state twice (safe-area inset present vs absent) and asserts the
  // DELTA:
  //   - keyboard DOWN: an Npx safe area must SHRINK the WebView by exactly N
  //     (reserve = max(0, N) = N) so the strip sits flush below it — verified
  //     across the realistic spectrum (34/48/24) and on a tablet surface below.
  //     (Reverting to the old `- keyboardInset` formula ignores padding
  //     entirely → delta 0 → these tests fail, which is the point.)
  //   - keyboard UP:   the same safe area must change NOTHING, because
  //     `padding.bottom` is floored to 0 under the keyboard so reserve =
  //     max(300, 0) = 300 either way — i.e. no double-subtraction.
  const bottomPadding = 34.0; // iOS home indicator (used by the keyboard-up case)

  // Shared FlutterError.onError save/restore for the bottom-inset regression
  // tests below (the InAppWebView platform plugin is absent under flutter_test
  // and asserts on construction). The three pre-existing tests above (mount,
  // pip-seed, keyboard-shrink) keep their own inline copies untouched.
  void suppressWebViewPlatformError(WidgetTester tester) {
    final originalOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('InAppWebViewPlatform')) {
        return;
      }
      originalOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = originalOnError);
  }

  // Builds the screen under a MediaQuery whose bottom `padding` mirrors the
  // framework floor `max(viewPadding - viewInsets, 0)`, so every triple we feed
  // the screen is one a real device could actually report.
  Widget framedWithPad({
    required double keyboardInset,
    required double viewPaddingBottom,
  }) {
    final paddingBottom = math.max(viewPaddingBottom - keyboardInset, 0.0);
    return ProviderScope(
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(400, 800),
            viewInsets: EdgeInsets.only(bottom: keyboardInset),
            viewPadding: EdgeInsets.only(bottom: viewPaddingBottom),
            // `padding` is what the screen reads via `MediaQuery.paddingOf`;
            // keep it consistent with the (viewInsets, viewPadding) pair.
            padding: EdgeInsets.only(bottom: paddingBottom),
          ),
          child: const SessionViewScreen(sessionId: 'test-session'),
        ),
      ),
    );
  }

  Future<double?> frameHeight(
    WidgetTester tester, {
    required double keyboardInset,
    required double viewPaddingBottom,
  }) async {
    await tester.pumpWidget(
      framedWithPad(
        keyboardInset: keyboardInset,
        viewPaddingBottom: viewPaddingBottom,
      ),
    );
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    final keyFinder = find.byKey(const Key('webview-frame'));
    if (keyFinder.evaluate().isEmpty) return null;
    return tester.getSize(keyFinder).height;
  }

  // Pumps a config and returns the WebView frame's bottom edge alongside the
  // floating chrome block's top edge (the top of `SmartKeyStrip`, the first
  // child of the chrome Column inside the Positioned). Used to assert the OTHER
  // half of the invariant: the chrome's bottom OFFSET equals `bottomReserve`, so
  // its top edge lands flush on the WebView's bottom edge. Returns null if
  // either widget did not render under the test renderer.
  Future<({double webviewBottom, double chromeTop})?> frameAndChromeEdges(
    WidgetTester tester, {
    required double keyboardInset,
    required double viewPaddingBottom,
  }) async {
    await tester.pumpWidget(
      framedWithPad(
        keyboardInset: keyboardInset,
        viewPaddingBottom: viewPaddingBottom,
      ),
    );
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 16));
    }
    final webviewFinder = find.byKey(const Key('webview-frame'));
    final chromeFinder = find.byType(SmartKeyStrip);
    if (webviewFinder.evaluate().isEmpty || chromeFinder.evaluate().isEmpty) {
      return null;
    }
    return (
      webviewBottom: tester.getRect(webviewFinder).bottom,
      chromeTop: tester.getRect(chromeFinder).top,
    );
  }

  // The bottom safe area takes several real-world values, ALL of which surface
  // as `MediaQuery.padding.bottom` and so MUST be reserved identically by the
  // `max(keyboardInset, padding.bottom)` formula (keyboard down → inset is 0 →
  // reserve == the padding). We parametrize the keyboard-down reservation test
  // over the realistic spectrum:
  //   - 34 → iOS home indicator (notch/Face-ID phones)
  //   - 48 → Android 3-button system navigation bar (the "system keys" bar the
  //          user suspected; the tallest common inset, and the worst cutoff)
  //   - 24 → tablet / unfolded gesture inset, asserted under a large 1280x800
  //          logical surface to prove the reservation is geometry-independent
  //          (phones, tablets, foldables unfolded all reserve the same way).
  const reservationCases = <({String label, double padBottom})>[
    (label: 'iOS home indicator', padBottom: 34.0),
    (label: 'Android 3-button system nav bar', padBottom: 48.0),
  ];

  for (final c in reservationCases) {
    testWidgets(
      'webview-frame reserves bottom safe-area inset when keyboard is down '
      '(${c.label}, ${c.padBottom}px)',
      (tester) async {
        suppressWebViewPlatformError(tester);

        // Keyboard down (viewInsets 0): padding.bottom == viewPadding.bottom.
        final noPad =
            await frameHeight(tester, keyboardInset: 0, viewPaddingBottom: 0);
        final withPad = await frameHeight(
          tester,
          keyboardInset: 0,
          viewPaddingBottom: c.padBottom,
        );
        if (noPad == null || withPad == null) {
          markTestSkipped(
            'SessionViewScreen did not render the keyed SizedBox under '
            'the test renderer. Manual verification required on devices.',
          );
          return;
        }
        expect(
          withPad,
          closeTo(noPad - c.padBottom, 0.5),
          reason:
              'With the keyboard down, a ${c.padBottom}px bottom safe area '
              '(${c.label}) MUST shrink the WebView by exactly ${c.padBottom} '
              '(reserve = max(0, ${c.padBottom})) so the floating smart-key '
              'strip sits flush below it instead of covering the bottom '
              'terminal rows. Found $noPad → $withPad '
              '(expected ${noPad - c.padBottom}).',
        );
      },
    );
  }

  testWidgets(
    'webview-frame reserves bottom inset on a tablet/unfolded surface '
    '(1280x800, 24px gesture inset)',
    (tester) async {
      suppressWebViewPlatformError(tester);

      // Tablet / unfolded geometry: drive the actual layout surface large (the
      // flutter_test renderer lays out against `tester.view.physicalSize`, NOT
      // the injected `MediaQuery.size`), then assert the SAME 24px reservation
      // holds. This proves the math is geometry-independent — a bigger screen
      // doesn't change how much bottom inset the chrome needs reserved.
      const tabletPadBottom = 24.0;
      tester.view.physicalSize = const Size(1280, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final noPad =
          await frameHeight(tester, keyboardInset: 0, viewPaddingBottom: 0);
      final withPad = await frameHeight(
        tester,
        keyboardInset: 0,
        viewPaddingBottom: tabletPadBottom,
      );
      if (noPad == null || withPad == null) {
        markTestSkipped(
          'SessionViewScreen did not render the keyed SizedBox under '
          'the test renderer. Manual verification required on devices.',
        );
        return;
      }
      expect(
        withPad,
        closeTo(noPad - tabletPadBottom, 0.5),
        reason:
            'On a 1280x800 tablet/unfolded surface, a ${tabletPadBottom}px '
            'gesture inset MUST still shrink the WebView by exactly '
            '$tabletPadBottom — the reservation is geometry-independent. Found '
            '$noPad → $withPad (expected ${noPad - tabletPadBottom}).',
      );
    },
  );

  // The reservation tests above pin ONE half of the invariant (the WebView
  // gives up `bottomReserve`). This pins the OTHER half: the chrome's bottom
  // offset is ALSO `bottomReserve`, so the chrome's top edge lands flush on the
  // WebView's bottom edge — no overlap (which hid terminal rows), no gap. A
  // future refactor that wires the wrong variable into `Positioned(bottom:)`
  // (e.g. reverting to `keyboardInset` while the WebView keeps reserving the
  // max) would leave the height assertions green but fail this flushness check.
  // Verified with the keyboard DOWN (reserve = safe area) and UP (reserve =
  // keyboard inset) so both arms of the max() are exercised.
  for (final kb in const <({String label, double inset, double viewPad})>[
    (label: 'keyboard down (reserve = safe area)', inset: 0, viewPad: 34),
    (label: 'keyboard up (reserve = keyboard inset)', inset: 300, viewPad: 34),
  ]) {
    testWidgets(
      'chrome top edge is flush with the WebView bottom edge — ${kb.label}',
      (tester) async {
        suppressWebViewPlatformError(tester);

        final edges = await frameAndChromeEdges(
          tester,
          keyboardInset: kb.inset,
          viewPaddingBottom: kb.viewPad,
        );
        if (edges == null) {
          markTestSkipped(
            'SessionViewScreen did not render the webview-frame and/or '
            'SmartKeyStrip under the test renderer. Manual verification '
            'required on devices.',
          );
          return;
        }
        expect(
          edges.chromeTop,
          closeTo(edges.webviewBottom, 0.5),
          reason:
              'The floating chrome must sit flush below the WebView: its top '
              'edge (${edges.chromeTop}) must equal the WebView bottom edge '
              '(${edges.webviewBottom}). A mismatch means the chrome overlaps '
              '(hiding terminal rows) or leaves a gap — i.e. Positioned(bottom:) '
              'no longer tracks the same bottomReserve the WebView gave up. '
              '[${kb.label}]',
        );
      },
    );
  }

  // Distinguishes `MediaQuery.paddingOf` (correct) from `viewPaddingOf` (bug):
  // at a MID-DISMISSAL fixture the two differ. viewInsets 20 with viewPadding 34
  // gives a framework-floored `padding.bottom` of max(34 - 20, 0) = 14, so the
  // reserve is max(20, 14) = 20. A `viewPaddingOf` misread would instead see 34
  // and compute max(20, 34) = 34 — a 14px-shorter WebView. We anchor an EXACT
  // height: measure the no-safe-area baseline at the same inset (reserve =
  // max(20, 0) = 20) and require the mid-dismissal height to MATCH it (both
  // reserve 20). The viewPaddingOf bug would shrink it by 14 and fail.
  testWidgets(
    'webview-frame reads paddingOf not viewPaddingOf (mid-dismissal fixture)',
    (tester) async {
      suppressWebViewPlatformError(tester);

      const inset = 20.0;
      // Baseline: same inset, NO home indicator → padding 0 → reserve
      // max(20, 0) = 20.
      final baseline =
          await frameHeight(tester, keyboardInset: inset, viewPaddingBottom: 0);
      // Mid-dismissal: inset 20 UNDER a 34px home indicator → derived padding
      // 14 → reserve still max(20, 14) = 20 (NOT 34). Height must equal the
      // baseline; a viewPaddingOf read would make it 14px shorter.
      final midDismissal =
          await frameHeight(tester, keyboardInset: inset, viewPaddingBottom: 34);
      if (baseline == null || midDismissal == null) {
        markTestSkipped(
          'SessionViewScreen did not render the keyed SizedBox under '
          'the test renderer. Manual verification required on devices.',
        );
        return;
      }
      expect(
        midDismissal,
        closeTo(baseline, 0.5),
        reason:
            'Mid-dismissal (viewInsets 20, viewPadding 34 → padding 14): the '
            'reserve is max(20, 14) = 20, identical to the no-home-indicator '
            'baseline (reserve max(20, 0) = 20), so the WebView height must '
            'match ($baseline). A `viewPaddingOf` read would see 34, reserve '
            'max(20, 34) = 34, and shrink the WebView by 14 to '
            '${baseline - 14} — found $midDismissal.',
      );
    },
  );

  testWidgets(
    'webview-frame does NOT double-subtract bottom inset when keyboard is up',
    (tester) async {
      suppressWebViewPlatformError(tester);

      // Keyboard up (viewInsets 300): the framework floors padding.bottom to 0
      // even though the home indicator's viewPadding.bottom is still 34. The
      // reserve is max(300, 0) == 300 with OR without the home indicator, so
      // the WebView height must be identical — proving no double-subtraction.
      const inset = 300.0;
      final noPad =
          await frameHeight(tester, keyboardInset: inset, viewPaddingBottom: 0);
      final withPad = await frameHeight(
        tester,
        keyboardInset: inset,
        viewPaddingBottom: bottomPadding,
      );
      if (noPad == null || withPad == null) {
        markTestSkipped(
          'SessionViewScreen did not render the keyed SizedBox under '
          'the test renderer. Manual verification required on devices.',
        );
        return;
      }
      expect(
        withPad,
        closeTo(noPad, 0.5),
        reason:
            'With the keyboard up, padding.bottom is floored to 0 under the '
            'keyboard, so reserve = max($inset, 0) = $inset regardless of the '
            'home indicator; the WebView height must NOT change. Found '
            '$noPad → $withPad (expected unchanged).',
      );
    },
  );

  testWidgets(
    'webview-frame reserve is continuous across the keyboard-dismiss crossover',
    (tester) async {
      suppressWebViewPlatformError(tester);

      // The reserve = max(keyboardInset, padding.bottom) with padding.bottom =
      // max(viewPadding - keyboardInset, 0). Both arms are 1-Lipschitz in the
      // inset, so their max is too: across any inset step the reserve — and
      // therefore the WebView height — can change by AT MOST |Δinset|. That is
      // the continuity guarantee the unified formula buys us. We sample insets
      // straddling the 34px home-indicator crossover (the reserve V-bottoms at
      // inset == viewPadding/2, then climbs back to the safe area) and assert
      // no step jumps by more than the inset step (+ float slack).
      //
      // This is the property the OLD branchy `keyboardInset == 0 ? padding :
      // inset` violated: at the dismiss frame the inset fell ~5→0 while the
      // reserve snapped from ~5 up to the full 34px padding — a one-frame
      // WebView contraction of ~29px against a |Δinset| of ~5. Such a step
      // would fail this bound.
      const viewPaddingBottom = 34.0;
      const insets = <double>[300, 100, 34, 17, 5, 0];
      final heights = <double>[];
      for (final inset in insets) {
        final h = await frameHeight(
          tester,
          keyboardInset: inset,
          viewPaddingBottom: viewPaddingBottom,
        );
        if (h == null) {
          markTestSkipped(
            'SessionViewScreen did not render the keyed SizedBox under '
            'the test renderer. Manual verification required on devices.',
          );
          return;
        }
        heights.add(h);
      }
      for (var i = 1; i < heights.length; i++) {
        final insetStep = (insets[i - 1] - insets[i]).abs();
        final heightStep = (heights[i] - heights[i - 1]).abs();
        expect(
          heightStep,
          lessThanOrEqualTo(insetStep + 0.5),
          reason:
              'WebView height changed by $heightStep across an inset step of '
              '$insetStep (inset ${insets[i - 1]} → ${insets[i]}). The unified '
              'max() reserve is 1-Lipschitz, so the height must not jump by '
              'more than the inset step — a larger jump means a dismiss-frame '
              'contraction. insets=$insets heights=$heights',
        );
      }
    },
  );
}
