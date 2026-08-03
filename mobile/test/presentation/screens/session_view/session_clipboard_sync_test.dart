import 'dart:convert';
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/session_clipboard_sync.dart';

void main() {
  group('parseSelectionChangePayload', () {
    test('reads the canonical {text: string} payload', () {
      expect(
        parseSelectionChangePayload(<dynamic>[
          <String, Object>{'text': 'selected'},
        ]),
        'selected',
      );
    });

    test('accepts a legacy bare string payload', () {
      expect(parseSelectionChangePayload(<dynamic>['selected']), 'selected');
    });

    test('rejects empty and malformed payloads', () {
      expect(parseSelectionChangePayload(<dynamic>[]), isNull);
      expect(parseSelectionChangePayload(<dynamic>[null]), isNull);
      expect(
        parseSelectionChangePayload(<dynamic>[
          <String, Object>{'text': ''},
        ]),
        isNull,
      );
      expect(
        parseSelectionChangePayload(<dynamic>[
          <String, Object>{'text': 42},
        ]),
        isNull,
      );
      expect(
        parseSelectionChangePayload(<dynamic>[
          <String, Object>{'other': 'selected'},
        ]),
        isNull,
      );
    });
  });

  group('parseClipboardWritePayload', () {
    test('accepts the canonical text and integer revision map', () {
      final payload = parseClipboardWritePayload(<dynamic>[
        <String, Object>{'text': 'from remote', 'revision': 7},
      ]);

      expect(payload?.text, 'from remote');
      expect(payload?.revision, 7);
    });

    test('accepts an integral JavaScript number revision', () {
      final payload = parseClipboardWritePayload(<dynamic>[
        <String, Object>{'text': 'ok', 'revision': 7.0},
      ]);

      expect(payload?.revision, 7);
    });

    test('rejects malformed and empty payloads', () {
      expect(parseClipboardWritePayload(<dynamic>[]), isNull);
      expect(parseClipboardWritePayload(<dynamic>[null]), isNull);
      expect(parseClipboardWritePayload(<dynamic>['text']), isNull);
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': '', 'revision': 1},
        ]),
        isNull,
      );
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': 'ok', 'revision': -1},
        ]),
        isNull,
      );
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': 'ok', 'revision': 1.5},
        ]),
        isNull,
      );
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': 42, 'revision': 1},
        ]),
        isNull,
      );
    });

    test('allows exactly 1 MiB UTF-8 and rejects anything larger', () {
      final exact = 'a' * maxClipboardSyncUtf8Bytes;
      final tooLarge = '$exacté';

      expect(utf8.encode(exact), hasLength(maxClipboardSyncUtf8Bytes));
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': exact, 'revision': 1},
        ]),
        isNotNull,
      );
      expect(
        parseClipboardWritePayload(<dynamic>[
          <String, Object>{'text': tooLarge, 'revision': 2},
        ]),
        isNull,
      );
    });
  });

  group('SessionClipboardSync', () {
    late bool enabled;
    late bool current;
    late bool presentationReady;
    late bool bridgeReady;
    late String? nativeText;
    late Completer<String?>? pendingRead;
    late Completer<void>? pendingWrite;
    late int writeFailuresRemaining;
    late List<String> events;
    late SessionClipboardSync sync;

    setUp(() {
      enabled = false;
      current = true;
      presentationReady = true;
      bridgeReady = true;
      nativeText = 'local clipboard';
      pendingRead = null;
      pendingWrite = null;
      writeFailuresRemaining = 0;
      events = <String>[];
      sync = SessionClipboardSync(
        isEnabled: () => enabled,
        isCurrent: () => current,
        isPresentationReady: () => presentationReady,
        isBridgeReady: () => bridgeReady,
        setBridgeEnabled: (value) => events.add('enabled:$value'),
        syncBridgeText: (text) => events.add('sync:$text'),
        pasteToTerminal: (text) => events.add('paste:$text'),
        refitTerminal: () => events.add('refit'),
        readClipboardText: () async {
          events.add('read');
          final pending = pendingRead;
          if (pending != null) return pending.future;
          return nativeText;
        },
        writeClipboardText: (text) async {
          events.add('write:$text');
          final pending = pendingWrite;
          pendingWrite = null;
          if (pending != null) await pending.future;
          if (writeFailuresRemaining > 0) {
            writeFailuresRemaining -= 1;
            throw StateError('transient clipboard failure');
          }
          nativeText = text;
        },
      );
    });

    test(
      'terminal ready tells WebView sync is disabled without reading',
      () async {
        await sync.onTerminalReady();

        expect(events, <String>['enabled:false']);
      },
    );

    test(
      'terminal ready enables then publishes the native clipboard',
      () async {
        enabled = true;

        await sync.onTerminalReady();

        expect(events, <String>[
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test(
      'terminal ready subscribes false and does not read while covered',
      () async {
        enabled = true;
        current = false;

        await sync.onTerminalReady();

        expect(events, <String>['enabled:false']);
      },
    );

    test(
      'terminal ready subscribes false and does not read while locked',
      () async {
        enabled = true;
        presentationReady = false;

        await sync.onTerminalReady();

        expect(events, <String>['enabled:false']);
      },
    );

    test(
      'resume refits before refreshing enabled state and clipboard',
      () async {
        enabled = true;

        await sync.onAppResumed();

        expect(events, <String>[
          'refit',
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test(
      'resume unsubscribes while this session route is not current',
      () async {
        enabled = true;
        current = false;

        await sync.onAppResumed();

        expect(events, <String>['enabled:false']);
      },
    );

    test('resume unsubscribes while foreground unlock is unresolved', () async {
      enabled = true;
      presentationReady = false;

      await sync.onAppResumed();

      expect(events, <String>['enabled:false']);
    });

    test(
      'setting changes update bridge and enabling syncs immediately',
      () async {
        await sync.onSettingChanged(false);
        enabled = true;
        await sync.onSettingChanged(true);

        expect(events, <String>[
          'enabled:false',
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test(
      'setting changes leave a covered route unsubscribed without reading',
      () async {
        enabled = true;
        current = false;

        await sync.onSettingChanged(true);

        expect(events, <String>['enabled:false']);
      },
    );

    test(
      'setting changes leave a locked route unsubscribed without reading',
      () async {
        enabled = true;
        presentationReady = false;

        await sync.onSettingChanged(true);

        expect(events, <String>['enabled:false']);
      },
    );

    test(
      'readiness revocation unsubscribes and restoration reconciles state',
      () async {
        enabled = true;
        presentationReady = false;

        await sync.onPresentationReadinessChanged(false);
        presentationReady = true;
        await sync.onPresentationReadinessChanged(true);

        expect(events, <String>[
          'enabled:false',
          'refit',
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test(
      'enabled setting does not read clipboard until bridge is ready',
      () async {
        enabled = true;
        bridgeReady = false;

        await sync.onSettingChanged(true);

        expect(events, <String>['enabled:true']);

        bridgeReady = true;
        await sync.onTerminalReady();
        expect(events, <String>[
          'enabled:true',
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test(
      'cover disables bridge and reveal refits then restores sync',
      () async {
        enabled = true;

        sync.onRouteCovered();
        current = false;
        await sync.onRouteRevealed();
        current = true;
        await sync.onRouteRevealed();

        expect(events, <String>[
          'enabled:false',
          'enabled:false',
          'refit',
          'enabled:true',
          'read',
          'sync:local clipboard',
        ]);
      },
    );

    test('remote write is gated by opt-in and current route', () async {
      final args = <dynamic>[
        <String, Object>{'text': 'remote', 'revision': 1},
      ];

      await sync.onClipboardWrite(args);
      enabled = true;
      current = false;
      await sync.onClipboardWrite(args);

      expect(events, isEmpty);

      current = true;
      await sync.onClipboardWrite(args);
      expect(events, <String>['write:remote']);
    });

    test('remote write is ignored while locked or backgrounded', () async {
      enabled = true;
      presentationReady = false;

      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'remote', 'revision': 1},
      ]);

      expect(events, isEmpty);
    });

    test(
      'remote write ignores malformed, empty, and oversized payloads',
      () async {
        enabled = true;

        await sync.onClipboardWrite(<dynamic>[]);
        await sync.onClipboardWrite(<dynamic>[
          <String, Object>{'text': '', 'revision': 1},
        ]);
        await sync.onClipboardWrite(<dynamic>[
          <String, Object>{
            'text': 'x' * (maxClipboardSyncUtf8Bytes + 1),
            'revision': 2,
          },
        ]);

        expect(events, isEmpty);
      },
    );

    test(
      'revision and text guards suppress duplicate writes and echo',
      () async {
        enabled = true;
        final remote = <dynamic>[
          <String, Object>{'text': 'remote', 'revision': 9},
        ];

        await sync.onClipboardWrite(remote);
        await sync.onClipboardWrite(remote);
        await sync.onAppResumed();

        expect(events, <String>[
          'write:remote',
          'refit',
          'enabled:true',
          'read',
        ]);

        // Echo suppression is one-shot. A later explicit refresh can publish
        // the same local text after the server-side revision has been consumed.
        await sync.onAppResumed();
        expect(events.last, 'sync:remote');
      },
    );

    test('only exact duplicate revision and text is suppressed', () async {
      enabled = true;

      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'epoch one', 'revision': 10},
      ]);
      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'epoch two', 'revision': 1},
      ]);
      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'same revision, new text', 'revision': 1},
      ]);
      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'same revision, new text', 'revision': 1},
      ]);

      expect(events, <String>[
        'write:epoch one',
        'write:epoch two',
        'write:same revision, new text',
      ]);
    });

    test(
      'ineligibility clears text metadata so the same pair can apply later',
      () async {
        enabled = true;
        final update = <dynamic>[
          <String, Object>{'text': 'remote', 'revision': 4},
        ];

        await sync.onClipboardWrite(update);
        sync.onPresentationUnavailable();
        await sync.onClipboardWrite(update);

        expect(events, <String>[
          'write:remote',
          'enabled:false',
          'write:remote',
        ]);
      },
    );

    test('failed native write does not suppress a legitimate retry', () async {
      enabled = true;
      writeFailuresRemaining = 1;
      final update = <dynamic>[
        <String, Object>{'text': 'remote', 'revision': 4},
      ];

      await sync.onClipboardWrite(update);
      await sync.onClipboardWrite(update);

      expect(events, <String>['write:remote', 'write:remote']);
      expect(nativeText, 'remote');
    });

    test(
      'remote write completion from an old presentation cannot seed metadata',
      () async {
        enabled = true;
        final write = Completer<void>();
        pendingWrite = write;
        final update = <dynamic>[
          <String, Object>{'text': 'remote', 'revision': 4},
        ];

        final first = sync.onClipboardWrite(update);
        await Future<void>.delayed(Duration.zero);
        expect(events, <String>['write:remote']);

        presentationReady = false;
        sync.onPresentationUnavailable();
        presentationReady = true;
        write.complete();
        await first;

        await sync.onAppResumed();
        await sync.onClipboardWrite(update);

        expect(events, <String>[
          'write:remote',
          'enabled:false',
          'refit',
          'enabled:true',
          'read',
          'sync:remote',
          'write:remote',
        ]);
      },
    );

    test(
      'successful local selection invalidates the remote duplicate pair',
      () async {
        enabled = true;
        final remote = <dynamic>[
          <String, Object>{'text': 'remote A', 'revision': 2},
        ];

        await sync.onClipboardWrite(remote);
        await sync.onSelectionChange('local B');
        await sync.onClipboardWrite(remote);

        expect(events, <String>[
          'write:remote A',
          'write:local B',
          'sync:local B',
          'write:remote A',
        ]);
      },
    );

    test(
      'successful local publication invalidates the remote duplicate pair',
      () async {
        enabled = true;
        final remote = <dynamic>[
          <String, Object>{'text': 'remote A', 'revision': 2},
        ];

        await sync.onClipboardWrite(remote);
        nativeText = 'local B';
        await sync.onAppResumed();
        await sync.onClipboardWrite(remote);

        expect(events, <String>[
          'write:remote A',
          'refit',
          'enabled:true',
          'read',
          'sync:local B',
          'write:remote A',
        ]);
      },
    );

    test(
      'successful local paste invalidates the remote duplicate pair',
      () async {
        enabled = true;
        final remote = <dynamic>[
          <String, Object>{'text': 'remote A', 'revision': 2},
        ];

        await sync.onClipboardWrite(remote);
        nativeText = 'local B';
        await sync.onWantsPaste();
        await sync.onClipboardWrite(remote);

        expect(events, <String>[
          'write:remote A',
          'read',
          'paste:local B',
          'sync:local B',
          'write:remote A',
        ]);
      },
    );

    test(
      'selection still copies natively and also syncs when enabled',
      () async {
        enabled = true;

        await sync.onSelectionChange('selected');

        expect(events, <String>['write:selected', 'sync:selected']);
        expect(nativeText, 'selected');
      },
    );

    test('selection preserves native copy while sync is disabled', () async {
      await sync.onSelectionChange('selected');

      expect(events, <String>['write:selected']);
      expect(nativeText, 'selected');
    });

    test(
      'selection does not touch native clipboard while unavailable',
      () async {
        enabled = true;
        presentationReady = false;

        await sync.onSelectionChange('selected');

        expect(events, isEmpty);
        expect(nativeText, 'local clipboard');
      },
    );

    test('paste still reaches terminal and also syncs when enabled', () async {
      enabled = true;

      await sync.onWantsPaste();

      expect(events, <String>[
        'read',
        'paste:local clipboard',
        'sync:local clipboard',
      ]);
    });

    test('paste preserves terminal behavior while sync is disabled', () async {
      await sync.onWantsPaste();

      expect(events, <String>['read', 'paste:local clipboard']);
    });

    test('paste does not read native clipboard while unavailable', () async {
      presentationReady = false;

      await sync.onWantsPaste();

      expect(events, isEmpty);
    });

    test(
      'covered stale handlers cannot read or write native clipboard',
      () async {
        enabled = true;
        current = false;

        await sync.onSelectionChange('selected');
        await sync.onWantsPaste();
        await sync.onClipboardWrite(<dynamic>[
          <String, Object>{'text': 'remote', 'revision': 1},
        ]);

        expect(events, isEmpty);
        expect(nativeText, 'local clipboard');
      },
    );

    test('pre-ready handlers cannot read or write native clipboard', () async {
      enabled = true;
      bridgeReady = false;

      await sync.onSelectionChange('selected');
      await sync.onWantsPaste();
      await sync.onClipboardWrite(<dynamic>[
        <String, Object>{'text': 'remote', 'revision': 1},
      ]);

      expect(events, isEmpty);
      expect(nativeText, 'local clipboard');
    });

    test('paste rechecks readiness after awaited clipboard read', () async {
      enabled = true;
      pendingRead = Completer<String?>();

      final paste = sync.onWantsPaste();
      await Future<void>.delayed(Duration.zero);
      expect(events, <String>['read']);

      presentationReady = false;
      pendingRead!.complete('late secret');
      await paste;

      expect(events, <String>['read']);
    });

    test(
      'paste completion from an old presentation is dropped after an ABA',
      () async {
        enabled = true;
        final read = Completer<String?>();
        pendingRead = read;

        final paste = sync.onWantsPaste();
        await Future<void>.delayed(Duration.zero);
        expect(events, <String>['read']);

        presentationReady = false;
        sync.onPresentationUnavailable();
        presentationReady = true;
        read.complete('late secret');
        await paste;

        expect(events, <String>['read', 'enabled:false']);
      },
    );

    test(
      'selection completion from an old presentation cannot publish after ABA',
      () async {
        enabled = true;
        final write = Completer<void>();
        pendingWrite = write;

        final selection = sync.onSelectionChange('late selection');
        await Future<void>.delayed(Duration.zero);
        expect(events, <String>['write:late selection']);

        presentationReady = false;
        sync.onPresentationUnavailable();
        presentationReady = true;
        write.complete();
        await selection;

        expect(events, <String>['write:late selection', 'enabled:false']);
      },
    );

    test(
      'publish completion from an old presentation is dropped after an ABA',
      () async {
        enabled = true;
        final read = Completer<String?>();
        pendingRead = read;

        final publish = sync.onTerminalReady();
        await Future<void>.delayed(Duration.zero);
        expect(events, <String>['enabled:true', 'read']);

        presentationReady = false;
        sync.onPresentationUnavailable();
        presentationReady = true;
        read.complete('late secret');
        await publish;

        expect(events, <String>['enabled:true', 'read', 'enabled:false']);
      },
    );
  });
}
