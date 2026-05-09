import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/router/app_route.dart';

void main() {
  test('AppRoute.toPath maps each variant to the right path', () {
    expect(const AppRoute.serverPicker().toPath(), '/servers');
    expect(const AppRoute.addServer().toPath(), '/servers/add');
    expect(const AppRoute.session('abc').toPath(), '/home/session/abc');
    expect(const AppRoute.channel('xyz').toPath(), '/home/channel/xyz');
    expect(const AppRoute.recording('123').toPath(), '/home/recording/123');
    expect(const AppRoute.notifications().toPath(), '/notifications');
    expect(const AppRoute.reauth().toPath(), '/reauth');
  });
}
