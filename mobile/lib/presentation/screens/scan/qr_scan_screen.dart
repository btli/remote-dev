import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../../domain/qr_payload.dart';

/// Full-screen camera QR scanner that returns a parsed [QrPayload] to its
/// caller.
///
/// Push it with [QrScanScreen.push], which returns the scanned [QrPayload] once
/// the user frames a valid Remote Dev QR code, or `null` if they backed out.
/// The scanner parses each detected code with [QrPayload.parse]; a code that
/// isn't a recognised Remote Dev credential shows a dismissable banner and the
/// scanner keeps running so the user can re-aim (the caller only ever receives a
/// successfully-parsed payload, never an error).
///
/// `mobile_scanner` requests the OS camera permission itself on first start;
/// when permission is denied it renders [errorBuilder] with a friendly prompt.
///
/// SECURITY: a scanned payload may carry a secret (CF service-token). This
/// screen never logs or renders the raw scanned string or any secret — it only
/// pops the typed payload back to the caller for review.
class QrScanScreen extends StatefulWidget {
  const QrScanScreen({super.key});

  /// Push the scanner and await the parsed [QrPayload] (or `null` on back-out).
  static Future<QrPayload?> push(BuildContext context) {
    return Navigator.of(context).push<QrPayload>(
      MaterialPageRoute<QrPayload>(builder: (_) => const QrScanScreen()),
    );
  }

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> {
  final MobileScannerController _controller = MobileScannerController(
    // Only QR codes provision credentials; restricting formats avoids spurious
    // 1D-barcode detections.
    formats: const [BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.noDuplicates,
  );

  /// Guards against the detection stream firing repeatedly (and re-popping)
  /// after we've already accepted a code.
  bool _handled = false;

  /// Last parse error, shown as a dismissable banner while scanning continues.
  String? _error;

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    final raw = capture.barcodes
        .map((b) => b.rawValue)
        .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);
    if (raw == null) return;

    final QrPayload payload;
    try {
      payload = QrPayload.parse(raw);
    } on QrPayloadError catch (e) {
      // Not a Remote Dev credential — surface a friendly banner and keep
      // scanning so the user can re-aim. Never echo the raw scanned string.
      if (mounted) setState(() => _error = e.message);
      return;
    }

    // Accept exactly once. Set _handled BEFORE the await so a detection that
    // fires while stop() is in flight is ignored.
    _handled = true;
    try {
      // Best-effort: stopping the camera before popping is a nicety, not a
      // correctness requirement. If it throws (e.g. the platform camera is
      // already torn down) we must STILL pop — otherwise the screen wedges and
      // every further detection is dropped by the _handled guard above.
      await _controller.stop();
    } catch (_) {
      // Intentionally ignored — the pop in `finally` is what matters.
    } finally {
      if (mounted) Navigator.of(context).pop(payload);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        iconTheme: const IconThemeData(color: Colors.white),
        title: const Text(
          'Scan QR code',
          style: TextStyle(color: Colors.white),
        ),
        actions: [
          // Torch toggle. The controller exposes torch state via its
          // ValueListenable; the icon reflects the current state and is hidden
          // when the device reports no torch.
          ValueListenableBuilder<MobileScannerState>(
            valueListenable: _controller,
            builder: (context, state, _) {
              if (state.torchState == TorchState.unavailable) {
                return const SizedBox.shrink();
              }
              final on = state.torchState == TorchState.on;
              return IconButton(
                icon: Icon(
                  on ? Icons.flash_on : Icons.flash_off,
                  color: on ? Colors.amber : Colors.white,
                ),
                tooltip: on ? 'Turn off torch' : 'Turn on torch',
                onPressed: () => _controller.toggleTorch(),
              );
            },
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => _ScannerError(error: error),
          ),
          // Subtle framing hint.
          const IgnorePointer(
            child: Center(
              child: _ScanReticle(),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_error != null)
                    _ErrorBanner(
                      message: _error!,
                      onDismiss: () => setState(() => _error = null),
                    ),
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'Point the camera at the QR code shown in '
                      'Remote Dev → Settings → Mobile.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70, fontSize: 13),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Friendly full-screen fallback when the camera can't start (most commonly a
/// denied permission).
class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error});

  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    final denied =
        error.errorCode == MobileScannerErrorCode.permissionDenied;
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.no_photography,
                color: Colors.white54,
                size: 48,
              ),
              const SizedBox(height: 16),
              Text(
                denied
                    ? 'Camera permission is needed to scan QR codes. Enable it '
                        'in Settings and try again.'
                    : "The camera couldn't be started.",
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70, fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Lightweight square reticle drawn over the preview to hint where to aim.
class _ScanReticle extends StatelessWidget {
  const _ScanReticle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      height: 220,
      decoration: BoxDecoration(
        border: Border.all(color: Colors.white70, width: 2),
        borderRadius: BorderRadius.circular(16),
      ),
    );
  }
}

/// Dismissable error banner shown above the hint while scanning continues.
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onDismiss});

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.red.shade900.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, color: Colors.white70, size: 18),
            onPressed: onDismiss,
            tooltip: 'Dismiss',
          ),
        ],
      ),
    );
  }
}
