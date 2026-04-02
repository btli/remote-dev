#!/usr/bin/env python3
"""
Track skill usage statistics in a Claude project.
This script records skill invocations to help understand which skills are useful.
"""

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional


def get_data_file_path() -> Path:
    """Get the path to the skill usage data file in the project's .claude directory."""
    # Start from current directory and search upwards for .claude directory
    current = Path.cwd()
    while current != current.parent:
        claude_dir = current / ".claude"
        if claude_dir.exists() and claude_dir.is_dir():
            data_file = claude_dir / "skill_usage_data.json"
            return data_file
        current = current.parent

    # Fallback to current directory if no .claude directory found
    return Path.cwd() / ".claude" / "skill_usage_data.json"


def load_data(data_file: Path) -> dict:
    """Load existing skill usage data or create new structure."""
    if data_file.exists():
        with open(data_file, 'r') as f:
            return json.load(f)
    return {"skills": {}, "metadata": {"created": datetime.now().isoformat()}}


def save_data(data: dict, data_file: Path) -> None:
    """Save skill usage data to file."""
    data_file.parent.mkdir(parents=True, exist_ok=True)
    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2)


def track_skill_usage(
    skill_name: str,
    success: bool = True,
    notes: Optional[str] = None,
    context_saved: Optional[int] = None
) -> None:
    """
    Track a skill usage event.

    Args:
        skill_name: Name of the skill being tracked
        success: Whether the skill invocation was successful
        notes: Optional notes about this invocation
        context_saved: Optional estimate of context tokens saved by using this skill
    """
    data_file = get_data_file_path()
    data = load_data(data_file)

    # Initialize skill entry if it doesn't exist
    if skill_name not in data["skills"]:
        data["skills"][skill_name] = {
            "total_invocations": 0,
            "successful_invocations": 0,
            "failed_invocations": 0,
            "total_context_saved": 0,
            "first_used": datetime.now().isoformat(),
            "last_used": None,
            "invocations": []
        }

    skill_data = data["skills"][skill_name]

    # Update counts
    skill_data["total_invocations"] += 1
    if success:
        skill_data["successful_invocations"] += 1
    else:
        skill_data["failed_invocations"] += 1

    # Update context saved
    if context_saved is not None:
        skill_data["total_context_saved"] += context_saved

    # Update timestamp
    skill_data["last_used"] = datetime.now().isoformat()

    # Record invocation
    invocation = {
        "timestamp": datetime.now().isoformat(),
        "success": success
    }
    if notes:
        invocation["notes"] = notes
    if context_saved is not None:
        invocation["context_saved"] = context_saved

    skill_data["invocations"].append(invocation)

    # Save updated data
    save_data(data, data_file)
    print(f"✅ Tracked usage of '{skill_name}' skill")
    print(f"   Total invocations: {skill_data['total_invocations']}")
    print(f"   Success rate: {skill_data['successful_invocations']}/{skill_data['total_invocations']}")


def main():
    parser = argparse.ArgumentParser(
        description="Track skill usage in a Claude project"
    )
    parser.add_argument("skill_name", help="Name of the skill being tracked")
    parser.add_argument(
        "--success",
        action="store_true",
        default=True,
        help="Mark this invocation as successful (default: True)"
    )
    parser.add_argument(
        "--failed",
        action="store_true",
        help="Mark this invocation as failed"
    )
    parser.add_argument(
        "--notes",
        help="Optional notes about this invocation"
    )
    parser.add_argument(
        "--context-saved",
        type=int,
        help="Estimated context tokens saved by using this skill"
    )

    args = parser.parse_args()

    # Determine success status
    success = not args.failed

    track_skill_usage(
        skill_name=args.skill_name,
        success=success,
        notes=args.notes,
        context_saved=args.context_saved
    )


if __name__ == "__main__":
    main()
