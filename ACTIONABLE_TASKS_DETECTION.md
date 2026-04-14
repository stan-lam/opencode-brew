# Actionable Tasks Detection in Plan Mode

## Overview

When using Plan Mode, the AI assistant can identify actionable implementation steps and suggest converting them into a structured development workflow.

## How It Works

### 1. Automatic Task Detection

The editor analyzes AI responses in Plan Mode for actionable task lists:

- **Numbered lists** (1., 2., 3., etc.)
- **"What to Do Next?" sections**
- **"Ready to start?" prompts**
- **Action items with clear implementation steps**

### 2. Smart Suggestion UI

When 2 or more actionable tasks are detected, a suggestion panel appears with:

```
┌──────────────────────────────────────────────┐
│ 💡 Ready to implement these steps?          │
├──────────────────────────────────────────────┤
│ I've identified 4 actionable tasks.         │
│ Switch to Agent Mode to start development   │
│ with interactive file operations.           │
│                                              │
│ ① Build the site locally: Complete homepage │
│ ② Set up GitHub repo: Create repo structure │
│ ③ Configure Netlify: Get CLI ready          │
│ ④ DNS setup: Configure Hostinger records    │
│                                              │
│ [🖥 Switch to Agent Mode] [Stay in Plan]   │
└──────────────────────────────────────────────┘
```

### 3. One-Click Mode Switch

Click **"Switch to Agent Mode"** to:
- Exit read-only Plan Mode
- Enter Agent Mode with file operation capabilities
- Continue the conversation with implementation-focused AI
- Access code generation and file manipulation tools

## Example Workflow

### Step 1: Planning Phase

User: "Help me build and deploy a personal website"

AI (Plan Mode):
- Analyzes requirements
- Explores options
- Discusses architecture
- **Provides actionable next steps**

### Step 2: Automatic Detection

Editor detects tasks like:
1. Build the site locally
2. Set up GitHub repo  
3. Configure Netlify
4. DNS setup

### Step 3: User Decision

**Option A:** Switch to Agent Mode
- Click the button
- Mode changes immediately
- Continue with implementation

**Option B:** Stay in Plan Mode
- Dismiss the suggestion
- Continue planning/exploring
- Switch manually when ready

## Detection Patterns

### Recognized Formats

#### Numbered Lists
```
1. Task one - description
2. Task two - description
3. Task three - description
```

#### "What to Do Next?" Sections
```
## What to Do Next?

Ready to start? Let me know which step you want to tackle first:

1. Build the site locally - I can help you complete the homepage code
2. Set up GitHub repo - Create the repo structure
3. Configure Netlify - Get Netlify CLI ready
```

#### Action Items
```
## Next Steps

1. Create authentication middleware
2. Implement login/logout endpoints
3. Add token validation
4. Write tests for auth flow
```

### Filters

The system filters out:
- Very short tasks (< 10 characters)
- Generic tasks ("see docs", "read more")
- Non-actionable items

## UI Components

### Suggestion Panel

**Colors:**
- Green gradient background (success theme)
- Green accent borders
- Animated slide-in entrance

**Buttons:**
- **Primary:** Green gradient, icon + text
- **Secondary:** Transparent with border
- **Dismiss:** X icon in header

**Features:**
- Numbered task badges (1, 2, 3...)
- Truncated task descriptions
- Smooth animations
- Dismissible with X button

### Interaction

- Panel appears below AI message
- Dismissing hides permanently (for that message)
- Switching modes navigates to Agent Mode
- Panel only shows when ≥2 tasks detected

## Technical Implementation

### Detection Function

```typescript
function detectActionableTasks(content: string): string[] {
  // Parses numbered lists
  // Detects "What to Do Next?" sections
  // Filters short/generic tasks
  // Returns array of task descriptions
}
```

### Component

```typescript
<ActionableTasksSuggestion 
  tasks={actionableTasks} 
  onSwitchToAgent={() => setAgentMode('agent')} 
/>
```

### Rendering Logic

```typescript
{!isUser && agentMode === 'plan' && actionableTasks.length >= 2 && (
  <ActionableTasksSuggestion ... />
)}
```

## Benefits

### For Users

1. **Seamless Transition:** Move from planning to implementation smoothly
2. **Clear Next Steps:** Visual summary of what to do next
3. **No Manual Switching:** One-click mode change
4. **Context Preservation:** Conversation continues naturally

### For Workflow

1. **Reduces Friction:** No need to manually switch modes
2. **Visual Clarity:** Tasks presented in digestible format
3. **Guided Process:** Editor suggests optimal workflow
4. **Time Saving:** Skip manual mode switching

## Mode Comparison

| Feature | Plan Mode | Agent Mode |
|---------|-----------|------------|
| File Operations | ❌ Disabled | ✅ Enabled |
| Code Generation | ❌ No | ✅ Yes |
| Architecture Plans | ✅ Yes | Limited |
| Task Suggestions | ✅ With auto-detect | N/A |
| Read-Only | ✅ Yes | ❌ No |

## Configuration

No configuration needed - feature works automatically:

- ✅ Auto-detects in Plan Mode only
- ✅ Requires minimum 2 tasks
- ✅ Dismissible per message
- ✅ No persistence (resets per message)

## Accessibility

- Keyboard navigable buttons
- Clear visual hierarchy
- Icon + text labels
- Color + text indicators (not color-only)
- Tooltip support

## Future Enhancements

Potential improvements:
- Export tasks to `.plan.md` file
- Integration with project task tracking
- Customizable task thresholds
- Task editing before switching modes
- Remember dismissal preferences
- Batch task creation in Agent Mode

## Related Features

- **Plan Mode:** Read-only strategic planning
- **Agent Mode:** Implementation and file operations
- **File Operations Panel:** Approve/reject changes
- **Interactive Todo Lists:** Track implementation progress

## Notes

- Only appears in Plan Mode (safety feature)
- Detection happens on every AI response
- Tasks are extracted from markdown, not XML tags
- Dismissing is per-message (not global)
- Mode switch is immediate and reversible
