import 'dart:convert';

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
    late String? nativeText;
    late List<String> events;
    late SessionClipboardSync sync;

    setUp(() {
      enabled = false;
      current = true;
      nativeText = 'local clipboard';
      events = <String>[];
      sync = SessionClipboardSync(
        isEnabled: () => enabled,
        isCurrent: () => current,
        setBridgeEnabled: (value) => events.add('enabled:$value'),
        syncBridgeText: (text) => events.add('sync:$text'),
        pasteToTerminal: (text) => events.add('paste:$text'),
        refitTerminal: () => events.add('refit'),
        readClipboardText: () async {
          events.add('read');
          return nativeText;
        },
        writeClipboardText: (text) async {
          events.add('write:$text');
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

    test('resume is ignored while this session route is not current', () async {
      enabled = true;
      current = false;

      await sync.onAppResumed();

      expect(events, isEmpty);
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
  });
}
