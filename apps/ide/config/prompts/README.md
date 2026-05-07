# AI Prompt Customization

This folder contains the default AI prompts used by OpenCodeBrew IDE. You can customize these prompts to change how the AI assistant behaves in different modes.

## How to Customize

1. The app loads prompts from your app data directory:
   - **macOS**: `~/Library/Application Support/com.opencodebrew.ide/prompts/`
   - **Windows**: `%APPDATA%\com.opencodebrew.ide\prompts\`
   - **Linux**: `~/.config/com.opencodebrew.ide/prompts/`

2. Copy any of the `.md` files from this folder to the above location
3. Edit the copied file to customize the prompt
4. The changes take effect on the next conversation (or restart the app)

## Available Prompts

| File | Description |
|------|-------------|
| `agent-mode.md` | Instructions for Agent mode - file operations, code generation |
| `edit-mode.md` | Instructions for Edit mode - precise code modifications |
| `plan-mode.md` | Instructions for Plan mode - strategic planning, architecture |
| `think-aloud.md` | Think-aloud mode - step-by-step reasoning |
| `web-access.md` | Web access tools - search, fetch, stock data |

## Tips

- Keep the markdown structure (headers, code blocks) intact
- The first-level header (`# Title`) is stripped when loading
- Use `{{TODAY}}` in web-access.md as a placeholder for the current date
- Test your changes in the app to ensure they work as expected

## Reset to Default

To reset a prompt to its default:
1. Delete your custom `.md` file from the prompts directory
2. The app will automatically use the built-in default
