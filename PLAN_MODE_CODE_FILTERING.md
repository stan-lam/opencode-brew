# Plan Mode Code Block Filtering

## Overview

Plan Mode is designed for **strategic planning and architecture design only**. It explicitly prevents code implementation by:

1. **Instructing the AI model** not to generate code blocks
2. **Filtering out code blocks** if they appear in responses
3. **Warning the user** when code blocks are detected and removed
4. **Suggesting to switch to Agent Mode** for implementation

## Why Filter Code Blocks?

Plan Mode should focus on:
- Strategic thinking
- Architectural decisions
- Approach exploration
- Trade-off analysis
- Task breakdown

**NOT** on:
- Code implementation
- Command-line examples
- Syntax details
- File operations

## Implementation

### 1. System Prompt Updates

The Plan Mode system prompt now explicitly forbids code generation:

```
### Key Principles

- **NO CODE BLOCKS** - Do NOT write any code snippets, bash commands, 
  JavaScript, TypeScript, or any programming language code
- **Conceptual only** - Describe what needs to be done in plain language
- **Task lists instead of code** - Instead of showing code examples, 
  create actionable task lists describing what to implement

**CRITICAL RULES FOR PLAN MODE:**
1. NEVER write code blocks with ```bash, ```javascript, ```typescript, etc.
2. NEVER show command-line examples or shell commands
3. Instead of code, describe WHAT needs to be done as a task list
4. Users will switch to Agent Mode when ready to see actual code

**Example - WRONG (Code):**
```bash
npm install next react
```

**Example - RIGHT (Task):**
- [ ] Install Next.js and React dependencies using npm
```

### 2. Client-Side Filtering

Even if the AI generates code blocks despite instructions, they are filtered out:

```typescript
// In plan mode, detect and remove code blocks
if (agentMode === 'plan') {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  
  // Extract code blocks for tracking
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1] || 'code';
    // Skip mermaid (allowed for architecture diagrams)
    if (lang.toLowerCase() === 'mermaid') continue;
    
    // Create task description from code block
    detectedCodeBlocks.push(`Implement ${lang}: ...`);
  }
  
  // Remove all code blocks except mermaid
  cleaned = cleaned.replace(/```(?!mermaid)(\w*)\n[\s\S]*?```/g, () => {
    return '\n**[Code block removed - Switch to Agent Mode to see implementation]**\n';
  });
}
```

### 3. User Warning

When code blocks are detected and removed, a warning appears:

```
┌────────────────────────────────────────────┐
│ ⚠️ Code blocks detected in Plan Mode      │
├────────────────────────────────────────────┤
│ 3 code blocks were removed. Plan Mode is  │
│ for strategic planning only.               │
│                                            │
│ Switch to Agent Mode to see actual code,  │
│ file operations, and implementation.       │
│                                            │
│ [🖥 Switch to Agent Mode] [Dismiss]       │
└────────────────────────────────────────────┘
```

## What Gets Filtered

### Removed in Plan Mode:
- ✅ Bash/shell commands
- ✅ JavaScript/TypeScript code
- ✅ Python, Java, Rust, etc. code
- ✅ Configuration files (JSON, YAML)
- ✅ Any code in triple backticks

### Allowed in Plan Mode:
- ✅ Mermaid diagrams (for architecture)
- ✅ Plain text explanations
- ✅ Task lists
- ✅ Pros/cons lists
- ✅ Decision matrices
- ✅ Strategic discussions

## User Experience

### Before Filtering

AI might respond with:

```
To set up the project, run:

```bash
npm install next react react-dom
npm install -D typescript @types/react
```

Then create your config:

```typescript
// next.config.js
module.exports = {
  reactStrictMode: true
}
```
```

### After Filtering

User sees:

```
To set up the project:

**[Code block removed - Switch to Agent Mode to see implementation]**

Then create your config:

**[Code block removed - Switch to Agent Mode to see implementation]**

