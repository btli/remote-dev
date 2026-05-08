import 'package:flutter/material.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key, this.onTroubleLoading});

  final VoidCallback? onTroubleLoading;

  static const Duration troubleLoadingDelay = Duration(seconds: 8);

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  // Phase 2 will read this to render a trouble-loading CTA when the
  // WebView host's onLoadStop times out. Tracked here so the timer
  // fires once and the field is set via setState.
  // ignore: unused_field
  bool _showTroubleCta = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(SplashScreen.troubleLoadingDelay, () {
      if (!mounted) return;
      setState(() => _showTroubleCta = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: Color(0xFF1A1B26),
      body: SafeArea(
        child: Center(
          child: _SplashContent(),
        ),
      ),
    );
  }
}

class _SplashContent extends StatelessWidget {
  const _SplashContent();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 64,
      height: 64,
      child: CircularProgressIndicator(
        strokeWidth: 3,
        valueColor: AlwaysStoppedAnimation(Color(0xFF7AA2F7)),
      ),
    );
  }
}
