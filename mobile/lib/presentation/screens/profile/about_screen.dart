import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

/// Async source of [PackageInfo]. autoDispose so it doesn't pin platform
/// state across navigations; the platform channel call is cheap and
/// cached on the native side anyway. Tests override this with a fake
/// future that yields canned values, avoiding the platform channel.
final packageInfoProvider = FutureProvider.autoDispose<PackageInfo>((ref) {
  return PackageInfo.fromPlatform();
});

class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncInfo = ref.watch(packageInfoProvider);
    return Scaffold(
      backgroundColor: const Color(0xFF1A1B26),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1B26),
        title: const Text('About', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              asyncInfo.maybeWhen(
                data: (info) => info.appName.isEmpty ? 'Remote Dev' : info.appName,
                orElse: () => 'Remote Dev',
              ),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            asyncInfo.when(
              loading: () => const Text(
                'Version …',
                style: TextStyle(color: Colors.white70),
              ),
              error: (_, __) => const Text(
                'Version unavailable',
                style: TextStyle(color: Colors.white70),
              ),
              data: (info) {
                final version = info.version.isEmpty ? '0.0.0' : info.version;
                final build = info.buildNumber;
                final label = build.isEmpty
                    ? 'Version $version'
                    : 'Version $version ($build)';
                return Text(
                  label,
                  style: const TextStyle(color: Colors.white70),
                );
              },
            ),
            const SizedBox(height: 4),
            asyncInfo.maybeWhen(
              data: (info) {
                if (info.packageName.isEmpty) return const SizedBox.shrink();
                return Text(
                  info.packageName,
                  style: const TextStyle(color: Colors.white38, fontSize: 12),
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),
            const SizedBox(height: 16),
            const Text(
              'A web-based terminal interface for AI-driven development.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            const Text(
              'Author',
              style: TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Built by the Remote Dev team.',
              style: TextStyle(color: Colors.white70),
            ),
          ],
        ),
      ),
    );
  }
}
