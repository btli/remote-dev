import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/presentation/screens/session_view/modifier_latch.dart';

void main() {
  test('initial state: all off', () {
    final latch = ModifierLatch();
    expect(latch.stateOf('ctrl'), LatchState.off);
    expect(latch.snapshot(), isEmpty);
  });

  test('tap once → single', () {
    final latch = ModifierLatch();
    latch.tap('ctrl');
    expect(latch.stateOf('ctrl'), LatchState.single);
    expect(latch.snapshot(), {'ctrl': true});
  });

  test('tap twice → locked', () {
    final latch = ModifierLatch();
    latch.tap('ctrl');
    latch.tap('ctrl');
    expect(latch.stateOf('ctrl'), LatchState.locked);
  });

  test('tap thrice → off', () {
    final latch = ModifierLatch();
    latch.tap('ctrl');
    latch.tap('ctrl');
    latch.tap('ctrl');
    expect(latch.stateOf('ctrl'), LatchState.off);
  });

  test('consumeSingles resets singles, leaves locked', () {
    final latch = ModifierLatch();
    latch.tap('ctrl'); // single
    latch.tap('alt'); // single
    latch.tap('alt'); // locked
    latch.consumeSingles();
    expect(latch.stateOf('ctrl'), LatchState.off);
    expect(latch.stateOf('alt'), LatchState.locked);
  });

  test('reset clears all', () {
    final latch = ModifierLatch();
    latch.tap('ctrl');
    latch.tap('alt');
    latch.tap('alt');
    latch.reset();
    expect(latch.snapshot(), isEmpty);
  });
}
