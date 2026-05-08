import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/storage/server_config_store_impl.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  late _MockStorage storage;
  late ServerConfigStoreImpl store;

  setUp(() {
    storage = _MockStorage();
    store = ServerConfigStoreImpl(storage);
  });

  ServerConfig makeConfig(String id, {String label = 'Server', DateTime? at}) =>
      ServerConfig(
        id: id,
        label: label,
        url: 'https://$id.example.com',
        lastUsedAt: at ?? DateTime(2026, 5, 8),
      );

  test('loadAll returns empty list when nothing is stored', () async {
    when(() => storage.read('__meta__', 'servers'))
        .thenAnswer((_) async => null);
    expect(await store.loadAll(), isEmpty);
  });

  test('upsert appends a new config and sorts by lastUsedAt desc', () async {
    when(() => storage.read('__meta__', 'servers')).thenAnswer(
      (_) async =>
          jsonEncode([makeConfig('a', at: DateTime(2026, 5, 1)).toJson()]),
    );
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});

    await store.upsert(makeConfig('b', at: DateTime(2026, 5, 8)));

    final captured =
        verify(() => storage.write('__meta__', 'servers', captureAny()))
            .captured
            .single as String;
    final list = (jsonDecode(captured) as List).cast<Map<String, dynamic>>();
    expect(list.first['id'], 'b');
    expect(list.last['id'], 'a');
  });

  test('remove drops the entry and clears its per-server data', () async {
    when(() => storage.read('__meta__', 'servers')).thenAnswer(
      (_) async =>
          jsonEncode([makeConfig('a').toJson(), makeConfig('b').toJson()]),
    );
    when(() => storage.read('__meta__', 'active_server_id'))
        .thenAnswer((_) async => 'a');
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});
    when(() => storage.deleteAll('a')).thenAnswer((_) async {});

    await store.remove('a');

    verify(() => storage.deleteAll('a')).called(1);
    verify(() => storage.write('__meta__', 'active_server_id', 'b')).called(1);
  });

  test('setActive writes the active id to the meta namespace', () async {
    when(() => storage.write('__meta__', 'active_server_id', 'srv-1'))
        .thenAnswer((_) async {});

    await store.setActive('srv-1');

    verify(() => storage.write('__meta__', 'active_server_id', 'srv-1'))
        .called(1);
  });

  test('loadActive returns the matching config or null when absent', () async {
    when(() => storage.read('__meta__', 'active_server_id'))
        .thenAnswer((_) async => 'a');
    when(() => storage.read('__meta__', 'servers'))
        .thenAnswer((_) async => jsonEncode([makeConfig('a').toJson()]));

    final result = await store.loadActive();

    expect(result?.id, 'a');
  });
}
