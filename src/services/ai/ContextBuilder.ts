import { useEditorStore } from '../../store/editorStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useGitStore } from '../../store/gitStore';

export interface ContextItem {
  type: 'file' | 'selection' | 'git_diff' | 'error' | 'workspace';
  content: string;
  metadata?: Record<string, any>;
}

export class ContextBuilder {
  private items: ContextItem[] = [];

  addCurrentFile(): this {
    const { activeFile } = useEditorStore.getState();
    if (activeFile) {
      this.items.push({
        type: 'file',
        content: activeFile.content,
        metadata: {
          path: activeFile.path,
          language: activeFile.language,
        },
      });
    }
    return this;
  }

  addOpenFiles(): this {
    const { openFiles } = useEditorStore.getState();
    for (const file of openFiles) {
      this.items.push({
        type: 'file',
        content: file.content,
        metadata: {
          path: file.path,
          language: file.language,
        },
      });
    }
    return this;
  }

  addSelection(selection: string, filePath?: string): this {
    this.items.push({
      type: 'selection',
      content: selection,
      metadata: { path: filePath },
    });
    return this;
  }

  addGitDiff(): this {
    const { stagedFiles, unstagedFiles } = useGitStore.getState();
    const changes = [...stagedFiles, ...unstagedFiles];
    if (changes.length > 0) {
      this.items.push({
        type: 'git_diff',
        content: changes.map((f) => `${f.status}: ${f.path}`).join('\n'),
        metadata: { fileCount: changes.length },
      });
    }
    return this;
  }

  addWorkspaceInfo(): this {
    const { currentWorkspace } = useWorkspaceStore.getState();
    if (currentWorkspace) {
      this.items.push({
        type: 'workspace',
        content: `Workspace: ${currentWorkspace.name}\nRoot: ${currentWorkspace.rootPath}`,
        metadata: {
          name: currentWorkspace.name,
          rootPath: currentWorkspace.rootPath,
        },
      });
    }
    return this;
  }

  addError(error: string, filePath?: string, line?: number): this {
    this.items.push({
      type: 'error',
      content: error,
      metadata: { path: filePath, line },
    });
    return this;
  }

  build(): string {
    const sections: string[] = [];

    for (const item of this.items) {
      switch (item.type) {
        case 'file':
          sections.push(
            `### File: ${item.metadata?.path || 'Unknown'}\n\`\`\`${item.metadata?.language || ''}\n${item.content}\n\`\`\``
          );
          break;
        case 'selection':
          sections.push(
            `### Selected Code${item.metadata?.path ? ` (${item.metadata.path})` : ''}\n\`\`\`\n${item.content}\n\`\`\``
          );
          break;
        case 'git_diff':
          sections.push(
            `### Git Changes (${item.metadata?.fileCount} files)\n${item.content}`
          );
          break;
        case 'error':
          sections.push(
            `### Error${item.metadata?.path ? ` in ${item.metadata.path}` : ''}${item.metadata?.line ? `:${item.metadata.line}` : ''}\n${item.content}`
          );
          break;
        case 'workspace':
          sections.push(`### ${item.content}`);
          break;
      }
    }

    return sections.join('\n\n');
  }

  getItems(): ContextItem[] {
    return [...this.items];
  }

  clear(): this {
    this.items = [];
    return this;
  }
}

export function buildContext(): ContextBuilder {
  return new ContextBuilder();
}
