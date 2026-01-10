# Learning System Integration Action Plan

**Date:** 2025-01-09
**Priority:** CRITICAL
**Status:** Not Integrated

## Problem Summary

The learning system has a complete backend implementation but is **completely disconnected from the UI**:

| Layer | Status | Problem |
|-------|--------|---------|
| Domain Entity | Complete | - |
| Service Layer | Complete | - |
| API Routes | Complete | - |
| React Hook | Complete | - |
| UI Component | Exists | **Never used - 0 imports** |
| Navigation | Missing | **No way to access it** |
| Auto-learning | Missing | **Never triggered** |
| CLI Commands | Documented | **Not implemented in rdv** |

## Evidence

### ProjectKnowledgePanel Never Used

```bash
$ grep -r "ProjectKnowledgePanel" src/
# Only found in:
# - src/components/orchestrator/index.ts (export)
# - src/components/orchestrator/ProjectKnowledgePanel.tsx (definition)
# NOT imported anywhere else!
```

### "Add" Buttons Are Non-Functional

```tsx
// In ProjectKnowledgePanel.tsx line 419-437
function EmptyState({ ... }) {
  return (
    <Button variant="outline" size="sm">  // No onClick handler!
      <Plus className="h-3 w-3 mr-1" />
      {action}
    </Button>
  );
}
```

### No Automatic Learning Trigger

```bash
$ grep -r "updateFromTaskAnalysis" src/
# Only found in:
# - src/services/project-knowledge-service.ts (definition)
# - src/infrastructure/container.ts (registration)
# NEVER CALLED!
```

## Action Plan

### Phase 1: Make Knowledge Panel Accessible (Day 1)

#### 1.1 Add to Sidebar Context Menu

**File:** `src/components/session/Sidebar.tsx`

Add "View Knowledge" option to folder context menu:

```tsx
// In folder context menu items
{
  label: "View Knowledge",
  icon: <BookOpen className="h-4 w-4" />,
  onClick: () => setKnowledgePanelOpen(true),
}
```

#### 1.2 Create Knowledge Modal

**New File:** `src/components/knowledge/ProjectKnowledgeModal.tsx`

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProjectKnowledgePanel } from "@/components/orchestrator/ProjectKnowledgePanel";

