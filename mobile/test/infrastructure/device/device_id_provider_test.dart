import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/device/device_id_provider.dart';

class _MockStorage extends Mock implements SecureStoragePort {}

void main() {
  late _MockStorage storage;

  setUp(() {
    storage = _MockStorage();
  });

  IdGenerator stubGenerator(List<String> values) {
    var idx = 0;
    return () {
      final value = values[idx % values.length];
      idx += 1;
      return value;
    };
  }

  test('first call generates a UUID and persists it', () async {
    when(() => storage.read('__meta__', 'device.id'))
        .thenAnswer((_) async => null);
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});

    final provider = DeviceIdProvider(
      storage,
      idGenerator: stubGenerator(['11111111-2222-3333-4444-555555555555']),
    );
    final id = await provider.get();

    expect(id, '11111111-2222-3333-4444-555555555555');
    verify(
      () => storage.write(
        '__meta__',
        'device.id',
        '11111111-2222-3333-4444-555555555555',
      ),
    ).called(1);
  });

  test('second call reuses the persisted value (no new write)', () async {
    when(() => storage.read('__meta__', 'device.id'))
        .thenAnswer((_) async => 'already-stored');

    final provider = DeviceIdProvider(
      storage,
      idGenerator: stubGenerator(['unused-1', 'unused-2']),
    );
    final id = await provider.get();

    expect(id, 'already-stored');
    verifyNever(() => storage.write(any(), any(), any()));
  });

  test('empty stored value is treated as missing and regenerated', () async {
    when(() => storage.read('__meta__', 'device.id'))
        .thenAnswer((_) async => '');
    when(() => storage.write(any(), any(), any())).thenAnswer((_) async {});

    final provider = DeviceIdProvider(
      storage,
      idGenerator: stubGenerator(['fresh-uuid']),
    );
    final id = await provider.get();

    expect(id, 'fresh-uuid');
    verify(() => storage.write('__meta__', 'device.id', 'fresh-uuid'))
        .called(1);
  });

  test('two providers backed by the same storage agree on the id', () async {
    String? stored;
    when(() => storage.read('__meta__', 'device.id'))
        .thenAnswer((_) async => stored);
    when(() => storage.write(any(), any(), any())).thenAnswer((invocation) {
      stored = invocation.positionalArguments[2] as String;
      return Future.value();
    });

    final first = DeviceIdProvider(
      storage,
      idGenerator: stubGenerator(['the-only-uuid']),
    );
    final firstId = await first.get();
    final second = DeviceIdProvider(
      storage,
      idGenerator: stubGenerator(['this-should-not-be-used']),
    );
    final secondId = await second.get();

    expect(secondId, firstId);
  });
}
