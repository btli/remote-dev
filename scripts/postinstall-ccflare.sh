#!/usr/bin/env bash
# Postinstall script for better-ccflare
#
# The npm package ships a Linux x86_64 binary only. This script detects the
# current platform/arch and downloads the correct pre-compiled binary from
# GitHub Releases when there's a mismatch.

set -euo pipefail

PACKAGE_DIR="node_modules/better-ccflare"
BINARY_PATH="${PACKAGE_DIR}/dist/better-ccflare"
PACKAGE_JSON="${PACKAGE_DIR}/package.json"

# Skip if the package isn't installed
if [[ ! -f "$PACKAGE_JSON" ]]; then
  exit 0
fi

# Read the installed version from the package
VERSION=$(node -p "require('./${PACKAGE_JSON}').version" 2>/dev/null || echo "")
if [[ -z "$VERSION" ]]; then
  echo "[postinstall-ccflare] Could not read version from ${PACKAGE_JSON}, skipping"
  exit 0
fi

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "${OS}" in
  Linux)
    case "${ARCH}" in
      x86_64)  ASSET_NAME="better-ccflare-linux-amd64" ;;
      aarch64) ASSET_NAME="better-ccflare-linux-arm64" ;;
      *)       ASSET_NAME="" ;;
    esac
    EXPECTED_FILE_TYPE="ELF"
    ;;
  Darwin)
    case "${ARCH}" in
      arm64)   ASSET_NAME="better-ccflare-macos-arm64" ;;
      x86_64)  ASSET_NAME="better-ccflare-macos-x86_64" ;;
      *)       ASSET_NAME="" ;;
    esac
    EXPECTED_FILE_TYPE="Mach-O"
    ;;
  *)
    ASSET_NAME=""
    ;;
esac

# Unsupported platform
if [[ -z "$ASSET_NAME" ]]; then
  exit 0
fi

# Check if the current binary already matches this platform
if [[ -x "$BINARY_PATH" ]] && file "$BINARY_PATH" 2>/dev/null | grep -q "${EXPECTED_FILE_TYPE}"; then
  exit 0
fi

RELEASE_URL="https://github.com/tombii/better-ccflare/releases/download/v${VERSION}/${ASSET_NAME}"

echo "[postinstall-ccflare] Platform ${OS}/${ARCH} requires ${ASSET_NAME}"
echo "[postinstall-ccflare] Downloading v${VERSION} from GitHub Releases..."

mkdir -p "${PACKAGE_DIR}/dist"

if command -v curl &>/dev/null; then
  HTTP_CODE=$(curl -fSL -o "$BINARY_PATH" -w "%{http_code}" "$RELEASE_URL" 2>/dev/null || echo "000")
elif command -v wget &>/dev/null; then
  wget -q -O "$BINARY_PATH" "$RELEASE_URL" && HTTP_CODE="200" || HTTP_CODE="000"
else
  echo "[postinstall-ccflare] Neither curl nor wget found, skipping binary download"
  exit 0
fi

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "[postinstall-ccflare] Warning: Failed to download binary (HTTP ${HTTP_CODE})"
  echo "[postinstall-ccflare] URL: ${RELEASE_URL}"
  echo "[postinstall-ccflare] You can manually download from: https://github.com/tombii/better-ccflare/releases/tag/v${VERSION}"
  exit 0
fi

chmod +x "$BINARY_PATH"

# macOS: remove quarantine attribute so Gatekeeper doesn't block it
if [[ "$OS" == "Darwin" ]]; then
  xattr -d com.apple.quarantine "$BINARY_PATH" 2>/dev/null || true
fi

echo "[postinstall-ccflare] Installed ${ASSET_NAME} v${VERSION} successfully"