interface Props {
  folderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectKnowledgeModal({ folderId, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Project Knowledge</DialogTitle>
        </DialogHeader>
        <ProjectKnowledgePanel folderId={folderId} className="h-[60vh]" />
      </DialogContent>
    </Dialog>
  );
}
```

#### 1.3 Add to Folder Preferences Modal

**File:** `src/components/folder/FolderPreferencesModal.tsx`

Add "Knowledge" tab alongside existing tabs.

### Phase 2: Fix Add/Edit Functionality (Day 2)

#### 2.1 Create Add Convention Dialog

**New File:** `src/components/knowledge/AddConventionDialog.tsx`

```tsx
interface Props {
  folderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

export function AddConventionDialog({ folderId, open, onOpenChange, onAdded }: Props) {
  const { addConvention } = useProjectKnowledge({ folderId });
  const [form, setForm] = useState({
    category: "code_style",
    description: "",
    examples: [""],
  });

  const handleSubmit = async () => {
    await addConvention({
      ...form,
      confidence: 1.0,
      source: "manual",
    });
    onAdded();
    onOpenChange(false);
  };

  // ... form UI
}
```

#### 2.2 Update EmptyState Buttons

**File:** `src/components/orchestrator/ProjectKnowledgePanel.tsx`

```tsx
function EmptyState({ icon: Icon, message, action, onAdd }: EmptyStateProps) {
  return (
    <Button variant="outline" size="sm" onClick={onAdd}>
      <Plus className="h-3 w-3 mr-1" />
      {action}
    </Button>
  );
}
```

### Phase 3: Wire Automatic Learning (Day 3)

#### 3.1 Create Session Analysis Hook

**File:** `src/app/api/sessions/[id]/route.ts` (DELETE handler)

```typescript
// When session is closed, trigger learning
if (session.status === "active") {
  // Queue learning analysis
  await container.projectKnowledgeService.updateFromTaskAnalysis({
    folderId: session.folderId,
    sessionId: session.id,
    transcript: await getSessionTranscript(session.id),
  });
}
```

#### 3.2 Add Learning Notification

**File:** `src/components/notifications/LearningNotification.tsx`

```tsx
export function LearningNotification({ learnings }: { learnings: Learning[] }) {
  return (
    <Toast>
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4" />
        <span>Learned {learnings.length} new pattern(s)</span>
      </div>
    </Toast>
  );
}
```

#### 3.3 Connect to Session Close Event

**File:** `src/contexts/SessionContext.tsx`

```typescript
const closeSession = async (id: string) => {
  const result = await api.closeSession(id);

  // Show learning notification if any
  if (result.learnings?.length > 0) {
    toast({
      title: "Knowledge Updated",
      description: `Learned ${result.learnings.length} new pattern(s)`,
    });
  }
};
```

### Phase 4: Add Search Interface (Day 4)

#### 4.1 Add Search Input to Panel

**File:** `src/components/orchestrator/ProjectKnowledgePanel.tsx`

```tsx
const [searchQuery, setSearchQuery] = useState("");
const { knowledge, search, searchResults } = useProjectKnowledge({ folderId });

// In header
<Input
  placeholder="Search knowledge..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  onKeyDown={(e) => e.key === "Enter" && search(searchQuery)}
/>
```

### Phase 5: Implement CLI Commands (Day 5)

#### 5.1 Implement rdv learn analyze

**File:** `crates/rdv/src/commands/learn.rs`

Wire `analyze` command to:
1. Capture tmux scrollback
2. Call transcript analysis service
3. Store in project knowledge

#### 5.2 Implement rdv learn extract

Batch process all transcripts in folder:
1. List `.remote-dev/transcripts/*.jsonl`
2. Analyze each one
3. Merge learnings into knowledge base

#### 5.3 Implement rdv learn apply

Generate CLAUDE.md section from knowledge:
1. Load project knowledge
2. Format as markdown
3. Append to CLAUDE.md

### Phase 6: Agent Performance Tracking (Week 2)

#### 6.1 Track Task Outcomes

```typescript
interface TaskOutcome {
  taskType: string;
  agentProvider: string;
  success: boolean;
  duration: number;
  errorCount: number;
}

// In ProjectKnowledgeService
updateAgentPerformance(outcome: TaskOutcome): void {
  // Update agent performance matrix
}
```

#### 6.2 Show Performance in UI

Add "Performance" tab to ProjectKnowledgePanel showing:
- Success rate by agent
- Average duration by task type
- Recommended agent per task type

## File Changes Summary

### New Files
- `src/components/knowledge/ProjectKnowledgeModal.tsx`
- `src/components/knowledge/AddConventionDialog.tsx`
- `src/components/knowledge/AddPatternDialog.tsx`
- `src/components/knowledge/AddSkillDialog.tsx`
- `src/components/knowledge/AddToolDialog.tsx`
- `src/components/knowledge/index.ts`
- `src/components/notifications/LearningNotification.tsx`

### Modified Files
- `src/components/session/Sidebar.tsx` - Add "View Knowledge" menu item
- `src/components/folder/FolderPreferencesModal.tsx` - Add "Knowledge" tab
- `src/components/orchestrator/ProjectKnowledgePanel.tsx` - Fix buttons, add search
- `src/app/api/sessions/[id]/route.ts` - Trigger learning on close
- `src/contexts/SessionContext.tsx` - Show learning notification
- `crates/rdv/src/commands/learn.rs` - Implement CLI commands

## Success Criteria

1. **Accessible:** User can open ProjectKnowledgePanel from sidebar context menu
2. **Editable:** User can add/edit/delete conventions, patterns, skills, tools
3. **Automatic:** Learning is triggered when sessions close
4. **Notified:** User sees toast when new learnings are extracted
5. **Searchable:** User can search knowledge with semantic search
6. **CLI Works:** `rdv learn analyze/extract/apply` commands work

## Dependencies

- Embedding service for semantic search
- Transcript storage for session analysis
- Toast/notification system for alerts

## Risks

1. **Performance:** Transcript analysis could be slow for long sessions
   - Mitigation: Queue analysis, show progress indicator

2. **Quality:** Auto-extracted learnings may be low quality
   - Mitigation: Default to low confidence, require verification

3. **Storage:** Knowledge could grow unbounded
   - Mitigation: Age out old learnings, consolidate duplicates
