import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/app.dart';

void main() {
  testWidgets('app boots and shows the placeholder', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: RemoteDevApp()));
    expect(find.text('Remote Dev — Phase 1 scaffold'), findsOneWidget);
  });
}
