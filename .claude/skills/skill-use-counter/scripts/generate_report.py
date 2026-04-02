#!/usr/bin/env python3
"""
Generate skill usage statistics and reports.
This script analyzes skill usage data to provide insights about which skills are most useful.
"""

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


def get_data_file_path() -> Path:
    """Get the path to the skill usage data file in the project's .claude directory."""
    current = Path.cwd()
    while current != current.parent:
        claude_dir = current / ".claude"
        if claude_dir.exists() and claude_dir.is_dir():
            data_file = claude_dir / "skill_usage_data.json"
            return data_file
        current = current.parent
    return Path.cwd() / ".claude" / "skill_usage_data.json"


def load_data(data_file: Path) -> dict:
    """Load skill usage data."""
    if not data_file.exists():
        return {"skills": {}, "metadata": {}}
    with open(data_file, 'r') as f:
        return json.load(f)


def parse_iso_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO format date string."""
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None


def format_timedelta(td: timedelta) -> str:
    """Format timedelta in a human-readable way."""
    days = td.days
    hours, remainder = divmod(td.seconds, 3600)
    minutes, _ = divmod(remainder, 60)

    if days > 0:
        return f"{days} day{'s' if days != 1 else ''}"
    elif hours > 0:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    else:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"


def generate_summary_report(data: dict, days: Optional[int] = None) -> str:
    """Generate a summary report of skill usage."""
    if not data["skills"]:
        return "No skill usage data recorded yet."

    # Filter by date if specified
    cutoff_date = None
    if days:
        cutoff_date = datetime.now() - timedelta(days=days)

    lines = []
    lines.append("=" * 70)
    lines.append("SKILL USAGE REPORT")
    if days:
        lines.append(f"(Last {days} days)")
    lines.append("=" * 70)
    lines.append("")

    # Sort skills by total invocations
    sorted_skills = sorted(
        data["skills"].items(),
        key=lambda x: x[1]["total_invocations"],
        reverse=True
    )

    total_invocations = 0
    total_context_saved = 0

    for skill_name, skill_data in sorted_skills:
        # Filter invocations by date if specified
        invocations = skill_data["invocations"]
        if cutoff_date:
            invocations = [
                inv for inv in invocations
                if parse_iso_date(inv["timestamp"]) and parse_iso_date(inv["timestamp"]) >= cutoff_date
            ]

        if not invocations and days:
            continue

        count = len(invocations) if days else skill_data["total_invocations"]
        successful = sum(1 for inv in invocations if inv.get("success", True)) if days else skill_data["successful_invocations"]
        failed = count - successful
        success_rate = (successful / count * 100) if count > 0 else 0

        context_saved = sum(inv.get("context_saved", 0) for inv in invocations) if days else skill_data.get("total_context_saved", 0)

        total_invocations += count
        total_context_saved += context_saved

        lines.append(f"📊 {skill_name}")
        lines.append(f"   Invocations: {count} (✅ {successful}, ❌ {failed})")
        lines.append(f"   Success Rate: {success_rate:.1f}%")

        if context_saved > 0:
            lines.append(f"   Context Saved: ~{context_saved:,} tokens")

        # Show last used
        last_used = parse_iso_date(skill_data.get("last_used"))
        if last_used:
            time_ago = datetime.now() - last_used
            lines.append(f"   Last Used: {format_timedelta(time_ago)} ago")

        lines.append("")

    # Summary statistics
    lines.append("=" * 70)
    lines.append("SUMMARY")
    lines.append("=" * 70)
    lines.append(f"Total Skills Tracked: {len([s for s, d in sorted_skills if not days or any(parse_iso_date(inv['timestamp']) >= cutoff_date for inv in d['invocations'] if parse_iso_date(inv['timestamp']))])}")
    lines.append(f"Total Invocations: {total_invocations}")
    if total_context_saved > 0:
        lines.append(f"Total Context Saved: ~{total_context_saved:,} tokens")
    lines.append("")

    return "\n".join(lines)


def generate_skill_insights(data: dict) -> str:
    """Generate insights about skill usage patterns."""
    if not data["skills"]:
        return "No skill usage data available for insights."

    lines = []
    lines.append("=" * 70)
    lines.append("SKILL INSIGHTS")
    lines.append("=" * 70)
    lines.append("")

    # Most used skills
    most_used = sorted(
        data["skills"].items(),
        key=lambda x: x[1]["total_invocations"],
        reverse=True
    )[:3]

    if most_used:
        lines.append("🏆 Most Used Skills:")
        for i, (skill_name, skill_data) in enumerate(most_used, 1):
            lines.append(f"   {i}. {skill_name} ({skill_data['total_invocations']} invocations)")
        lines.append("")

    # Most reliable skills (high success rate with >2 invocations)
    reliable = [
        (name, data)
        for name, data in data["skills"].items()
        if data["total_invocations"] > 2
    ]
    reliable = sorted(
        reliable,
        key=lambda x: x[1]["successful_invocations"] / x[1]["total_invocations"],
        reverse=True
    )[:3]

    if reliable:
        lines.append("✅ Most Reliable Skills:")
        for i, (skill_name, skill_data) in enumerate(reliable, 1):
            success_rate = skill_data["successful_invocations"] / skill_data["total_invocations"] * 100
            lines.append(f"   {i}. {skill_name} ({success_rate:.1f}% success rate)")
        lines.append("")

    # Context saving champions
    context_savers = [
        (name, data)
        for name, data in data["skills"].items()
        if data.get("total_context_saved", 0) > 0
    ]
    context_savers = sorted(
        context_savers,
        key=lambda x: x[1].get("total_context_saved", 0),
        reverse=True
    )[:3]

    if context_savers:
        lines.append("💾 Context Saving Champions:")
        for i, (skill_name, skill_data) in enumerate(context_savers, 1):
            context_saved = skill_data.get("total_context_saved", 0)
            lines.append(f"   {i}. {skill_name} (~{context_saved:,} tokens saved)")
        lines.append("")

    # Underutilized skills (not used recently)
    now = datetime.now()
    underutilized = []
    for name, skill_data in data["skills"].items():
        last_used = parse_iso_date(skill_data.get("last_used"))
        if last_used and (now - last_used).days > 30:
            underutilized.append((name, (now - last_used).days))

    if underutilized:
        underutilized = sorted(underutilized, key=lambda x: x[1], reverse=True)[:3]
        lines.append("⚠️  Underutilized Skills (not used in 30+ days):")
        for skill_name, days_ago in underutilized:
            lines.append(f"   • {skill_name} (last used {days_ago} days ago)")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Generate skill usage reports and insights"
    )
    parser.add_argument(
        "--format",
        choices=["summary", "insights", "both"],
        default="both",
        help="Report format (default: both)"
    )
    parser.add_argument(
        "--days",
        type=int,
        help="Only include data from the last N days"
    )
    parser.add_argument(
        "--output",
        help="Output file path (default: print to stdout)"
    )

    args = parser.parse_args()

    data_file = get_data_file_path()
    data = load_data(data_file)

    output_lines = []

    if args.format in ["summary", "both"]:
        output_lines.append(generate_summary_report(data, args.days))

    if args.format in ["insights", "both"]:
        if args.format == "both":
            output_lines.append("\n")
        output_lines.append(generate_skill_insights(data))

    output = "\n".join(output_lines)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
        print(f"✅ Report saved to {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
