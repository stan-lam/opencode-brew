# OpenCodeBrew

A modern, cross-platform desktop IDE built with Tauri (Rust) + React + TypeScript. Features an IntelliJ-inspired UX with integrated AI assistant, Git support, and local history.

## Features

- **IntelliJ-style Layout**: Resizable panels, activity bar, tool windows
- **Monaco Editor**: VS Code's editor with syntax highlighting for 50+ languages
- **File Browser**: Navigate projects with tree view, icons, context menus
- **Integrated Terminal**: Xterm.js with PTY support
- **Git Integration**: Native git operations via libgit2 (no shell dependency)
- **AI Assistant**: Multi-backend support (Ollama, Claude, OpenAI)
- **Local History**: SQLite-backed file history with diff viewer
- **CLI Integration**: Run Claude Code, OpenCode, or custom CLI tools
- **Plugin System**: Extend functionality with JavaScript/TypeScript plugins
- **Cross-Platform**: macOS, Windows, Linux support via Tauri

## Architecture

```
opencodebrew/
├── src/                   # React frontend (TypeScript)
│   ├── components/        # UI components
│   ├── store/             # Zustand state management
│   └── services/          # Tauri API bindings
├── src-tauri/             # Rust backend
│   └── src/
│       ├── commands/      # IPC command handlers
│       │   ├── fs.rs      # File system operations
│       │   ├── git.rs     # Git operations (libgit2)
│       │   ├── ai.rs      # AI chat streaming
│       │   ├── terminal.rs # PTY terminal
│       │   └── history.rs # Local history (SQLite)
│       └── lib.rs         # Tauri app setup
└── package.json
```

## Prerequisites

- **Node.js** 18+
- **Rust** 1.77+ (install via [rustup](https://rustup.rs))
- **System dependencies** (for Tauri):
  - macOS: Xcode Command Line Tools
  - Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run tauri:dev

# Build for production
npm run tauri:build
```

## Cross-Platform Build

Tauri supports building for all platforms:

```bash
# macOS (from macOS)
npm run tauri:build

# Windows (from Windows)
npm run tauri:build

# Linux (from Linux)
npm run tauri:build
```

For cross-compilation, use GitHub Actions or similar CI/CD.

## Configuration

### AI Providers

Configure AI backends in the Settings panel:

- **Ollama** (local): `http://localhost:11434`
- **Claude**: Add your Anthropic API key
- **OpenAI**: Add your OpenAI API key
- **Custom**: Any OpenAI-compatible endpoint

### Workspaces

The IDE remembers recent workspaces. Open folders via:
- File menu → Open Folder
- Welcome tab → Open Folder button
- Drag & drop folder onto window

## Key Bindings

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Save | ⌘S | Ctrl+S |
| Save All | ⌘⇧S | Ctrl+Shift+S |
| Open File | ⌘O | Ctrl+O |
| Find | ⌘F | Ctrl+F |
| Terminal | ⌘` | Ctrl+` |

## Why Tauri over Electron?

- **~80% smaller** bundle size (5-15MB vs 150MB+)
- **Lower memory** usage (native webview vs Chromium)
- **Better security** via Rust's memory safety
- **Native performance** for file operations and git

## Technology Stack

- **Frontend**: React 18, TypeScript, Zustand, Monaco Editor
- **Backend**: Rust, Tauri 2.0, libgit2, SQLite
- **IPC**: Tauri command/event system with streaming support
- **Build**: Vite (frontend), Cargo (backend)

## License

MIT