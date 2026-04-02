Run Home Assistant integration quality scale validation.

**Purpose**: Validate compliance with Home Assistant quality scale tiers (Bronze, Silver, Gold, Platinum).

**Validation Levels**:
- Platinum (3 requirements) - Async dependency, websession injection, strict typing
- Gold (5 requirements) - Translations, reconfiguration, documentation, tests, code quality
- Silver (10 requirements) - Service exceptions, unload support, entity availability, etc.
- Bronze (18 requirements) - Basic integration requirements

**Workflow**:

1. **Run Tier Validation Scripts**
   - python3 tests/validate_platinum_tier.py
   - python3 tests/validate_gold_tier.py
   - python3 tests/validate_silver_tier.py
   - python3 tests/validate_bronze_tier.py

2. **Check Manifest Compliance**
   - Verify manifest.json structure
   - Check required fields
   - Validate version format

3. **Validate Translations**
   - Check strings.json exists
   - Verify translations/ directory
   - Check for translation completeness

4. **Run Code Quality Checks**
   - mypy strict type checking
   - ruff linting
   - pytest with >95% coverage target

5. **Check Entity Naming**
   - Verify entity naming conventions
   - Check unique IDs format
   - Validate device classes

6. **HACS Compliance**
   - Verify repository structure
   - Check for required files (README, info.md, etc.)

**Report**:
- ✅ Requirements met by tier
- ❌ Requirements failed with details
- 📋 Improvement suggestions
- 🎯 Next tier requirements
- 🏆 Current tier status

**Use TodoWrite**: Track validation progress through each tier.

**Continue automatically** through all validation steps without asking for confirmation.
