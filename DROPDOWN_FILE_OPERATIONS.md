# Dropdown File Operations Bar

## Overview

The file operations control bar has been redesigned with a **Cursor-style dropdown interface** that shows individual file entries with line change statistics and per-file accept/undo controls.

## Key Features

### 1. Collapsible Dropdown

Click the header to expand/collapse the file list:

```
▼ 11 Files  [Undo All] [Keep All] [Review]
```

**Expanded State:**
```
▼ 11 Files  [Undo All] [Keep All] [Review]
  ↓ TASK_STATUS_SYSTEM.md       +229
  ↓ XML_TAG_FIX.md               +160
  ↓ ai.rs                  +156 -55
  ↓ STREAM_CANCELLATION.md       +257
  ...
```

**Collapsed State:**
```
▶ 11 Files  [Undo All] [Keep All] [Review]
```

**After Keep All (all applied):**
```
▼ 11 Files (11 applied)
  ↓ file.md              +229                ✕
  ↓ other.ts        +156 -55                 ✕
```

**Note:** Batch action buttons (Undo All, Keep All, Review) are **hidden** when all operations have been applied. The header only shows the file count with applied indicator. Users can still remove individual operations using the ✕ button.

### 2. Individual File Entries

Each file shows:
- **Icon**: `↓` for all file types (blue)
- **Filename**: Short name without path
- **Line Stats**: `+229` (additions) or `+156 -55` (adds/deletes)
- **Actions**: Accept (✓) and Reject (✕) buttons

### 3. Line Change Statistics

**Create Operations:**
- Shows total lines: `+229`
- Counts newlines in file content

**Edit Operations:**
- Shows both added and removed: `+156 -55`
- Based on `newContent` and `oldContent` line counts

**Delete Operations:**
- No stats shown (empty string)

### 4. File State Tracking

**Pending (Not Applied):**
- Normal background color
- Shows both ✓ (accept) and ✕ (reject) buttons
- Full opacity

**Applied:**
- Green tinted background: `rgba(76, 175, 80, 0.05)`
- Reduced opacity: `0.7`
- Shows only ✕ (undo) button
- Indicates file has been applied

### 5. Individual File Actions

#### Accept (✓) Button
- Applies **only that specific file operation**
- Creates/edits/deletes the file
- Marks operation as `applied: true`
- Shows green background
- Shows success notification
- Opens file in editor (for create/edit)

#### Reject/Undo (✕) Button

**For Pending Files:**
- Removes operation from list
- No file changes made
- Operation disappears from bar

**For Applied Files:**
- Removes from tracking
- **Does NOT revert file changes** (file stays modified)
- Operation disappears from bar

### 6. Batch Operations

**Important:** Batch action buttons (Undo All, Keep All, Review) are only visible when there are pending (unapplied) operations. Once all operations are applied, these buttons are hidden.

#### Keep All
- Applies **all unapplied operations** at once
- Skips already-applied operations
- Marks each as `applied: true` after success
- Shows success notification with count
- Operations stay in list (shown as applied with green background)
- **Batch buttons disappear** after all operations are applied

#### Undo All
- **Removes all operations** from tracking
- Clears the entire list
- Does not revert applied changes
- Bar disappears when empty

#### Review
- Scrolls to first file operation in messages
- Helps user review diffs before applying
- Only available when there are pending operations

**After Keep All:**
- Header shows: "11 Files (11 applied)"
- Batch action buttons are hidden
- Individual ✕ buttons remain for cleanup
- Users can manually remove applied operations from tracking

## Visual Design

### Colors & Icons

