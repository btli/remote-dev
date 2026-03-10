#!/usr/bin/env bash
set -euo pipefail

# Remote Dev Release Packer
#
# Assembles a self-contained release tarball for a target platform.
# Expects Next.js and terminal builds to be already completed.
#
# Usage:
#   ./scripts/pack-release.sh --platform linux-x64 [--rdv-binary path/to/rdv]
#
# Prerequisites:
#   bun run build           (Next.js standalone)
#   bun run terminal:build  (dist-terminal/)
#   cargo build --release   (rdv CLI, optional)
#
# Output:
#   dist/remote-dev-<version>-<platform>.tar.gz
#   dist/checksums.txt (appended)

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse arguments
PLATFORM=""
RDV_BINARY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --platform) PLATFORM="$2"; shift 2 ;;
    --rdv-binary) RDV_BINARY="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --platform <PLATFORM> [--rdv-binary <PATH>]"
      echo ""
      echo "Platforms: linux-x64, linux-arm64, darwin-x64, darwin-arm64"
      echo ""
      echo "Example:"
      echo "  $0 --platform darwin-arm64 --rdv-binary target/release/rdv"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PLATFORM" ]]; then
  echo "Error: --platform is required"
  echo "Use --help for usage"
  exit 1
fi

# Read version from package.json
VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)")
TARBALL_NAME="remote-dev-${VERSION}-${PLATFORM}"
DIST_DIR="$PROJECT_ROOT/dist"
STAGING_DIR="$DIST_DIR/$TARBALL_NAME"

echo "=== Remote Dev Release Packer ==="
echo "Version:  $VERSION"
echo "Platform: $PLATFORM"
echo "Output:   $DIST_DIR/$TARBALL_NAME.tar.gz"
echo ""

# Verify build artifacts exist
if [[ ! -d "$PROJECT_ROOT/.next/standalone" ]]; then
  echo "Error: .next/standalone not found. Run 'bun run build' first."
  exit 1
fi

if [[ ! -d "$PROJECT_ROOT/dist-terminal" ]]; then
  echo "Error: dist-terminal/ not found. Run 'bun run terminal:build' first."
  exit 1
fi

# Initialize checksums file (truncate if re-running)
mkdir -p "$DIST_DIR"
> "$DIST_DIR/checksums.txt"

# Clean and create staging directory
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"/{app,bin,service-config}

# ─── App files ────────────────────────────────────────────────────────────────

echo "Copying Next.js standalone build..."
cp -r "$PROJECT_ROOT/.next/standalone/." "$STAGING_DIR/app/"

# Static files (not included in standalone by default)
echo "Copying static assets..."
mkdir -p "$STAGING_DIR/app/.next"
cp -r "$PROJECT_ROOT/.next/static" "$STAGING_DIR/app/.next/static"

# Public directory
if [[ -d "$PROJECT_ROOT/public" ]]; then
  cp -r "$PROJECT_ROOT/public" "$STAGING_DIR/app/public"
fi

# Terminal server bundle
echo "Copying terminal server..."
cp -r "$PROJECT_ROOT/dist-terminal" "$STAGING_DIR/app/dist-terminal"

# Native modules needed by dist-terminal (node-pty, better-sqlite3)
echo "Copying native modules..."
for MODULE in node-pty better-sqlite3 @libsql; do
  MODULE_PATH="$PROJECT_ROOT/node_modules/$MODULE"
  if [[ -d "$MODULE_PATH" ]]; then
    DEST="$STAGING_DIR/app/node_modules/$MODULE"
    mkdir -p "$(dirname "$DEST")"
    cp -r "$MODULE_PATH" "$DEST"
  fi
done

# Standalone server wrapper
cp "$PROJECT_ROOT/scripts/standalone-server.js" "$STAGING_DIR/app/scripts/"

# Drizzle migration files (if any)
if [[ -d "$PROJECT_ROOT/drizzle" ]]; then
  cp -r "$PROJECT_ROOT/drizzle" "$STAGING_DIR/app/drizzle"
fi

# Package.json (for version detection)
cp "$PROJECT_ROOT/package.json" "$STAGING_DIR/app/package.json"

# ─── rdv binary ──────────────────────────────────────────────────────────────

if [[ -n "$RDV_BINARY" && -f "$RDV_BINARY" ]]; then
  echo "Including rdv binary..."
  cp "$RDV_BINARY" "$STAGING_DIR/bin/rdv"
  chmod +x "$STAGING_DIR/bin/rdv"
else
  echo "Note: No rdv binary provided (--rdv-binary). Skipping."
fi

# ─── Service configs ─────────────────────────────────────────────────────────

echo "Including service configurations..."
cp "$PROJECT_ROOT/scripts/service-config/"* "$STAGING_DIR/service-config/"

# ─── Install script ──────────────────────────────────────────────────────────

cp "$PROJECT_ROOT/scripts/install.sh" "$STAGING_DIR/install.sh"
chmod +x "$STAGING_DIR/install.sh"

# ─── Create tarball ──────────────────────────────────────────────────────────

echo ""
echo "Creating tarball..."
mkdir -p "$DIST_DIR"

cd "$DIST_DIR"
tar -czf "$TARBALL_NAME.tar.gz" "$TARBALL_NAME"

# Compute checksum
CHECKSUM=$(shasum -a 256 "$TARBALL_NAME.tar.gz" | awk '{print $1}')
echo "$CHECKSUM  $TARBALL_NAME.tar.gz" >> "$DIST_DIR/checksums.txt"

# Clean up staging directory
rm -rf "$STAGING_DIR"

# Print summary
TARBALL_SIZE=$(du -h "$TARBALL_NAME.tar.gz" | awk '{print $1}')
echo ""
echo "=== Release packed ==="
echo "File:     $DIST_DIR/$TARBALL_NAME.tar.gz"
echo "Size:     $TARBALL_SIZE"
echo "SHA-256:  $CHECKSUM"
echo ""
