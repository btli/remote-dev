import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:remote_dev/presentation/screens/profile/about_screen.dart';

PackageInfo _fakeInfo({
  String appName = 'Remote Dev',
  String packageName = 'com.example.remote_dev',
  String version = '1.2.3',
  String buildNumber = '42',
}) {
  return PackageInfo(
    appName: appName,
    packageName: packageName,
    version: version,
    buildNumber: buildNumber,
    buildSignature: '',
    installerStore: null,
  );
}

Widget _wrap(List<Override> overrides) {
  return ProviderScope(
    overrides: overrides,
    child: const MaterialApp(home: AboutScreen()),
  );
}

void main() {
  testWidgets('AboutScreen renders title and dynamic version', (tester) async {
    final widget = _wrap([
      packageInfoProvider.overrideWith((_) async => _fakeInfo()),
    ]);
    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();

    expect(find.text('About'), findsOneWidget);
    expect(find.text('Remote Dev'), findsOneWidget);
    expect(find.text('Version 1.2.3 (42)'), findsOneWidget);
    expect(find.text('com.example.remote_dev'), findsOneWidget);
  });

  testWidgets('AboutScreen falls back when version load fails', (tester) async {
    final widget = _wrap([
      packageInfoProvider.overrideWith(
        (_) async => Future<PackageInfo>.error(StateError('boom')),
      ),
    ]);
    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();

    expect(find.text('Remote Dev'), findsOneWidget);
    expect(find.text('Version unavailable'), findsOneWidget);
  });

  testWidgets('AboutScreen omits build number when empty', (tester) async {
    final widget = _wrap([
      packageInfoProvider.overrideWith(
        (_) async => _fakeInfo(version: '0.1.0', buildNumber: ''),
      ),
    ]);
    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();

    expect(find.text('Version 0.1.0'), findsOneWidget);
  });
}
