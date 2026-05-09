import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:remote_dev/application/ports/project_tree_port.dart';
import 'package:remote_dev/domain/group.dart';
import 'package:remote_dev/domain/project.dart';
import 'package:remote_dev/presentation/screens/sessions/project_tree_sheet.dart';

class _MockApi extends Mock implements ProjectTreePort {}

void main() {
  testWidgets('renders nested tree from groups + projects', (tester) async {
    final api = _MockApi();
    when(api.listGroups).thenAnswer(
      (_) async => const [
        Group(id: 'g1', name: 'Work', sortOrder: 0),
        Group(id: 'g2', name: 'Personal', sortOrder: 1),
      ],
    );
    when(api.listProjects).thenAnswer(
      (_) async => const [
        Project(id: 'p1', name: 'remote-dev', groupId: 'g1'),
        Project(id: 'p2', name: 'side-project', groupId: 'g2'),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [projectTreeApiProvider.overrideWithValue(api)],
        child: const MaterialApp(home: Scaffold(body: ProjectTreeSheet())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Work'), findsOneWidget);
    expect(find.text('Personal'), findsOneWidget);
    expect(find.text('remote-dev'), findsOneWidget);
    expect(find.text('side-project'), findsOneWidget);
  });

  testWidgets('empty projects shows empty state', (tester) async {
    final api = _MockApi();
    when(api.listGroups).thenAnswer((_) async => const []);
    when(api.listProjects).thenAnswer((_) async => const []);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [projectTreeApiProvider.overrideWithValue(api)],
        child: const MaterialApp(home: Scaffold(body: ProjectTreeSheet())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No projects yet.'), findsOneWidget);
  });
}
