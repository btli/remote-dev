import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/application/ports/secure_storage_port.dart';
import 'package:remote_dev/infrastructure/auth/pending_add_host_login.dart';

class _FakeStorage implements SecureStoragePort {
  final Map<String, String?> data = <String, String?>{};
  String _key(String ns, String key) => 'server.$ns.$key';
  @override
  Future<String?> read(String ns, String key) async => data[_key(ns, key)];
  @override
  Future<void> write(String ns, String key, String value) async =>
      data[_key(ns, key)] = value;
  @override
  Future<void> delete(String ns, String key) async =>
      data.remove(_key(ns, key));
  @override
  Future<void> deleteAll(String ns) async =>
      data.removeWhere((k, _) => k.startsWith('server.$ns.'));
}

void main() {
  final now = DateTime(2026, 6, 1, 12);

  PendingAddHostLogin record({int? createdAtMs, String state = 's'}) =>
      PendingAddHostLogin(
        origin: 'https://dev.example.com',
        label: 'Work',
        state: state,
        createdAtMs: createdAtMs ?? now.millisecondsSinceEpoch,
      );

  test('save → read round-trips every field', () async {
    final store = PendingAddHostLoginStore(_FakeStorage(), clock: () => now);
    await store.save(record(state: 'nonce-1'));

    final read = await store.read();
    expect(read, isNotNull);
    expect(read!.origin, 'https://dev.example.com');
    expect(read.label, 'Work');
    expect(read.state, 'nonce-1');
  });

  test('read returns null when absent', () async {
    final store = PendingAddHostLoginStore(_FakeStorage(), clock: () => now);
    expect(await store.read(), isNull);
  });

  test('clear removes the record', () async {
    final store = PendingAddHostLoginStore(_FakeStorage(), clock: () => now);
    await store.save(record());
    await store.clear();
    expect(await store.read(), isNull);
  });

  test('save overwrites a previous record (single in-flight)', () async {
    final store = PendingAddHostLoginStore(_FakeStorage(), clock: () => now);
    await store.save(record(state: 'first'));
    await store.save(record(state: 'second'));
    expect((await store.read())!.state, 'second');
  });

  test('a record older than the TTL reads as null and is cleared', () async {
    final storage = _FakeStorage();
    final store = PendingAddHostLoginStore(
      storage,
      ttl: const Duration(minutes: 10),
      clock: () => now,
    );
    // Written 11 minutes ago.
    await store.save(
      record(
        createdAtMs:
            now.subtract(const Duration(minutes: 11)).millisecondsSinceEpoch,
      ),
    );
    expect(await store.read(), isNull);
    // Side effect: the expired record was cleared from storage.
    expect(await store.read(), isNull);
  });

  test('a record within the TTL is returned', () async {
    final store = PendingAddHostLoginStore(
      _FakeStorage(),
      ttl: const Duration(minutes: 10),
      clock: () => now,
    );
    await store.save(
      record(
        createdAtMs:
            now.subtract(const Duration(minutes: 5)).millisecondsSinceEpoch,
      ),
    );
    expect(await store.read(), isNotNull);
  });

  test('malformed JSON reads as null and is cleared', () async {
    final storage = _FakeStorage();
    final store = PendingAddHostLoginStore(storage, clock: () => now);
    // Write raw garbage under the store's namespace/key.
    await storage.write('__pending__', 'add_host_login', 'not json');
    expect(await store.read(), isNull);
    expect(storage.data.containsValue('not json'), isFalse);
  });

  test('JSON missing the state field reads as null', () async {
    final storage = _FakeStorage();
    final store = PendingAddHostLoginStore(storage, clock: () => now);
    await storage.write(
      '__pending__',
      'add_host_login',
      '{"origin":"https://x","label":"L","createdAtMs":0}',
    );
    expect(await store.read(), isNull);
  });
}
