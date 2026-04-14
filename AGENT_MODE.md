# Agent and Edit Mode - File Operations

## Overview

OpenCodeBrew now supports **Agent Mode** and **Edit Mode**, allowing the AI assistant to create, edit, and delete files in your workspace directly. All file operations require your approval before being applied.

## How It Works

### Enabling Agent/Edit Mode

1. Select either "agent" or "edit" from the mode dropdown in the AI panel
2. A banner will appear indicating the mode is active
3. The AI will now be able to propose file operations

### File Operation Types

The AI can perform three types of operations:

#### 1. Create Files

The AI can create new files with content:

```
<create_file path="src/utils/helper.ts">
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
</create_file>
```

#### 2. Edit Files

The AI can edit existing files in two ways:

**Replace Mode** - Replace specific content:
```
<edit_file path="src/utils/helper.ts" mode="replace">
<old_content>
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
</old_content>
<new_content>
export function formatDate(date: Date, locale: string = 'en-US'): string {
  return date.toLocaleDateString(locale);
}
</new_content>
</edit_file>
```

**Insert Mode** - Insert new content at a specific line:
```
<edit_file path="src/utils/helper.ts" mode="insert" line="5">
// New helper function
export function getCurrentTime(): string {
  return new Date().toLocaleTimeString();
}
</edit_file>
```

#### 3. Delete Files

The AI can delete files when necessary:

```
<delete_file path="src/old-file.ts" />
```

## User Interface

When the AI proposes file operations:

1. A **File Operations** section appears in the chat
2. Each operation shows:
   - Operation type (create, edit, delete) with color-coded icon
   - File path
   - Preview of changes (for edits, shows before/after diff)
3. Two buttons for each operation:
   - **Apply** - Execute the file operation
   - **Reject** - Dismiss the operation

## Safety Features

- All operations require explicit user approval
- Edit operations show clear before/after diffs
- File paths are relative to workspace root
- Operations are executed one at a time
- Success/error notifications for each operation
- Files are automatically opened in the editor after creation/edit

## Best Practices

### For Users

1. Review each file operation carefully before approving
2. Check that the file path is correct
3. For edits, verify the old_content matches your current file
4. Use Edit Mode for focused, precise changes
5. Use Agent Mode for broader tasks involving multiple files

### For AI Prompts

**Good prompts:**
- "Create a new utility file for date formatting at src/utils/date.ts"
- "Update the user authentication logic to use JWT tokens"
- "Add error handling to the API service"

**Agent Mode Examples:**
- "Set up a new React component with tests"
- "Refactor the authentication system"
- "Create API endpoints for user management"

**Edit Mode Examples:**
- "Fix the bug in the login function"
- "Add TypeScript types to this function"
- "Optimize this database query"

## Technical Details

### System Prompt

When Agent or Edit mode is selected, the AI receives additional instructions about file operations in its system prompt. This allows it to understand and use the XML-based file operation syntax.

### File Path Resolution

All file paths are relative to the workspace root directory. The system automatically resolves them to absolute paths when executing operations.

### Editor Integration

After a file operation is executed:
- New/edited files are automatically opened in the editor
- The editor store is refreshed to reflect changes
- File tree is updated to show new/deleted files

## Troubleshooting

### Operation Fails

- Ensure the file path is correct and relative to workspace root
- Check file permissions
- Verify the workspace is open

### Edit Operation Not Matching

- The `old_content` must match exactly (including whitespace)
- Include enough context to make the match unique
- Use Insert mode if you just want to add new code

### File Not Opening After Creation

- Check browser console for errors
- Verify the file was created in the file tree
- Try manually opening the file from the file tree

## Example Workflow

1. Open a workspace in OpenCodeBrew
2. Switch to Agent mode in the AI panel
3. Send prompt: "Create a new React component called UserProfile with TypeScript"
4. Review the proposed file operation(s)
5. Click "Apply" to create the file
6. File opens automatically in the editor
7. Continue refining with follow-up prompts

## Limitations

- Operations are executed sequentially (not in parallel)
- Binary files are not supported
- Very large files may cause performance issues
- Undo is not automatic - use git for version control

## Future Enhancements

Planned improvements:
- Batch operation approval (apply all)
- Undo/redo for file operations
- Git integration for automatic commits
- Multi-file diff viewer
- Operation history and replay
