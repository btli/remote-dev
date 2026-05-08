/// Worktree branch type determining the branch prefix.
///
/// Matches the server's `WORKTREE_TYPES` from `src/types/session.ts`.
enum WorktreeType {
  feature('feature', 'Feature'),
  fix('fix', 'Fix'),
  chore('chore', 'Chore'),
  refactor('refactor', 'Refactor'),
  docs('docs', 'Docs'),
  release('release', 'Release');

  const WorktreeType(this.value, this.displayName);
  final String value;
  final String displayName;

  static WorktreeType fromString(String? value) => switch (value) {
        'feature' => WorktreeType.feature,
        'fix' => WorktreeType.fix,
        'chore' => WorktreeType.chore,
        'refactor' => WorktreeType.refactor,
        'docs' => WorktreeType.docs,
        'release' => WorktreeType.release,
        _ => WorktreeType.feature,
      };
}
