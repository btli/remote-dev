#!/usr/bin/env bun
/**
 * Download and convert Nerd Fonts to WOFF2 for web hosting
 * Run with: bun scripts/download-nerd-fonts.ts
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync, spawnSync } from 'child_process';

const FONTS_DIR = join(dirname(import.meta.dir), 'public', 'fonts');
const NERD_FONTS_VERSION = 'v3.3.0';
const BASE_URL = `https://github.com/ryanoasis/nerd-fonts/releases/download/${NERD_FONTS_VERSION}`;

// Font mappings: [zipName, outputPrefix, ttfPattern]
const FONTS: [string, string, string][] = [
  ['JetBrainsMono', 'JetBrainsMono', 'JetBrainsMonoNerdFontMono'],
  ['FiraCode', 'FiraCode', 'FiraCodeNerdFontMono'],
  ['Hack', 'Hack', 'HackNerdFontMono'],
  ['Meslo', 'MesloLGS', 'MesloLGSNerdFontMono'],
  ['CascadiaCode', 'CaskaydiaCove', 'CaskaydiaCoveNerdFontMono'],
  ['SourceCodePro', 'SauceCodePro', 'SauceCodeProNerdFontMono'],
  ['UbuntuMono', 'UbuntuMono', 'UbuntuMonoNerdFontMono'],
  ['RobotoMono', 'RobotoMono', 'RobotoMonoNerdFontMono'],
  ['Inconsolata', 'Inconsolata', 'InconsolataNerdFontMono'],
  ['DejaVuSansMono', 'DejaVuSansMono', 'DejaVuSansMNerdFontMono'],
  ['Mononoki', 'Mononoki', 'MononokiNerdFontMono'],
  ['VictorMono', 'VictorMono', 'VictorMonoNerdFontMono'],
  ['SpaceMono', 'SpaceMono', 'SpaceMonoNerdFontMono'],
  ['Iosevka', 'Iosevka', 'IosevkaNerdFontMono'],
  ['FiraMono', 'FiraMono', 'FiraMonoNerdFontMono'],
  ['IBMPlexMono', 'BlexMono', 'BlexMonoNerdFontMono'],
  ['Cousine', 'Cousine', 'CousineNerdFontMono'],
  ['GeistMono', 'GeistMono', 'GeistMonoNerdFontMono'],
  ['CommitMono', 'CommitMono', 'CommitMonoNerdFontMono'],
  ['Monaspace', 'MonaspaceNeon', 'MonaspaceNeonNerdFontMono'],
  ['ZedMono', 'ZedMono', 'ZedMonoNerdFontMono'],
  ['0xProto', '0xProto', '0xProtoNerdFontMono'],
];

function findFiles(dir: string, pattern: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.includes(pattern)) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  walk(dir);
  return results;
}

async function downloadAndConvert(zipName: string, outputPrefix: string, ttfPatternBase: string, tempDir: string) {
  console.log(`Processing ${zipName}...`);

  const zipFile = join(tempDir, `${zipName}.zip`);
  const extractDir = join(tempDir, zipName);

  // Download
  if (!existsSync(zipFile)) {
    console.log(`  Downloading ${zipName}.zip...`);
    const response = await fetch(`${BASE_URL}/${zipName}.zip`);
    if (!response.ok) {
      console.log(`  Error: Failed to download ${zipName}.zip (${response.status})`);
      return;
    }
    const buffer = await response.arrayBuffer();
    writeFileSync(zipFile, Buffer.from(buffer));
  }

  // Extract using execFileSync (safe - no shell interpolation)
  mkdirSync(extractDir, { recursive: true });
  try {
    execFileSync('unzip', ['-qo', zipFile, '-d', extractDir], { stdio: 'pipe' });
  } catch (error) {
    console.log(`  Error extracting ${zipName}: ${error}`);
    return;
  }

  // Find and convert Regular and Bold font files (TTF or OTF)
  for (const weight of ['Regular', 'Bold']) {
    // Try TTF first, then OTF
    let fontFile: string | undefined;

    const ttfPattern = `${ttfPatternBase}-${weight}.ttf`;
    const otfPattern = `${ttfPatternBase}-${weight}.otf`;

    const ttfFiles = findFiles(extractDir, ttfPattern);
    const otfFiles = findFiles(extractDir, otfPattern);

    if (ttfFiles.length > 0) {
      fontFile = ttfFiles[0];
    } else if (otfFiles.length > 0) {
      fontFile = otfFiles[0];
    }

    if (fontFile) {
      const outputFile = join(FONTS_DIR, `${outputPrefix}-${weight}.woff2`);

      console.log(`  Converting ${weight}...`);

      // Read font file
      const fontBuffer = readFileSync(fontFile);

      // Convert using ttf2woff2 via spawnSync with stdin (works for both TTF and OTF)
      try {
        const result = spawnSync('bunx', ['ttf2woff2'], {
          input: fontBuffer,
          maxBuffer: 10 * 1024 * 1024,
        });

        if (result.error) {
          throw result.error;
        }

        if (result.status !== 0) {
          throw new Error(`ttf2woff2 exited with code ${result.status}`);
        }

        writeFileSync(outputFile, result.stdout);
        console.log(`  Created: ${outputPrefix}-${weight}.woff2`);
      } catch (error) {
        console.log(`  Warning: Failed to convert ${weight} - ${error}`);
      }
    } else {
      console.log(`  Warning: ${weight} font not found for ${zipName} (tried TTF and OTF)`);
    }
  }
}

async function main() {
  console.log('Downloading and converting Nerd Fonts to WOFF2...');
  console.log(`Output directory: ${FONTS_DIR}`);
  console.log('');

  // Create directories
  mkdirSync(FONTS_DIR, { recursive: true });
  const tempDir = join(dirname(import.meta.dir), '.font-temp');
  mkdirSync(tempDir, { recursive: true });

  // Process each font
  for (const [zipName, outputPrefix, ttfPattern] of FONTS) {
    await downloadAndConvert(zipName, outputPrefix, ttfPattern, tempDir);
    console.log('');
  }

  // Cleanup
  console.log('Cleaning up temp files...');
  rmSync(tempDir, { recursive: true, force: true });

  // List results
  console.log('Done! WOFF2 fonts created:');
  const files = readdirSync(FONTS_DIR).filter(f => f.endsWith('.woff2'));
  files.forEach(f => console.log(`  ${f}`));
  console.log(`\nTotal: ${files.length} font files`);
}

main().catch(console.error);
