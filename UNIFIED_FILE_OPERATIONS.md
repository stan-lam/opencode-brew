# Unified File Operations Control Bar

## Overview

The file operations UI has been redesigned to use a **unified control bar** instead of individual "Apply" buttons for each file operation. This provides a Cursor-like experience with batch operations and better visual management.

## Key Changes

### Before: Individual Apply Buttons
- Each file operation had its own "Apply" and "Reject" buttons
- Operations had to be reviewed one at a time
- No overview of all pending operations
- Scattered across multiple messages

### After: Unified Control Bar
- **Single control bar** at the top of the prompt input
- **Batch operations** for all pending file changes
- **Expand/collapse** individual operations for review
- **Centralized management** of all file operations

## Features

### 1. Unified Control Bar

Located **above the prompt input area**, showing:

```
┌──────────────────────────────────────────┐
│ 📄 10 Files  [Undo All] [Keep All] [Review] │
└──────────────────────────────────────────┘
```

**Elements:**
- **File counter**: Shows number of pending operations
- **Undo All**: Clears all pending operations
- **Keep All**: Applies all operations at once
- **Review**: Scrolls to first operation in messages

### 2. Expand/Collapse File Operations

Click on any file operation header to:
- **Expand**: Show file diff/content preview
- **Collapse**: Hide details, show only filename

**Visual indicator:**
- `▼` = Expanded (showing details)
- `▶` = Collapsed (hidden details)

### 3. Batch Operations

#### Keep All
- Applies **all pending file operations** at once
- Creates new files
- Edits existing files
- Deletes files as specified
- Shows success notification with count
- Opens modified files in editor
- Clears all pending operations after applying

#### Undo All
- **Removes all pending operations** without applying
- No file changes are made
- Shows info notification
- Clears the control bar

#### Review
- **Scrolls to the first file operation** in messages
- Helpful for reviewing changes before applying
- Smooth scroll animation to operation location

### 4. Operation Tracking

Operations are tracked **globally across all messages**:
- Each message can contribute multiple operations
- All operations collected in single control bar
- Operations tied to message IDs for tracking
- Automatically updates as new operations arrive

## User Interface

### Control Bar Styling

```css
.fileOpsBar {
  background: Secondary background
  border-top: 1px border
  padding: 12px 16px
  animation: Slide up on appear
}
```

**Button styles:**
- **Undo All**: Secondary (transparent with border)
- **Keep All**: Secondary (transparent with border)
- **Review**: Primary (blue gradient)

### File Operation Preview

#### Collapsed State
```
+ Create src/components/Button.tsx ▶
```

#### Expanded State
```
+ Create src/components/Button.tsx ▼

export const Button = () => {
  return <button>Click me</button>;
}
```

### Operation Icons & Colors

| Operation | Icon | Color |
|-----------|------|-------|
| Create | `+` | Green |
| Edit | `~` | Blue |
| Delete | `-` | Red |

## Technical Implementation

### Global State Management

```typescript
const [allPendingOps, setAllPendingOps] = useState<
  Array<{operation: FileOperation; messageId: string}>
>([]);
```

Tracks operations with:
- **operation**: File operation details (create/edit/delete)
- **messageId**: Which message generated the operation

### Operation Collection

MessageBubble reports operations to parent:

```typescript
<MessageBubble 
  message={message}
  onOperationsChange={(ops) => {
    setAllPendingOps(prev => {
      // Remove old operations for this message
      const filtered = prev.filter(item => item.messageId !== message.id);
      // Add new operations
      const newOps = ops.map(op => ({ operation: op, messageId: message.id }));
      return [...filtered, ...newOps];
    });
  }}
/>
```

### Batch Apply Logic

```typescript
const handleKeepAllOperations = async () => {
  // Apply all operations sequentially
  for (const { operation } of allPendingOps) {
    if (operation.type === 'create') {
      await fs.writeFile(fullPath, operation.content);
    } else if (operation.type === 'edit') {
      const content = await fs.readFile(fullPath);
      const updated = content.replace(operation.oldContent, operation.newContent);
      await fs.writeFile(fullPath, updated);
    } else if (operation.type === 'delete') {
      await fs.deleteFile(fullPath);
    }
  }
  
  // Clear all operations
  setAllPendingOps([]);
};
```

### Expand/Collapse State

Each FileOperationPreview manages its own collapsed state:

```typescript
const [isExpanded, setIsExpanded] = useState(true);

<div onClick={() => setIsExpanded(!isExpanded)}>
  {isExpanded ? '▼' : '▶'}
</div>
```

## User Workflows

### Workflow 1: Quick Accept All

1. AI suggests multiple file operations
2. User sees control bar: "10 Files"
3. User reviews briefly
4. Click **"Keep All"**
5. All operations applied instantly
6. Success notification shows count
7. Control bar disappears

### Workflow 2: Selective Review

