import 'package:flutter_test/flutter_test.dart';
import 'package:remote_dev/infrastructure/url/workspace_urls.dart';

void main() {
  group('WorkspaceUrls.api (Dio request path; baseUrl is origin)', () {
    test('empty basePath returns the path unchanged', () {
      const urls = WorkspaceUrls('https://h', '');
      expect(urls.api('/api/sessions'), '/api/sessions');
    });

    test('non-empty basePath is prefixed onto the path', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(urls.api('/api/sessions'), '/demo/api/sessions');
    });

    test('adds a leading slash when the path lacks one (empty basePath)', () {
      const urls = WorkspaceUrls('https://h', '');
      expect(urls.api('api/sessions'), '/api/sessions');
    });

    test('adds a leading slash when the path lacks one (with basePath)', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(urls.api('api/sessions'), '/demo/api/sessions');
    });

    test('preserves a query string on the path', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(
        urls.api('/api/channels?nodeId=x&nodeType=project'),
        '/demo/api/channels?nodeId=x&nodeType=project',
      );
    });
  });

  group('WorkspaceUrls.web (full URL for WebView / external nav)', () {
    test('empty basePath joins origin + path', () {
      const urls = WorkspaceUrls('https://h', '');
      expect(urls.web('/m/session/abc'), 'https://h/m/session/abc');
    });

    test('non-empty basePath joins origin + basePath + path', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(urls.web('/m/session/abc'), 'https://h/demo/m/session/abc');
    });

    test('adds a leading slash when the path lacks one', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(urls.web('m/session/abc'), 'https://h/demo/m/session/abc');
    });

    test('/m/session/<id> single-workspace is byte-identical to origin+path',
        () {
      const urls = WorkspaceUrls('https://dev.example.com', '');
      expect(
        urls.web('/m/session/sess-123'),
        'https://dev.example.com/m/session/sess-123',
      );
    });

    test('github link path is base-path-prefixed', () {
      const urls = WorkspaceUrls('https://h', '/demo');
      expect(
        urls.web('/api/auth/github/link'),
        'https://h/demo/api/auth/github/link',
      );
    });
  });
}
