// File generated manually from google-services.json / GoogleService-Info.plist.
// ignore_for_file: type=lint
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError(
        'DefaultFirebaseOptions have not been configured for web.',
      );
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are not supported for this platform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBf0FkLhOmOxQl_tl5CCGwOY-4gyd84jcs',
    appId: '1:324706718241:android:d907c351024c6807d88960',
    messagingSenderId: '324706718241',
    projectId: 'remote-dev-cc29e',
    storageBucket: 'remote-dev-cc29e.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyCiUypimFr-5UynDTtu8dm4acrNJfJHUYY',
    appId: '1:324706718241:ios:5a91afb31297b027d88960',
    messagingSenderId: '324706718241',
    projectId: 'remote-dev-cc29e',
    storageBucket: 'remote-dev-cc29e.firebasestorage.app',
    iosBundleId: 'com.remotedev.app',
  );
}
