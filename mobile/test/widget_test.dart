import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/app.dart';

void main() {
  testWidgets('app boots and shows the server-picker placeholder',
      (tester) async {
    await tester.pumpWidget(const ProviderScope(child: RemoteDevApp()));
    await tester.pumpAndSettle();
    expect(find.text('Servers'), findsOneWidget);
  });
}
