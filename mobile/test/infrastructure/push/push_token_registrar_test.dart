import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/api_client_port.dart';
import 'package:remote_dev/application/ports/push_port.dart';
import 'package:remote_dev/application/ports/server_config_store.dart';
import 'package:remote_dev/domain/server_config.dart';
import 'package:remote_dev/infrastructure/push/push_token_registrar.dart';

class _MockPush extends Mock implements PushPort {}

class _MockStore extends Mock implements ServerConfigStore {}

class _MockClient extends Mock implements ApiClientPort {}

void main() {
  setUpAll(() {
    registerFallbackValue(<String, dynamic>{});
  });

  late _MockPush push;
  late _MockStore store;
  late StreamController<String> refresh;

  setUp(() {
    push = _MockPush();
    store = _MockStore();
    refresh = StreamController<String>.broadcast();
    when(() => push.onTokenRefresh).thenAnswer((_) => refresh.stream);
  });

  tearDown(() async {
    await refresh.close();
  });

  ServerConfig server(String id, {String? label}) => ServerConfig(
        id: id,
        label: label ?? id,
        url: 'https://$id.example.com',
        lastUsedAt: DateTime(2026, 5, 8),
      );

  test('registerWithAll POSTs to every saved server', () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(() => clientB.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(store.loadAll).thenAnswer((_) async => [server('a'), server('b')]);

    final clients = {'a': clientA, 'b': clientB};
    final registrar = PushTokenRegistrar(
      push: push,
      serverStore: store,
      clientFactory: (s) => clients[s.id]!,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    final capturedA = verify(
      () => clientA.post('/api/push-tokens', body: captureAny(named: 'body')),
    ).captured.single as Map<String, dynamic>;
    expect(capturedA['token'], 'tok-1');
    expect(capturedA['deviceId'], 'dev-1');
    expect(capturedA['platform'], anyOf('ios', 'android'));

    verify(() => clientB.post('/api/push-tokens', body: any(named: 'body')))
        .called(1);
  });

  test('per-server failure does not block subsequent servers', () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenThrow(Exception('boom'));
    when(() => clientB.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(store.loadAll).thenAnswer((_) async => [server('a'), server('b')]);

    final registrar = PushTokenRegistrar(
      push: push,
      serverStore: store,
      clientFactory: (s) => s.id == 'a' ? clientA : clientB,
      deviceId: 'dev-1',
    );

    await registrar.registerWithAll('tok-1');

    verify(() => clientB.post('/api/push-tokens', body: any(named: 'body')))
        .called(1);
  });

  test('start() subscribes to onTokenRefresh and re-registers', () async {
    final clientA = _MockClient();
    when(() => clientA.post(any(), body: any(named: 'body')))
        .thenAnswer((_) async => null);
    when(() => push.initialize()).thenAnswer((_) async => true);
    when(() => push.getToken()).thenAnswer((_) async => 'initial-tok');
    when(store.loadAll).thenAnswer((_) async => [server('a')]);

    final registrar = PushTokenRegistrar(
      push: push,
      serverStore: store,
      clientFactory: (_) => clientA,
      deviceId: 'dev-1',
    );

    await registrar.start();

    verify(() => clientA.post('/api/push-tokens', body: any(named: 'body')))
        .called(1);

    refresh.add('refreshed-tok');
    await Future<void>.delayed(Duration.zero);

    verify(() => clientA.post('/api/push-tokens', body: any(named: 'body')))
        .called(1);

    await registrar.stop();
  });

  test('unregisterFromServer DELETEs from the specified server only', () async {
    final clientA = _MockClient();
    final clientB = _MockClient();
    when(() => clientA.delete(any())).thenAnswer((_) async {});
    when(() => clientB.delete(any())).thenAnswer((_) async {});
    when(() => push.getToken()).thenAnswer((_) async => 'tok-1');
    when(store.loadAll).thenAnswer((_) async => [server('a'), server('b')]);

    final registrar = PushTokenRegistrar(
      push: push,
      serverStore: store,
      clientFactory: (s) => s.id == 'a' ? clientA : clientB,
      deviceId: 'dev-1',
    );

    await registrar.unregisterFromServer('a');

    verify(() => clientA.delete('/api/push-tokens/tok-1')).called(1);
    verifyNever(() => clientB.delete(any()));
  });

  test('start returns false when push.initialize fails', () async {
    when(() => push.initialize()).thenAnswer((_) async => false);
    final registrar = PushTokenRegistrar(
      push: push,
      serverStore: store,
      clientFactory: (_) => throw UnimplementedError(),
      deviceId: 'dev-1',
    );
    expect(await registrar.start(), isFalse);
  });
}
