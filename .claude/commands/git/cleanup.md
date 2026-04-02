---
description: Clean up merged branches and sync repository
---

Automated git repository cleanup and maintenance.

**Purpose**: Clean up merged branches, prune remote references, and optimize repository.

## Workflow

### 1. Fetch Latest from Remote

**Actions**:
```bash
git fetch --all --prune
```

**Updates**:
- Fetch all branches from all remotes
- Remove remote-tracking branches that no longer exist
- Update remote branch information

### 2. List Merged Branches

**Find branches merged into main**:
```bash
git branch --merged main
```

**Exclude protected branches**:
- main
- master
- develop
- staging
- production

**Report**:
- List all merged feature branches
- Show last commit date for each
- Identify stale branches (>30 days)

### 3. Delete Local Merged Branches

**Safety checks**:
- Verify branch is fully merged
- Confirm not on the branch being deleted
- Skip protected branches

**Actions**:
```bash
git branch -d [merged-branch]
```

**For each merged branch**:
- Delete if fully merged to main
- Skip if current branch
- Report deletion status

### 4. Prune Remote-Tracking Branches

**Remove stale remote references**:
```bash
git remote prune origin
```

**Identifies**:
- Remote branches that have been deleted
- Stale remote-tracking branches
- Outdated references

### 5. Clean Up Remote Branches (Optional)

**Ask for confirmation** before deleting remote branches:
- List remote branches that are merged
- Exclude protected branches
- Show last activity date

**If confirmed**:
```bash
git push origin --delete [branch-name]
```

**Safety**: Only delete if branch is merged to main on remote.

### 6. Garbage Collection

**Optimize repository**:
```bash
git gc --auto
```

**Actions**:
- Remove unreachable objects
- Compress file revisions
- Optimize pack files
- Clean up reflog

### 7. Verify Repository Health

**Checks**:
```bash
git fsck --full
```

**Validates**:
- Repository integrity
- Object consistency
- Reference validity

### 8. Show Remaining Branches

**Display**:
- All local branches
- All remote branches
- Branch tracking information
- Last commit date for each

### 9. Generate Cleanup Report

**Summary includes**:
- 🗑️ Local branches deleted: [count]
- 🌐 Remote branches deleted: [count]
- 🔄 Remote references pruned: [count]
- 💾 Repository optimized: [size saved]
- 📊 Remaining branches: [count]
- ⚠️ Warnings (if any)

## Safety Features

**Protected Branches** (never deleted):
- main
- master
- develop
- development
- staging
- production
- release/*
- hotfix/*

**Verification Steps**:
- Confirm branch is fully merged
- Check not currently on branch
- Verify branch exists before delete
- Ask confirmation for remote deletions

**Rollback**:
- Deleted branches can be recovered using reflog
- Provide recovery instructions if needed
- Show reflog entries for deleted branches

## Advanced Options

**Dry Run Mode**:
- Show what would be deleted
- Don't actually delete anything
- Useful for preview

**Aggressive Cleanup**:
- Delete branches merged to any branch (not just main)
- Remove branches older than 30 days
- Force garbage collection

**Custom Base Branch**:
- Specify different base branch (not main)
- Useful for multi-branch workflows

## Use TodoWrite

Track cleanup progress:
- Fetching updates
- Finding merged branches
- Deleting local branches
- Pruning remote references
- Garbage collection
- Verification

## Autonomous Execution

**Continue automatically** through steps 1-4, 6-9.

**Ask for confirmation** only on:
- Step 5: Deleting remote branches
- Aggressive cleanup options
- If many branches will be deleted (>10)

## Usage Examples

```
User: /git:cleanup
User: /git:cleanup --dry-run
User: /git:cleanup --aggressive
User: /git:cleanup --base develop
```

## Integration with Other Commands

**Run after**:
- `/test-fix-deploy` - Clean up after feature merge
- Completing a sprint or release
- Major repository reorganization

**Complements**:
- `/git:feature` - Create new branches on clean slate
- Regular maintenance schedule (weekly/monthly)