| Element | Color | Icon |
|---------|-------|------|
| File icon (all) | Blue (#2196f3) | ↓ |
| Accept button hover | Green (#4caf50) | ✓ |
| Reject/Undo hover | Red (#f44336) | ✕ |
| Applied background | Light green | - |
| Dropdown chevron | Muted | ▼/▶ |

### Layout

```
┌────────────────────────────────────────────────┐
│ ▼ 11 Files    [Undo All] [Keep All] [Review]  │ ← Header (clickable)
├────────────────────────────────────────────────┤
│ ↓ file.md              +229             ✓  ✕  │ ← Pending file
│ ↓ other.ts        +156 -55              ✓  ✕  │
│ ↓ applied.js           +100                ✕  │ ← Applied file (green bg)
└────────────────────────────────────────────────┘
```

### Hover States

- **Header**: Background changes on hover
- **File row**: Background changes on hover
- **Accept button**: Green background + icon color
- **Reject/Undo button**: Red background + icon color

## User Workflows

### Workflow 1: Review and Accept All

1. AI generates 11 file operations
2. Bar appears: "▼ 11 Files [Undo All] [Keep All] [Review]"
3. Click header to expand dropdown
4. Review each file and line stats
5. Click **"Keep All"**
6. All files applied and marked with green background
7. **Batch action buttons disappear** - header shows "11 Files (11 applied)"
8. Operations stay visible with ✕ button to remove from tracking
9. Click ✕ on individual files to clean up the list

### Workflow 2: Selective Application

1. AI generates 10 file operations
2. Click to expand dropdown
3. Review first file
4. Click ✓ (accept) on first file
5. First file applied, shown with green background
6. Review second file
7. Click ✕ (reject) on second file
8. Second file removed from list
9. Repeat for remaining files

### Workflow 3: Quick Accept with Cleanup

1. AI generates file operations
2. Click **"Keep All"** without reviewing
3. All files applied (green backgrounds)
4. **Batch action buttons disappear**
5. Header shows "X Files (X applied)"
6. Click ✕ next to each applied file to remove from tracking
7. Bar disappears when all operations are removed

### Workflow 4: Clear All Pending

1. AI generates unwanted file operations
2. Click **"Undo All"**
3. All operations removed
4. Bar disappears
5. No files were modified

## Technical Implementation

### State Management

```typescript
const [allPendingOps, setAllPendingOps] = useState<
  Array<{
    operation: FileOperation;
    messageId: string;
    applied: boolean;  // ← Tracks if file was applied
  }>
>([]);

const [fileOpsExpanded, setFileOpsExpanded] = useState(true);
```

### Line Stats Calculation

```typescript
const getLineStats = (operation: FileOperation) => {
  if (operation.type === 'create' && operation.content) {
    const lines = operation.content.split('\n').length;
    return `+${lines}`;
  }
  if (operation.type === 'edit') {
    const added = operation.newContent?.split('\n').length || 0;
    const removed = operation.oldContent?.split('\n').length || 0;
    return `+${added} -${removed}`;
  }
  return '';
};
```

### Apply Logic

**Keep All:**
```typescript
- Loops through all operations
- Skips if already applied
- Applies file operation
- Marks as applied: true
- Shows in list with green background
```

**Accept Individual:**
```typescript
- Applies single operation
- Marks that one as applied: true
- Others stay pending
```

### Applied State

**Visual indicators:**
- Green tint: `rgba(76, 175, 80, 0.05)`
- Reduced opacity: `0.7`
- Only ✕ button shown
- Class: `fileOpsItemApplied`

## Keyboard Shortcuts (Future)

Potential enhancements:
- `Cmd+A`: Keep All
- `Cmd+D`: Undo All
- `Enter`: Accept focused file
- `Delete`: Reject focused file
- `Tab`: Navigate between files
- `Space`: Toggle file selection

## Comparison with Cursor

| Feature | Cursor | OpenCodeBrew |
|---------|--------|--------------|
| Dropdown list | ✅ | ✅ |
| Line stats (+/-) | ✅ | ✅ |
| Individual accept | ✅ | ✅ |
| Individual reject | ✅ | ✅ |
| Applied state tracking | ✅ | ✅ |
| Keep All button | ✅ | ✅ |
| Undo All button | ✅ | ✅ |
| Review button | ✅ | ✅ |
| File icons | ✅ | ✅ |
| Filename truncation | ✅ | ✅ |

## Edge Cases

### No Operations
- Bar doesn't render
- Clean UI when no pending files

### All Applied
- Bar still shows with operations
- All have green backgrounds
- All show only ✕ button
- User can remove from tracking

### Large Lists
- Max height: `300px`
- Scrollable when > 300px
- Smooth scroll

### Streaming
- Operations added dynamically
- List updates in real-time
- Expand state preserved

### Mixed States
- Some applied, some pending
- Different button sets
- Different backgrounds
- Clear visual distinction

## Performance

- **Efficient rendering**: Only dropdown content when expanded
- **Lazy calculation**: Line stats computed on demand
- **Minimal re-renders**: State updates only affected operations
- **Memory efficient**: Applied operations can be manually removed

## Accessibility

- Clickable header for expand/collapse
- Clear button labels with hover titles
- Visual + text indicators for state
- Keyboard navigable (future)
- Color + opacity for applied state (not color-only)

## Files Modified

- `src/components/AI/AIPanel.tsx`:
  - Added `applied` property to operations
  - Added `fileOpsExpanded` state
  - Redesigned `FileOperationsBar` component
  - Added individual accept/undo handlers
  - Updated `handleKeepAllOperations` to mark as applied

- `src/components/AI/AIPanel.module.css`:
  - Added `.fileOpsBarHeader` styles
  - Added `.fileOpsList` dropdown styles
  - Added `.fileOpsItem` with applied state
  - Added individual button styles
  - Added line stats styling

## Future Enhancements

- **Revert applied changes**: True undo (requires git integration)
- **Diff preview**: Show inline diff for each file
- **Group by type**: Create, Edit, Delete sections
- **Search/filter**: Find specific files in large lists
- **Bulk selection**: Select multiple files with checkboxes
- **Sort options**: By name, type, size, date
- **Conflict detection**: Warn if operations conflict
- **Estimated size**: Show file size changes
- **Progress indicator**: Show which files are being applied

## Testing

### Manual Testing

1. Generate multiple file operations
2. Verify dropdown expands/collapses
3. Check line stats are accurate
4. Accept individual file - verify green background
5. Reject individual file - verify removal
6. Apply all - verify all turn green
7. Undo all - verify all removed
8. Mixed state - some applied, some pending

### Scenarios

- 1 file operation
- 10+ file operations
- All create operations
- All edit operations
- Mixed operation types
- Apply then undo individual
- Keep All then review
- Streaming updates

## Notes

- Operations persist in bar after applying (shown as applied)
- Undo/reject removes from tracking only (doesn't revert files)
- Applied files can be removed with ✕ button
- Bar disappears when no operations remain
- Each message can contribute operations
- Operations tracked globally across all messages
