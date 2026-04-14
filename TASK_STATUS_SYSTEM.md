# Task Status System - Interactive Icons

## Overview

Replaced traditional checkboxes with **clickable status icons** that allow users to cycle through multiple task states. This provides more granular task tracking similar to modern project management tools.

## Task States

### ○ Pending (Gray)
- **Marker:** `- [ ]` in markdown
- **Icon:** ○ (empty circle)
- **Color:** #808080 (gray)
- **Meaning:** Task not yet started
- **Click action:** Changes to "In Progress"

### ◐ In Progress (Blue)
- **Marker:** `- [>]` in markdown
- **Icon:** ◐ (half-filled circle)
- **Color:** #2196f3 (blue)
- **Meaning:** Task currently being worked on
- **Visual:** Blue left border on task item
- **Click action:** Changes to "Completed"

### ✓ Completed (Green)
- **Marker:** `- [x]` in markdown  
- **Icon:** ✓ (checkmark)
- **Color:** #4caf50 (green)
- **Meaning:** Task finished successfully
- **Visual:** Text with strikethrough, reduced opacity
- **Click action:** Changes to "Skipped"

### ⊘ Skipped (Orange)
- **Marker:** `- [-]` in markdown
- **Icon:** ⊘ (circle with slash)
- **Color:** #ff9800 (orange)
- **Meaning:** Task intentionally not done (not applicable, obsolete, etc.)
- **Visual:** Strikethrough text, italic style, reduced opacity
- **Click action:** Changes back to "Pending"

## User Interaction

### Clicking Status Icon
- Single click cycles to next state
- Follows cycle: **Pending → In Progress → Completed → Skipped → Pending**
- Icon changes immediately with smooth animation
- Hover shows tooltip with current state and next action

### Visual Feedback
- **Hover:** Icon scales up slightly (1.1x), background highlight
- **Active:** Icon scales down (0.95x) for press effect
- **Color:** Each state has distinct color for quick recognition

## Implementation

### Status Icon Component
```typescript
const getTaskStatusIcon = (status) => {
  switch (status) {
    case 'pending': return { 
      icon: '○', 
      color: '#808080', 
      label: 'Pending (click to start)' 
    };
    case 'in-progress': return { 
      icon: '◐', 
      color: '#2196f3', 
      label: 'In Progress (click to complete)' 
    };
    case 'completed': return { 
      icon: '✓', 
      color: '#4caf50', 
      label: 'Completed (click to skip)' 
    };
    case 'skipped': return { 
      icon: '⊘', 
      color: '#ff9800', 
      label: 'Skipped (click to reset)' 
    };
  }
};
```

### Cycle Function
```typescript
const cycleTaskStatus = (taskId) => {
  const statusCycle = {
    'pending': 'in-progress',
    'in-progress': 'completed',
    'completed': 'skipped',
    'skipped': 'pending'
  };
  
  setTasks(prev => prev.map(task => {
    if (task.id === taskId) {
      return { ...task, status: statusCycle[task.status] };
    }
    return task;
  }));
};
```

## File Persistence

### Markdown Format
Tasks are saved to `.plan.md` files with status markers:

```markdown
## Tasks

- [ ] Pending task
- [>] In-progress task
- [x] Completed task
- [-] Skipped task
```

### Status Mapping
| Status | Checkbox | Rendered |
|--------|----------|----------|
| pending | `- [ ]` | ○ (gray) |
| in-progress | `- [>]` | ◐ (blue) |
| completed | `- [x]` | ✓ (green) |
| skipped | `- [-]` | ⊘ (orange) |

## Benefits

### For Users
✓ **Visual clarity** - Color-coded states at a glance  
✓ **Flexible workflow** - Mark tasks as in-progress or skipped  
✓ **One-click updates** - No separate "edit" mode needed  
✓ **Progress tracking** - See what's active vs done vs skipped  
✓ **Familiar patterns** - Similar to Jira, Linear, Notion  

### For Teams
✓ **Status visibility** - Know what others are working on  
✓ **Work prioritization** - Focus on in-progress tasks  
✓ **Completion tracking** - Distinguish done from skipped  
✓ **Scope management** - Easily mark tasks as not applicable  

## CSS Classes

### State-Specific Styles
- `.taskStatusPending` - Slightly reduced opacity
- `.taskStatusInprogress` - Blue left border indicator
- `.taskStatusCompleted` - Strikethrough, reduced opacity
- `.taskStatusSkipped` - Strikethrough, italic, reduced opacity

### Icon Button
```css
.taskStatusBtn {
  font-size: 18px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.taskStatusBtn:hover {
  background-color: var(--bg-hover);
  transform: scale(1.1);
}

.taskStatusBtn:active {
  transform: scale(0.95);
}
```

## Migration from Checkboxes

### What Changed
**Before:**
- Boolean `completed` field
- HTML checkbox input
- Only two states: done or not done

**After:**
- String `status` field with 4 states
- Clickable icon button
- Full workflow: pending → in-progress → completed → skipped

### Backwards Compatibility
- Existing `- [ ]` and `- [x]` markers still work
- New markers `- [>]` and `- [-]` added for new states
- Parser handles all formats correctly

## Usage Tips

### When to Use Each Status

**Pending (○):**
- Task defined but not started
- Default state for new tasks
- Waiting for dependencies

**In Progress (◐):**
- Currently working on it
- Picked up from backlog
- Focus on completing

**Completed (✓):**
- Successfully finished
- Ready for review
- Tested and working

**Skipped (⊘):**
- Requirements changed
- No longer applicable
- Duplicate of another task
- Out of scope for this iteration

### Workflow Example

```
1. Start day: Click pending task (○) → In progress (◐)
2. Working: Task shows blue border
3. Finish: Click in-progress task (◐) → Completed (✓)
4. Scope change: Click pending task (○) → ... → Skipped (⊘)
5. Mistake: Click skipped task (⊘) → Pending (○) to restart cycle
```

## Future Enhancements

Potential additions:
- Custom status colors in settings
- Keyboard shortcuts (1-4 for direct status set)
- Bulk status updates
- Status history/changelog
- Time tracking per status
- Status-based filtering/sorting
