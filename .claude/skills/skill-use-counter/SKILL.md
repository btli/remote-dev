---
name: skill-use-counter
description: Track and analyze skill usage statistics in Claude projects to understand which skills are most useful and optimize context usage. Use this skill when recording skill invocations, generating usage reports, or analyzing which skills provide the most value. This helps Claude make informed decisions about which skills to prioritize and when to use them.
license: Complete terms in LICENSE.txt
---

# Skill Use Counter

## Overview

This skill provides tools to track and analyze skill usage patterns in Claude projects. By collecting usage statistics locally, it helps understand which skills are most valuable, which are underutilized, and how much context is being saved by using skills effectively. This data enables more efficient context management and helps prioritize the most useful skills.

## When to Use This Skill

Use this skill in the following scenarios:

1. **After Skill Invocation**: After using any skill, record the invocation to track usage patterns
2. **Generating Reports**: When the user requests skill usage statistics or wants to understand which skills are most helpful
3. **Context Optimization**: When analyzing how much context is being saved by using skills instead of loading full documentation
4. **Skill Portfolio Review**: When evaluating which skills to keep, improve, or deprecate in a project

## Core Capabilities

### 1. Track Skill Usage

Record skill invocations with detailed metadata to build a comprehensive usage history.

**When to track:**
- After successfully using a skill
- After a skill invocation fails (to identify problematic skills)
- When a skill saves significant context (to measure efficiency)

**How to track:**

```bash
# Basic tracking (successful invocation)
python3 scripts/track_usage.py "skill-name"

# Track with failure status
python3 scripts/track_usage.py "skill-name" --failed

# Track with context savings estimate
python3 scripts/track_usage.py "skill-name" --context-saved 5000

# Track with notes
python3 scripts/track_usage.py "skill-name" --notes "Used to generate API documentation"

# Track with all details
python3 scripts/track_usage.py "skill-name" --context-saved 3000 --notes "Helped avoid loading 3 large reference files"
```

**Best practices for tracking:**
- Track immediately after skill invocation while the context is fresh
- Estimate context savings by considering how much documentation/code would have been loaded without the skill
- Add notes for unusual cases or particularly useful applications
- Mark failures to identify skills that need improvement

### 2. Generate Usage Reports

Create comprehensive reports showing skill usage patterns, success rates, and insights.

**Report types:**

**Summary Report** - Overview of all skill usage:
```bash
# Full summary
python3 scripts/generate_report.py --format summary

# Last 30 days only
python3 scripts/generate_report.py --format summary --days 30

# Save to file
python3 scripts/generate_report.py --format summary --output skill_report.txt
```

**Insights Report** - Actionable insights about skill usage patterns:
```bash
# Generate insights
python3 scripts/generate_report.py --format insights

# Recent insights (last 7 days)
python3 scripts/generate_report.py --format insights --days 7
```

**Complete Report** - Both summary and insights:
```bash
# Full report (default)
python3 scripts/generate_report.py

# Recent activity
python3 scripts/generate_report.py --days 14
```

### 3. Analyze and Optimize

Use the generated reports to make informed decisions about skill usage and context management.

**Key metrics to analyze:**

1. **Most Used Skills**: Identify which skills provide the most value through frequent use
2. **Success Rates**: Find skills that may need improvement or documentation updates
3. **Context Savings**: Measure efficiency gains from using skills vs. loading full documentation
4. **Underutilized Skills**: Discover skills that haven't been used recently (potential candidates for removal)
5. **Usage Patterns**: Understand which skills are used together or in sequence

**Optimization strategies:**

- **High usage + high success rate**: Keep these skills and consider expanding their capabilities
- **High usage + low success rate**: Prioritize improving these skills or their documentation
- **Low usage + high context savings**: Promote these skills more actively
- **Low usage + old last-used date**: Consider removing or consolidating these skills

## Data Storage

All usage data is stored in `.claude/skill_usage_data.json` in the project root. The data structure includes:

```json
{
  "skills": {
    "skill-name": {
      "total_invocations": 10,
      "successful_invocations": 9,
      "failed_invocations": 1,
      "total_context_saved": 15000,
      "first_used": "2025-10-24T10:00:00",
      "last_used": "2025-10-24T14:30:00",
      "invocations": [
        {
          "timestamp": "2025-10-24T14:30:00",
          "success": true,
          "context_saved": 2000,
          "notes": "Optional notes about this invocation"
        }
      ]
    }
  },
  "metadata": {
    "created": "2025-10-20T09:00:00"
  }
}
```

The data file:
- Automatically creates the `.claude/` directory if it doesn't exist
- Searches upward from the current directory to find the project root
- Updates atomically to prevent data corruption
- Can be safely committed to version control (contains no sensitive data)

## Workflow Examples

### Example 1: After Using a Skill

```
User: "Use the pdf-editor skill to rotate this PDF"
Claude: [Uses pdf-editor skill successfully]
Claude: [Tracks the usage] python3 ~/.claude/skills/skill-use-counter/scripts/track_usage.py "pdf-editor" --context-saved 2000 --notes "Rotated pages without loading PDF manipulation docs"
```

### Example 2: Weekly Review

```
User: "Show me which skills I've been using this week"
Claude: [Generates report] python3 ~/.claude/skills/skill-use-counter/scripts/generate_report.py --days 7
Claude: [Interprets results and provides recommendations]
```

### Example 3: Context Optimization

```
User: "Which skills are saving me the most context?"
Claude: [Generates insights report] python3 ~/.claude/skills/skill-use-counter/scripts/generate_report.py --format insights
Claude: [Highlights context-saving champions and provides recommendations]
```

## Integration with Other Skills

To maximize effectiveness, integrate usage tracking with other skills:

1. **After skill-creator**: Track usage of newly created skills to validate they're useful
2. **With all skills**: Add tracking calls after using any skill to build comprehensive data
3. **Before skill removal**: Check usage stats to make informed decisions about which skills to keep

## Privacy and Security

- All data is stored locally in the project
- No data is transmitted to external services
- Usage notes may contain project-specific information (review before sharing)
- Data file can be added to `.gitignore` if needed

## Resources

### scripts/

- **track_usage.py**: Records skill invocations with metadata (success/failure, context savings, notes)
- **generate_report.py**: Generates comprehensive usage reports and insights from collected data

Both scripts automatically locate the project's `.claude/` directory and work from any subdirectory within the project.
