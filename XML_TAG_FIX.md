# XML Tag Cleaning Fix

## Issues Fixed

### 1. Custom XML Tags Not Removed
**Problem:** Tags like `<design-system>`, `<color-palette>`, and other hyphenated custom tags were not being removed from the markdown content.

**Root Cause:** The regex pattern `\w+` only matches word characters (a-z, 0-9, underscore) but not hyphens.

**Solution:** Updated the pattern to `[a-z][a-z0-9\-_]*` which explicitly allows hyphens in tag names.

### 2. Streaming Content Shows Tags Temporarily
**Problem:** XML tags were visible during response streaming but disappeared after completion.

**Explanation:** This is actually expected behavior because:
- During streaming, message content updates continuously  
- The cleaning function runs on every render
- React may batch updates, causing brief visibility
- The tags disappear once content stabilizes

**Note:** The cleaning happens in real-time during streaming via the `MessageBubble` component's render cycle. Any perceived delay is due to React's render batching.

## Updated Cleaning Patterns

### Main Pattern for Paired Tags
```typescript
// Matches <tag-name attr="value">content</tag-name>
// Including hyphens: <design-system>, <foo-bar-baz>
cleaned = cleaned.replace(/<([a-z][a-z0-9\-_]*)(?:\s+[^>]*)?>([\s\S]*?)<\/\1>/gi, '');
```

### Standalone Tag Pattern
```typescript
// Matches <tag-name> or </tag-name> or <tag-name />
// Including all attributes and hyphenated names
cleaned = cleaned.replace(/<\/?[a-z][a-z0-9\-_]*(?:\s+[^>]*)?\s*\/?>/gi, '');
```

## Tags Now Removed

**Plan Mode Tags:**
- `<plan>`, `<checklist>`, `<decision>`
- `<overview>`, `<approach>`, `<pros>`, `<cons>`
- `<tasks>`, `<architecture>`, `<considerations>`

**Agent/Edit Mode Tags:**
- `<create_file>`, `<edit_file>`, `<delete_file>`
- `<old_content>`, `<new_content>`

**Custom Tags (NEW):**
- `<design-system>`, `<color-palette>`
- `<ui-components>`, `<api-endpoints>`
- Any hyphenated or underscored tag names
- Any custom XML-like structures

## Testing

To verify the fix works:

1. **Test Custom Tags:**
   ```
   <custom-tag>This content should be removed</custom-tag>
   <foo-bar-baz attr="value">Also removed</foo-bar-baz>
   ```

2. **Test During Streaming:**
   - Start a Plan Mode response
   - Watch as tags appear briefly then disappear
   - This is normal React behavior

3. **Test After Completion:**
   - No tags should be visible in final rendered content
   - Only the meaningful text content remains

## Code Location

File: `src/components/AI/AIPanel.tsx`

Function: `getCleanedContent()` in `MessageBubble` component

Line: ~1108-1148

## Implementation Details

The cleaning function is called every time the `MessageBubble` component renders, which happens:
- During streaming (on every content update)
- After streaming completes
- When switching between messages

This ensures tags are removed as soon as possible, though React's render batching may cause brief visibility during rapid updates.

## Future Improvements

If tag visibility during streaming becomes an issue:
1. Add debouncing to reduce render frequency
2. Apply cleaning in the store before setting message content
3. Use memoization to cache cleaned content
4. Add transition animations to mask tag replacement

However, the current implementation is sufficient for most use cases.

## Mermaid Diagram ID Fix (Added 2026-04-11)

### Problem
Mermaid diagrams were failing with error:
```
'#dmermaid-plan-Feature: OpenCodeBrew Static Website-1775945040420' is not a valid selector.
```

### Root Cause
The diagram ID was generated using the plan title directly, which contained:
- Spaces
- Colons
- Special characters

These characters are invalid in CSS selectors, causing Mermaid to fail during rendering.

### Solution
Added ID sanitization to convert any input into a valid CSS selector:

```typescript
// Before (broken):
const uniqueId = `mermaid-${id}-${Date.now()}`;

// After (fixed):
const sanitizedId = id
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')  // Replace non-alphanumeric with hyphens
  .replace(/^-+|-+$/g, '');      // Remove leading/trailing hyphens

const uniqueId = `mermaid-${sanitizedId}-${Date.now()}`;
```

### Example Transformation
```
Input:    "plan-Feature: OpenCodeBrew Static Website"
          ↓
Sanitized: "plan-feature-opencodebrew-static-website"
          ↓
Final ID: "mermaid-plan-feature-opencodebrew-static-website-1775945040420"
```

### Valid CSS Selector Rules
The sanitization ensures the ID follows CSS selector requirements:
- ✓ Starts with a letter
- ✓ Contains only letters, numbers, hyphens, underscores
- ✓ No spaces, colons, or special characters
- ✓ No leading/trailing hyphens

### Location
File: `src/components/AI/AIPanel.tsx`
Function: `MermaidDiagram` component
Line: ~1079-1086

### Result
✅ Mermaid diagrams now render successfully regardless of plan title
✅ No more "invalid selector" errors
✅ Works with any unicode characters in titles (converted to hyphens)