1. AI suggests multiple file operations
2. User clicks **"Review"** button
3. Scrolls to first operation in messages
4. User expands/collapses operations to review
5. If satisfied, click **"Keep All"**
6. If not, click **"Undo All"** and ask AI to revise

### Workflow 3: Individual Review

1. AI suggests file operations
2. User clicks on operation header to expand
3. Reviews diff/content
4. Clicks next operation header
5. After reviewing all:
   - Click **"Keep All"** to apply
   - Click **"Undo All"** to reject

### Workflow 4: Reject All

1. AI suggests file operations
2. User realizes they're not what's needed
3. Click **"Undo All"** immediately
4. Operations cleared, no file changes
5. User refines prompt and tries again

## Benefits

### For Users

1. **Faster workflow**: Apply all changes with one click
2. **Better overview**: See total pending operations at a glance
3. **Flexible review**: Expand only what you want to check
4. **Easy undo**: Clear all operations if not satisfied
5. **Less clicking**: No individual approve/reject buttons

### For Development

1. **Centralized logic**: All operation handling in one place
2. **Global state**: Easy to track operations across messages
3. **Reusable component**: FileOperationsBar is standalone
4. **Cleaner UI**: Less clutter in message bubbles
5. **Extensible**: Easy to add features like "Keep Selected"

## Edge Cases

### Empty Operations
- Control bar doesn't render when no operations
- Clean, uncluttered UI when not needed

### Streaming Messages
- Operations update in real-time as messages stream
- Control bar updates counter dynamically
- New operations automatically added to list

### Multiple Messages
- Operations from different messages are aggregated
- All shown in single control bar
- MessageId tracking maintains association

### Plan Mode
- Control bar doesn't appear (operations disabled)
- File operations are filtered in Plan Mode
- Only shows in Agent/Edit modes

## Keyboard Shortcuts (Future)

Potential enhancements:
- `Cmd+K`: Keep All
- `Cmd+U`: Undo All
- `Cmd+R`: Review
- `Space`: Expand/Collapse focused operation

## Accessibility

- Clear button labels
- Keyboard navigable
- Visual operation type indicators
- Color + icon for operation types (not color-only)
- Smooth scroll for Review

## Comparison with Cursor IDE

| Feature | Cursor | OpenCodeBrew |
|---------|--------|--------------|
| Unified control bar | ✅ | ✅ |
| File counter | ✅ | ✅ |
| Undo All | ✅ | ✅ |
| Keep All | ✅ | ✅ |
| Review button | ✅ | ✅ |
| Expand/collapse | ✅ | ✅ |
| Batch operations | ✅ | ✅ |
| Individual buttons | ❌ | ❌ (removed) |

## Files Modified

### Frontend
- `src/components/AI/AIPanel.tsx`:
  - Added `allPendingOps` state for global tracking
  - Created `FileOperationsBar` component
  - Added batch operation handlers
  - Updated `MessageBubble` to report operations
  - Made `FileOperationPreview` expandable
  - Removed individual apply/reject buttons

- `src/components/AI/AIPanel.module.css`:
  - Added `.fileOpsBar` styles
  - Updated `.fileOpHeader` to be clickable
  - Added `.fileOpExpand` indicator
  - Added animation for control bar appearance

## Testing

### Test Scenarios

1. **Single operation**: Verify control bar shows "1 File"
2. **Multiple operations**: Test with 10+ file operations
3. **Keep All**: Apply multiple creates/edits/deletes
4. **Undo All**: Clear operations without applying
5. **Review**: Scroll to first operation
6. **Expand/collapse**: Toggle operation visibility
7. **Streaming**: Operations update during AI response
8. **Multiple messages**: Operations from different messages
9. **Error handling**: Failed operations show errors
10. **Plan Mode**: No control bar in Plan Mode

### Manual Testing

1. Switch to Agent Mode
2. Ask: "Create 5 React components"
3. AI generates file operations
4. Verify control bar appears
5. Click Review → scrolls to operations
6. Expand/collapse operations
7. Click Keep All → files created
8. Verify success notification
9. Check files exist in workspace

## Future Enhancements

Potential improvements:
- **Keep Selected**: Cherry-pick specific operations
- **Diff view mode**: Side-by-side or unified diff
- **Undo individual**: Remove single operation from batch
- **Drag to reorder**: Change operation application order
- **Conflict detection**: Warn if operations conflict
- **Preview mode**: See what files will look like
- **Grouped operations**: Group by file or operation type
- **Search/filter**: Find specific operations in large lists

## Performance

- **Efficient re-renders**: Only control bar updates on change
- **Lazy expansion**: Content only rendered when expanded
- **Batch processing**: All operations applied in single async flow
- **Memory efficient**: Operations cleared after application

## Notes

- Control bar only appears in Agent/Edit modes
- Operations are not persisted across sessions
- Refresh clears pending operations
- Operations apply in order received
- Failed operations show individual error notifications
