import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/infrastructure/storage/flutter_secure_storage_port.dart';

class _MockStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late _MockStorage backing;
  late FlutterSecureStoragePort port;

  setUp(() {
    backing = _MockStorage();
    port = FlutterSecureStoragePort(backing);
  });

  test('read prefixes the key with serverId', () async {
    when(() => backing.read(key: 'server.abc.cf_token'))
        .thenAnswer((_) async => 'tok');
    expect(await port.read('abc', 'cf_token'), 'tok');
  });

  test('deleteAll removes only entries for the given serverId', () async {
    when(() => backing.readAll()).thenAnswer(
      (_) async => {
        'server.abc.cf_token': 'tok',
        'server.abc.api_key': 'key',
        'server.xyz.cf_token': 'other',
      },
    );
    when(() => backing.delete(key: any(named: 'key'))).thenAnswer(
      (_) async {},
    );

    await port.deleteAll('abc');

    verify(() => backing.delete(key: 'server.abc.cf_token')).called(1);
    verify(() => backing.delete(key: 'server.abc.api_key')).called(1);
    verifyNever(() => backing.delete(key: 'server.xyz.cf_token'));
  });
}