[Warning banner appears suggesting to switch to Agent Mode]
```

## Warning Component

### Visual Design

- **Orange theme** (warning color)
- **Animated slide-in** entrance
- **Dismissible** with X button
- **Primary action:** Switch to Agent Mode
- **Secondary action:** Dismiss warning

### Trigger Conditions

Warning appears when:
- User is in Plan Mode
- AI response contains ≥1 code block
- Code blocks are not mermaid diagrams

### Actions

**"Switch to Agent Mode" button:**
- Changes mode from `plan` to `agent`
- Preserves conversation context
- Enables file operations
- User can ask for code again

**"Dismiss" button:**
- Hides warning for this message
- Doesn't prevent future warnings
- User acknowledges the filtering

## Technical Details

### Code Block Detection

```typescript
const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
```

Matches:
- Triple backticks with optional language
- Multi-line code content
- Closing triple backticks

Excludes:
- Mermaid diagrams (checked separately)
- Inline code (`single backticks`)

### Filtering Strategy

1. **Detect:** Scan content for code blocks
2. **Extract:** Save language and preview
3. **Remove:** Replace with warning message
4. **Notify:** Show warning banner
5. **Track:** Count removed blocks

### State Management

```typescript
const [codeBlockTasks, setCodeBlockTasks] = useState<string[]>([]);
```

Stores:
- Count of removed code blocks
- Preview of what was removed
- Used to trigger warning component

## Configuration

No configuration needed—feature is automatic:

- ✅ Works in Plan Mode only
- ✅ Auto-detects code blocks
- ✅ Always filters (can't disable)
- ✅ Always shows warning (can dismiss per-message)

## Styling

### Warning Banner

```css
.codeBlockWarning {
  border: 2px solid rgba(255, 152, 0, 0.4);
  background: linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, ...);
  animation: slideIn 0.3s ease-out;
}
```

### Replacement Text

```css
**[Code block removed - Switch to Agent Mode to see implementation]**
```

Styled as:
- Bold markdown text
- Clear call-to-action
- Indicates what was removed

## Mode Comparison

| Feature | Plan Mode | Agent Mode |
|---------|-----------|------------|
| Code Blocks | ❌ Filtered | ✅ Shown |
| Bash Commands | ❌ Filtered | ✅ Shown |
| File Operations | ❌ Disabled | ✅ Enabled |
| Mermaid Diagrams | ✅ Allowed | ✅ Allowed |
| Task Lists | ✅ Primary format | Secondary |
| Strategic Planning | ✅ Primary focus | Secondary |

## Benefits

### For Users

1. **Clean Planning:** No distracting code snippets
2. **Clear Intent:** Forces strategic thinking
3. **Smooth Transition:** Easy switch to Agent Mode
4. **Awareness:** Warning explains what happened

### For AI Responses

1. **Focused:** AI describes "what" not "how"
2. **Conceptual:** Higher-level thinking
3. **Structured:** Task lists over code
4. **Appropriate:** Right tool for planning phase

## Related Features

- **Plan Mode Prompts:** System instructions for strategic planning
- **Actionable Tasks Detection:** Identifies implementation steps
- **Mode Switching:** Transition from planning to coding
- **Read-Only Mode:** Disables file operations in Plan Mode

## Future Enhancements

Potential improvements:
- Show code block preview before removal
- Allow user to choose which blocks to keep
- Export filtered code to separate view
- Statistics on code block removal
- Configurable filtering rules
- Whitelist certain code types

## Testing

### Test Plan Mode Filtering

1. Enter Plan Mode
2. Ask: "Show me how to set up a Next.js project"
3. AI might generate bash commands
4. Verify code blocks are removed
5. Warning banner should appear
6. Click "Switch to Agent Mode"
7. Ask again—code blocks should now appear

### Verify Mermaid Exception

1. In Plan Mode
2. Ask for architecture diagram
3. AI generates mermaid diagram
4. Verify mermaid is NOT filtered
5. Diagram renders correctly

### Check Warning Dismissal

1. Code blocks filtered → warning appears
2. Click "Dismiss"
3. Warning disappears for this message
4. New message with code → warning appears again

## Accessibility

- Keyboard navigable buttons
- Clear visual hierarchy with warning icon
- Orange theme indicates caution
- Text explains what happened
- Clear call-to-action

## Notes

- Filtering is aggressive by design
- Mermaid diagrams are the only exception
- Warning can't be permanently disabled
- Each message's warning dismissal is independent
- Mode switch is immediate and reversible
