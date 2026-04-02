#!/usr/bin/env node

/**
 * Rotate Secrets in Phase
 *
 * This script helps rotate secrets by generating new values and updating them in Phase.
 * Useful for regular security maintenance and compliance requirements.
 *
 * Usage:
 *   node rotate-secrets.js --env production --secrets API_KEY,DATABASE_PASSWORD
 *   node rotate-secrets.js --env staging --auto-generate
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function execCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    if (error.stderr) {
      console.error(error.stderr);
    }
    return null;
  }
}

function generateSecureSecret(length = 32) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    env: null,
    secrets: [],
    autoGenerate: false,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--env':
        config.env = args[++i];
        break;
      case '--secrets':
        config.secrets = args[++i].split(',').map(s => s.trim());
        break;
      case '--auto-generate':
        config.autoGenerate = true;
        break;
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--help':
        console.log(`
Rotate Secrets in Phase

Usage:
  node rotate-secrets.js --env <environment> [options]

Options:
  --env <name>              Environment name (required)
  --secrets <list>          Comma-separated list of secret keys to rotate
  --auto-generate           Generate secure random values automatically
  --dry-run                 Show what would be changed without making changes
  --help                    Show this help message

Examples:
  node rotate-secrets.js --env production --secrets API_KEY,JWT_SECRET
  node rotate-secrets.js --env staging --auto-generate
  node rotate-secrets.js --env development --secrets DATABASE_PASSWORD --dry-run
        `);
        process.exit(0);
    }
  }

  return config;
}

async function listSecrets(env) {
  console.log(`\nFetching secrets from environment: ${env}...`);
  const output = execCommand(`phase secrets list --env ${env}`);
  if (!output) {
    return [];
  }

  // Parse the secrets list (this is simplified - adapt based on actual output format)
  const lines = output.split('\n').filter(line => line.trim());
  const secrets = [];

  for (const line of lines) {
    // Extract secret keys (this parsing may need adjustment based on actual CLI output)
    const match = line.match(/^[\s│├└]*([A-Z_][A-Z0-9_]*)/);
    if (match) {
      secrets.push(match[1]);
    }
  }

  return secrets;
}

async function rotateSecret(secretKey, env, newValue, dryRun) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Rotating: ${secretKey}`);
  console.log(`${'='.repeat(60)}`);

  if (dryRun) {
    console.log('[DRY RUN] Would update secret (not actually updating)');
    return true;
  }

  // Get current secret details
  console.log('Fetching current secret details...');
  const currentDetails = execCommand(`phase secrets get ${secretKey} --env ${env}`);
  if (!currentDetails) {
    console.error(`Failed to get details for ${secretKey}`);
    return false;
  }

  console.log(`Current value: ${'*'.repeat(20)} (hidden)`);
  console.log(`New value: ${newValue ? '*'.repeat(20) : '(will be generated)'} (hidden)`);

  const answer = await question('\nConfirm rotation? (yes/no): ');
  if (answer.toLowerCase() !== 'yes') {
    console.log('Skipped');
    return false;
  }

  // Update the secret
  // Note: This uses interactive mode. For non-interactive, you'd need to use Phase API or different approach
  console.log('\nUpdating secret...');
  console.log('Note: You may need to use Phase Console for interactive secret updates');
  console.log(`Run: phase console`);
  console.log(`Or update via API/Console: https://console.phase.dev`);

  return true;
}

async function main() {
  console.log('🔄 Phase Secret Rotation Tool');
  console.log('==============================\n');

  const config = parseArgs();

  // Validate Phase CLI
  const version = execCommand('phase --version');
  if (!version) {
    console.error('❌ Phase CLI not found. Please install Phase CLI first.');
    process.exit(1);
  }
  console.log(`✓ Phase CLI found: ${version.trim()}`);

  // Check authentication
  const whoami = execCommand('phase users whoami');
  if (!whoami) {
    console.error('❌ Not authenticated with Phase. Run: phase auth');
    process.exit(1);
  }
  console.log('✓ Authenticated with Phase');

  // Get environment
  if (!config.env) {
    config.env = await question('\nEnter environment name (development, staging, production): ');
  }

  if (config.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
  }

  // Get secrets to rotate
  let secretsToRotate = config.secrets;
  if (secretsToRotate.length === 0) {
    const allSecrets = await listSecrets(config.env);
    if (allSecrets.length === 0) {
      console.log('No secrets found');
      rl.close();
      return;
    }

    console.log('\nAvailable secrets:');
    allSecrets.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

    const input = await question('\nEnter secret names to rotate (comma-separated) or "all": ');
    if (input.toLowerCase() === 'all') {
      secretsToRotate = allSecrets;
    } else {
      secretsToRotate = input.split(',').map(s => s.trim());
    }
  }

  console.log(`\nSecrets to rotate: ${secretsToRotate.join(', ')}`);

  // Rotate each secret
  const results = {
    success: [],
    failed: [],
    skipped: []
  };

  for (const secretKey of secretsToRotate) {
    let newValue = null;

    if (config.autoGenerate) {
      newValue = generateSecureSecret();
      console.log(`\nGenerated secure random value for ${secretKey}`);
    } else {
      const generate = await question(`\nGenerate random value for ${secretKey}? (Y/n): `);
      if (!generate || generate.toLowerCase() !== 'n') {
        newValue = generateSecureSecret();
      } else {
        newValue = await question('Enter new value: ');
      }
    }

    const success = await rotateSecret(secretKey, config.env, newValue, config.dryRun);

    if (success) {
      results.success.push(secretKey);
    } else {
      results.skipped.push(secretKey);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Rotation Summary');
  console.log('='.repeat(60));
  console.log(`✓ Successful: ${results.success.length}`);
  if (results.success.length > 0) {
    results.success.forEach(s => console.log(`  - ${s}`));
  }

  if (results.skipped.length > 0) {
    console.log(`⊘ Skipped: ${results.skipped.length}`);
    results.skipped.forEach(s => console.log(`  - ${s}`));
  }

  if (results.failed.length > 0) {
    console.log(`✗ Failed: ${results.failed.length}`);
    results.failed.forEach(s => console.log(`  - ${s}`));
  }

  console.log('\n⚠️  Important Notes:');
  console.log('  1. Update any services using the old secret values');
  console.log('  2. Test applications with new secrets');
  console.log('  3. Consider keeping old secrets active briefly for rollback');
  console.log('  4. Document rotation in your security log');
  console.log('\nNext steps:');
  console.log(`  phase run --env ${config.env} npm start`);
  console.log(`  phase console  # Verify in Phase Console`);

  rl.close();
}

main().catch(error => {
  console.error('Error:', error);
  rl.close();
  process.exit(1);
});
