import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'modifier_latch.dart';

typedef SmartKeyHandler = void Function(String name, Map<String, bool> mods);

class SmartKeyStrip extends StatefulWidget {
  const SmartKeyStrip({
    required this.onKeyPress,
    super.key,
  });

  final SmartKeyHandler onKeyPress;

  @override
  State<SmartKeyStrip> createState() => _SmartKeyStripState();
}

class _SmartKeyStripState extends State<SmartKeyStrip> {
  final ModifierLatch _latch = ModifierLatch();

  @override
  void initState() {
    super.initState();
    _latch.addListener(_onLatchChange);
  }

  @override
  void dispose() {
    _latch.removeListener(_onLatchChange);
    _latch.dispose();
    super.dispose();
  }

  void _onLatchChange() => setState(() {});

  void _press(String name, {bool isModifier = false}) {
    HapticFeedback.selectionClick();
    if (isModifier) {
      _latch.tap(name);
      return;
    }
    final mods = _latch.snapshot();
    widget.onKeyPress(name, mods);
    _latch.consumeSingles();
  }

  Widget _key(String label, {String? send, bool isModifier = false}) {
    final name = send ?? label;
    final state = isModifier ? _latch.stateOf(name.toLowerCase()) : LatchState.off;
    final color = switch (state) {
      LatchState.off => const Color(0xFF24283B),
      LatchState.single => const Color(0xFF7AA2F7),
      LatchState.locked => const Color(0xFFBB9AF7),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: () => _press(isModifier ? name.toLowerCase() : name, isModifier: isModifier),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(
              label,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: const Color(0xFF1A1B26),
      height: 44,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        child: Row(
          children: [
            _key('Esc', send: 'Escape'),
            _key('Tab'),
            _key('Ctrl', isModifier: true),
            _key('Alt', isModifier: true),
            _key('Shift', isModifier: true),
            _key('↑', send: 'ArrowUp'),
            _key('↓', send: 'ArrowDown'),
            _key('←', send: 'ArrowLeft'),
            _key('→', send: 'ArrowRight'),
            _key('PgUp', send: 'PageUp'),
            _key('PgDn', send: 'PageDown'),
            _key('Home'),
            _key('End'),
          ],
        ),
      ),
    );
  }
}
