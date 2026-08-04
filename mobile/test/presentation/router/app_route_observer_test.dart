import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/router/app_router.dart'
    show routeObserver;

class _RouteAwareHome extends StatefulWidget {
  const _RouteAwareHome();

  @override
  State<_RouteAwareHome> createState() => _RouteAwareHomeState();
}

class _RouteAwareHomeState extends State<_RouteAwareHome> with RouteAware {
  var coveredCount = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) routeObserver.subscribe(this, route);
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    super.dispose();
  }

  @override
  void didPushNext() {
    setState(() => coveredCount += 1);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Text('covered:$coveredCount'),
          TextButton(
            onPressed:
                () => showDialog<bool>(
                  context: context,
                  builder:
                      (_) => AlertDialog(
                        content: const Text('typed dialog'),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.of(context).pop(true),
                            child: const Text('close'),
                          ),
                        ],
                      ),
                ),
            child: const Text('open'),
          ),
        ],
      ),
    );
  }
}

void main() {
  testWidgets('typed popup route triggers didPushNext', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        navigatorObservers: [routeObserver],
        home: const _RouteAwareHome(),
      ),
    );

    expect(find.text('covered:0'), findsOneWidget);
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    expect(find.text('typed dialog'), findsOneWidget);
    expect(find.text('covered:1'), findsOneWidget);

    await tester.tap(find.text('close'));
    await tester.pumpAndSettle();
  });
}
