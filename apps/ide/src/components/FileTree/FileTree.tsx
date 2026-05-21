import { useState, useEffect, useCallback, useRef, type MouseEvent } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Trash2,
  Pencil,
  Copy,
  FolderOpen,
  Terminal,
  FileText,
} from 'lucide-react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useEditorStore } from '../../store/editorStore';
import { useLayoutStore } from '../../store/layoutStore';
import { fs, dialog, FileEntry, FileChangeEvent } from '../../services/tauri';
import styles from './FileTree.module.css';
import { ContextMenu, ContextMenuFileItem, ContextMenuItem, ContextMenuPosition } from './ContextMenu';

interface TreeNode extends FileEntry {
  isDirectory: boolean;
  isFile: boolean;
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

// File type icon configuration with colors
interface FileIconConfig {
  color: string;
  letter?: string;
  bg?: string;
}

const fileTypeIcons: Record<string, FileIconConfig> = {
  // TypeScript
  ts: { color: '#3178c6', letter: 'TS', bg: '#3178c6' },
  tsx: { color: '#3178c6', letter: 'TSX', bg: '#3178c6' },
  'd.ts': { color: '#3178c6', letter: 'D', bg: '#235a97' },
  // JavaScript
  js: { color: '#f7df1e', letter: 'JS', bg: '#f7df1e' },
  jsx: { color: '#61dafb', letter: 'JSX', bg: '#61dafb' },
  mjs: { color: '#f7df1e', letter: 'MJ', bg: '#f7df1e' },
  cjs: { color: '#f7df1e', letter: 'CJ', bg: '#f7df1e' },
  // Web
  html: { color: '#e34c26', letter: 'H', bg: '#e34c26' },
  htm: { color: '#e34c26', letter: 'H', bg: '#e34c26' },
  css: { color: '#264de4', letter: 'C', bg: '#264de4' },
  scss: { color: '#cc6699', letter: 'S', bg: '#cc6699' },
  sass: { color: '#cc6699', letter: 'S', bg: '#cc6699' },
  less: { color: '#1d365d', letter: 'L', bg: '#1d365d' },
  // Data
  json: { color: '#cbcb41', letter: '{ }', bg: '#cbcb41' },
  yaml: { color: '#cb171e', letter: 'Y', bg: '#cb171e' },
  yml: { color: '#cb171e', letter: 'Y', bg: '#cb171e' },
  xml: { color: '#e37933', letter: 'X', bg: '#e37933' },
  toml: { color: '#9c4121', letter: 'T', bg: '#9c4121' },
  // Markdown & Docs
  md: { color: '#519aba', letter: 'M', bg: '#519aba' },
  mdx: { color: '#519aba', letter: 'MDX', bg: '#519aba' },
  txt: { color: '#89888b', letter: 'T', bg: '#89888b' },
  // Python
  py: { color: '#3776ab', letter: 'PY', bg: '#3776ab' },
  pyw: { color: '#3776ab', letter: 'PY', bg: '#3776ab' },
  pyi: { color: '#3776ab', letter: 'PI', bg: '#3776ab' },
  ipynb: { color: '#f37626', letter: 'NB', bg: '#f37626' },
  // Rust
  rs: { color: '#dea584', letter: 'RS', bg: '#dea584' },
  // Go
  go: { color: '#00add8', letter: 'GO', bg: '#00add8' },
  mod: { color: '#00add8', letter: 'M', bg: '#00add8' },
  sum: { color: '#00add8', letter: 'S', bg: '#00add8' },
  // Java/Kotlin
  java: { color: '#b07219', letter: 'J', bg: '#b07219' },
  kt: { color: '#a97bff', letter: 'KT', bg: '#a97bff' },
  kts: { color: '#a97bff', letter: 'KS', bg: '#a97bff' },
  // C/C++
  c: { color: '#555555', letter: 'C', bg: '#555555' },
  h: { color: '#555555', letter: 'H', bg: '#555555' },
  cpp: { color: '#f34b7d', letter: 'C++', bg: '#f34b7d' },
  cc: { color: '#f34b7d', letter: 'C++', bg: '#f34b7d' },
  cxx: { color: '#f34b7d', letter: 'C++', bg: '#f34b7d' },
  hpp: { color: '#f34b7d', letter: 'H++', bg: '#f34b7d' },
  // C#
  cs: { color: '#178600', letter: 'C#', bg: '#178600' },
  // Ruby
  rb: { color: '#cc342d', letter: 'RB', bg: '#cc342d' },
  erb: { color: '#cc342d', letter: 'ERB', bg: '#cc342d' },
  // PHP
  php: { color: '#4f5d95', letter: 'PHP', bg: '#4f5d95' },
  // Shell
  sh: { color: '#89e051', letter: 'SH', bg: '#89e051' },
  bash: { color: '#89e051', letter: 'SH', bg: '#89e051' },
  zsh: { color: '#89e051', letter: 'ZSH', bg: '#89e051' },
  fish: { color: '#89e051', letter: 'F', bg: '#89e051' },
  ps1: { color: '#012456', letter: 'PS', bg: '#012456' },
  bat: { color: '#c1f12e', letter: 'BAT', bg: '#c1f12e' },
  cmd: { color: '#c1f12e', letter: 'CMD', bg: '#c1f12e' },
  // Config
  env: { color: '#ecd53f', letter: 'E', bg: '#ecd53f' },
  gitignore: { color: '#f14e32', letter: 'GI', bg: '#f14e32' },
  dockerignore: { color: '#2496ed', letter: 'DI', bg: '#2496ed' },
  editorconfig: { color: '#e0efef', letter: 'EC', bg: '#666' },
  prettierrc: { color: '#56b3b4', letter: 'P', bg: '#56b3b4' },
  eslintrc: { color: '#4b32c3', letter: 'ES', bg: '#4b32c3' },
  // Docker
  dockerfile: { color: '#2496ed', letter: 'D', bg: '#2496ed' },
  // SQL
  sql: { color: '#e38c00', letter: 'SQL', bg: '#e38c00' },
  // GraphQL
  graphql: { color: '#e10098', letter: 'GQL', bg: '#e10098' },
  gql: { color: '#e10098', letter: 'GQL', bg: '#e10098' },
  // Vue/Svelte
  vue: { color: '#41b883', letter: 'V', bg: '#41b883' },
  svelte: { color: '#ff3e00', letter: 'S', bg: '#ff3e00' },
  // Images
  png: { color: '#a074c4', letter: 'PNG' },
  jpg: { color: '#a074c4', letter: 'JPG' },
  jpeg: { color: '#a074c4', letter: 'JPG' },
  gif: { color: '#a074c4', letter: 'GIF' },
  svg: { color: '#ffb13b', letter: 'SVG', bg: '#ffb13b' },
  ico: { color: '#a074c4', letter: 'ICO' },
  webp: { color: '#a074c4', letter: 'WP' },
  // Fonts
  ttf: { color: '#f14c28', letter: 'TTF' },
  otf: { color: '#f14c28', letter: 'OTF' },
  woff: { color: '#f14c28', letter: 'W' },
  woff2: { color: '#f14c28', letter: 'W2' },
  // Archives
  zip: { color: '#eca517', letter: 'ZIP' },
  tar: { color: '#eca517', letter: 'TAR' },
  gz: { color: '#eca517', letter: 'GZ' },
  rar: { color: '#eca517', letter: 'RAR' },
  // Lock files
  lock: { color: '#ff5252', letter: 'L' },
  // Logs
  log: { color: '#7e7e7e', letter: 'LOG' },
};

// Special filename icons
const specialFileIcons: Record<string, FileIconConfig> = {
  'package.json': { color: '#e8274b', letter: 'N', bg: '#e8274b' },
  'package-lock.json': { color: '#e8274b', letter: 'NL', bg: '#cb3837' },
  'tsconfig.json': { color: '#3178c6', letter: 'TS', bg: '#3178c6' },
  'vite.config.ts': { color: '#646cff', letter: 'V', bg: '#646cff' },
  'vite.config.js': { color: '#646cff', letter: 'V', bg: '#646cff' },
  'webpack.config.js': { color: '#8dd6f9', letter: 'W', bg: '#8dd6f9' },
  'tailwind.config.js': { color: '#38bdf8', letter: 'TW', bg: '#38bdf8' },
  'tailwind.config.ts': { color: '#38bdf8', letter: 'TW', bg: '#38bdf8' },
  '.gitignore': { color: '#f14e32', letter: 'GI', bg: '#f14e32' },
  '.env': { color: '#ecd53f', letter: 'E', bg: '#ecd53f' },
  '.env.local': { color: '#ecd53f', letter: 'E', bg: '#ecd53f' },
  '.env.development': { color: '#ecd53f', letter: 'E', bg: '#ecd53f' },
  '.env.production': { color: '#ecd53f', letter: 'E', bg: '#ecd53f' },
  'dockerfile': { color: '#2496ed', letter: 'D', bg: '#2496ed' },
  'docker-compose.yml': { color: '#2496ed', letter: 'DC', bg: '#2496ed' },
  'docker-compose.yaml': { color: '#2496ed', letter: 'DC', bg: '#2496ed' },
  'readme.md': { color: '#519aba', letter: 'R', bg: '#519aba' },
  'license': { color: '#d4af37', letter: 'L', bg: '#d4af37' },
  'license.md': { color: '#d4af37', letter: 'L', bg: '#d4af37' },
  'cargo.toml': { color: '#dea584', letter: 'C', bg: '#dea584' },
  'cargo.lock': { color: '#dea584', letter: 'CL', bg: '#9e6b54' },
  'go.mod': { color: '#00add8', letter: 'GM', bg: '#00add8' },
  'go.sum': { color: '#00add8', letter: 'GS', bg: '#00879c' },
  'makefile': { color: '#6d8086', letter: 'MK', bg: '#6d8086' },
  'cmakelists.txt': { color: '#064f8c', letter: 'CM', bg: '#064f8c' },
  '.prettierrc': { color: '#56b3b4', letter: 'P', bg: '#56b3b4' },
  '.eslintrc.js': { color: '#4b32c3', letter: 'ES', bg: '#4b32c3' },
  '.eslintrc.json': { color: '#4b32c3', letter: 'ES', bg: '#4b32c3' },
  'jest.config.js': { color: '#99425b', letter: 'J', bg: '#99425b' },
  'jest.config.ts': { color: '#99425b', letter: 'J', bg: '#99425b' },
};

// Folder icons by name
const folderIcons: Record<string, { color: string; openColor?: string }> = {
  'src': { color: '#e8a838', openColor: '#dcb67a' },
  'source': { color: '#e8a838', openColor: '#dcb67a' },
  'lib': { color: '#a074c4', openColor: '#c9a5e0' },
  'dist': { color: '#c7254e', openColor: '#d86f8c' },
  'build': { color: '#c7254e', openColor: '#d86f8c' },
  'out': { color: '#c7254e', openColor: '#d86f8c' },
  'node_modules': { color: '#8bc34a', openColor: '#aed581' },
  'public': { color: '#ffca28', openColor: '#ffe082' },
  'static': { color: '#ffca28', openColor: '#ffe082' },
  'assets': { color: '#42a5f5', openColor: '#90caf9' },
  'images': { color: '#7e57c2', openColor: '#b39ddb' },
  'img': { color: '#7e57c2', openColor: '#b39ddb' },
  'icons': { color: '#7e57c2', openColor: '#b39ddb' },
  'fonts': { color: '#f44336', openColor: '#ef9a9a' },
  'styles': { color: '#42a5f5', openColor: '#90caf9' },
  'css': { color: '#42a5f5', openColor: '#90caf9' },
  'components': { color: '#4caf50', openColor: '#81c784' },
  'pages': { color: '#00bcd4', openColor: '#80deea' },
  'views': { color: '#00bcd4', openColor: '#80deea' },
  'layouts': { color: '#009688', openColor: '#80cbc4' },
  'hooks': { color: '#ff9800', openColor: '#ffcc80' },
  'utils': { color: '#9c27b0', openColor: '#ce93d8' },
  'helpers': { color: '#9c27b0', openColor: '#ce93d8' },
  'services': { color: '#3f51b5', openColor: '#9fa8da' },
  'api': { color: '#00bcd4', openColor: '#80deea' },
  'store': { color: '#8bc34a', openColor: '#aed581' },
  'stores': { color: '#8bc34a', openColor: '#aed581' },
  'state': { color: '#8bc34a', openColor: '#aed581' },
  'config': { color: '#607d8b', openColor: '#90a4ae' },
  'configs': { color: '#607d8b', openColor: '#90a4ae' },
  'test': { color: '#ef5350', openColor: '#ef9a9a' },
  'tests': { color: '#ef5350', openColor: '#ef9a9a' },
  '__tests__': { color: '#ef5350', openColor: '#ef9a9a' },
  'spec': { color: '#ef5350', openColor: '#ef9a9a' },
  'specs': { color: '#ef5350', openColor: '#ef9a9a' },
  'types': { color: '#3178c6', openColor: '#69a3d6' },
  '@types': { color: '#3178c6', openColor: '#69a3d6' },
  'interfaces': { color: '#3178c6', openColor: '#69a3d6' },
  'models': { color: '#ff7043', openColor: '#ffab91' },
  'schemas': { color: '#ff7043', openColor: '#ffab91' },
  'plugins': { color: '#ab47bc', openColor: '#ce93d8' },
  'middleware': { color: '#5c6bc0', openColor: '#9fa8da' },
  'routes': { color: '#26a69a', openColor: '#80cbc4' },
  'controllers': { color: '#5c6bc0', openColor: '#9fa8da' },
  'docs': { color: '#42a5f5', openColor: '#90caf9' },
  'documentation': { color: '#42a5f5', openColor: '#90caf9' },
  '.git': { color: '#f14e32', openColor: '#f77c66' },
  '.github': { color: '#333', openColor: '#666' },
  '.vscode': { color: '#007acc', openColor: '#4db8ff' },
  '.idea': { color: '#fe315d', openColor: '#ff6b8a' },
  'scripts': { color: '#4caf50', openColor: '#81c784' },
  'bin': { color: '#607d8b', openColor: '#90a4ae' },
  'vendor': { color: '#607d8b', openColor: '#90a4ae' },
  'migrations': { color: '#ff9800', openColor: '#ffcc80' },
  'database': { color: '#ff9800', openColor: '#ffcc80' },
  'db': { color: '#ff9800', openColor: '#ffcc80' },
  'locales': { color: '#66bb6a', openColor: '#a5d6a7' },
  'i18n': { color: '#66bb6a', openColor: '#a5d6a7' },
  'translations': { color: '#66bb6a', openColor: '#a5d6a7' },
};

function FileIcon({ name, isDirectory, isExpanded }: { name: string; isDirectory: boolean; isExpanded: boolean }) {
  if (isDirectory) {
    const lowerName = name.toLowerCase();
    const folderConfig = folderIcons[lowerName];
    const color = folderConfig 
      ? (isExpanded ? folderConfig.openColor || folderConfig.color : folderConfig.color)
      : (isExpanded ? '#dcb67a' : '#e8a838');
    
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.fileIcon}>
        {isExpanded ? (
          <path
            d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H5.79289C6.0581 2 6.31246 2.10536 6.5 2.29289L7.70711 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V5H2.5C1.94772 5 1.5 4.55228 1.5 4V3Z"
            fill={color}
          />
        ) : (
          <path
            d="M1.5 3C1.5 2.44772 1.94772 2 2.5 2H5.79289C6.0581 2 6.31246 2.10536 6.5 2.29289L7.70711 3.5H13.5C14.0523 3.5 14.5 3.94772 14.5 4.5V12C14.5 12.5523 14.0523 13 13.5 13H2.5C1.94772 13 1.5 12.5523 1.5 12V3Z"
            fill={color}
          />
        )}
        {isExpanded && (
          <path
            d="M0.5 6.5C0.5 5.94772 0.947715 5.5 1.5 5.5H13.5L15 5.5C15.3788 5.5 15.6961 5.76287 15.7643 6.13479L14.5 13C14.5 13.5523 14.0523 14 13.5 14H2C1.44771 14 0.960938 13.6218 0.843262 13.0807L0.5 6.5Z"
            fill={color}
            opacity="0.9"
          />
        )}
      </svg>
    );
  }

  // Check for special filenames first
  const lowerName = name.toLowerCase();
  let config = specialFileIcons[lowerName];
  
  if (!config) {
    // Check for extension
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
    // Check for compound extensions like .d.ts
    if (name.endsWith('.d.ts')) {
      config = fileTypeIcons['d.ts'];
    } else {
      config = fileTypeIcons[ext];
    }
  }

  if (!config) {
    // Default file icon
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.fileIcon}>
        <path
          d="M3 1.5C2.44772 1.5 2 1.94772 2 2.5V13.5C2 14.0523 2.44772 14.5 3 14.5H13C13.5523 14.5 14 14.0523 14 13.5V5.5L10 1.5H3Z"
          fill="#6d6d6d"
        />
        <path
          d="M10 1.5V4.5C10 5.05228 10.4477 5.5 11 5.5H14"
          fill="#8a8a8a"
        />
      </svg>
    );
  }

  const { color, letter, bg } = config;
  const displayLetter = letter || '';
  const fontSize = displayLetter.length > 2 ? 5 : displayLetter.length > 1 ? 6 : 7;

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.fileIcon}>
      <path
        d="M3 1.5C2.44772 1.5 2 1.94772 2 2.5V13.5C2 14.0523 2.44772 14.5 3 14.5H13C13.5523 14.5 14 14.0523 14 13.5V5.5L10 1.5H3Z"
        fill={bg || '#3c3c3c'}
      />
      <path
        d="M10 1.5V4.5C10 5.05228 10.4477 5.5 11 5.5H14"
        fill={color}
        opacity="0.7"
      />
      {displayLetter && (
        <text
          x="8"
          y="11"
          textAnchor="middle"
          fill="white"
          fontSize={fontSize}
          fontWeight="bold"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {displayLetter}
        </text>
      )}
    </svg>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (node: TreeNode) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>, node: TreeNode) => void;
  selectedPath: string | null;
}

function TreeItem({ node, depth, onToggle, onSelect, onContextMenu, selectedPath }: TreeItemProps) {
  const isSelected = selectedPath === node.path;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggle(node.path);
    }
    onSelect(node);
  };

  const handleDoubleClick = () => {
    if (node.isFile) {
      useEditorStore.getState().openFile(node.path);
    }
  };

  return (
    <div className={styles.treeItem}>
      <div
        className={`${styles.itemRow} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => onContextMenu(event, node)}
      >
        <span className={styles.chevron}>
          {node.isDirectory && (
            node.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          )}
        </span>
        <span className={styles.icon}>
          <FileIcon name={node.name} isDirectory={node.isDirectory} isExpanded={node.isExpanded || false} />
        </span>
        <span className={styles.name}>{node.name}</span>
      </div>
      {node.isDirectory && node.isExpanded && node.children && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { currentWorkspace, openFolder } = useWorkspaceStore();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newItemType, setNewItemType] = useState<'file' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    position: ContextMenuPosition;
    fileItem: ContextMenuFileItem | null;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<ContextMenuFileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const loadDirectory = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    try {
      const entries = await fs.readDirectory(dirPath);
      const nodes: TreeNode[] = entries
        .sort((a, b) => {
          if (a.is_directory && !b.is_directory) return -1;
          if (!a.is_directory && b.is_directory) return 1;
          return a.name.localeCompare(b.name);
        })
        .filter((e) => !e.name.startsWith('.'))
        .map((entry) => ({
          name: entry.name,
          path: entry.path,
          isDirectory: entry.is_directory,
          isFile: entry.is_file,
          is_directory: entry.is_directory,
          is_file: entry.is_file,
          isExpanded: false,
          children: entry.is_directory ? [] : undefined,
        }));
      return nodes;
    } catch (error) {
      console.error('Failed to load directory:', error);
      return [];
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    console.log('loadWorkspace called, currentWorkspace:', currentWorkspace);
    if (!currentWorkspace?.rootPath) {
      console.log('No workspace root path');
      return;
    }
    console.log('Loading workspace:', currentWorkspace.rootPath);
    setIsLoading(true);
    try {
      const nodes = await loadDirectory(currentWorkspace.rootPath);
      console.log('Loaded nodes:', nodes.length, nodes);
      setTree(nodes);
    } catch (error) {
      console.error('Failed to load workspace:', error);
    }
    setIsLoading(false);
  }, [currentWorkspace?.rootPath, loadDirectory]);

  // Debug: log when currentWorkspace changes
  useEffect(() => {
    console.log('FileTree: currentWorkspace changed:', currentWorkspace);
  }, [currentWorkspace]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // Set up file system watching
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    if (!currentWorkspace?.rootPath) return;
    
    let unlisten: UnlistenFn | null = null;
    
    const setupWatcher = async () => {
      try {
        // Start watching the directory
        await fs.watchDirectory(currentWorkspace.rootPath);
        console.log('FileTree: Started watching', currentWorkspace.rootPath);
        
        const windowLabel = getCurrentWindow().label;
        
        // Listen for file change events (filter by target_window)
        unlisten = await listen<FileChangeEvent>('fs-change', (event) => {
          // Only process events meant for this window
          if (event.payload.target_window && event.payload.target_window !== windowLabel) {
            return;
          }
          
          console.log('FileTree: File change detected', event.payload);
          
          // Debounce rapid changes
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          
          debounceTimerRef.current = setTimeout(() => {
            loadWorkspace();
          }, 500);
        });
      } catch (error) {
        console.error('FileTree: Failed to set up file watcher:', error);
      }
    };
    
    setupWatcher();
    
    return () => {
      if (unlisten) {
        unlisten();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Stop watching when component unmounts or workspace changes
      if (currentWorkspace?.rootPath) {
        fs.unwatchDirectory(currentWorkspace.rootPath).catch(console.error);
      }
    };
  }, [currentWorkspace?.rootPath, loadWorkspace]);

  const handleToggle = async (path: string) => {
    const updateTree = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
      return Promise.all(
        nodes.map(async (node) => {
          if (node.path === path) {
            if (!node.isExpanded && node.isDirectory) {
              const children = await loadDirectory(path);
              return { ...node, isExpanded: true, children };
            }
            return { ...node, isExpanded: !node.isExpanded };
          }
          if (node.children) {
            return { ...node, children: await updateTree(node.children) };
          }
          return node;
        })
      );
    };
    setTree(await updateTree(tree));
  };

  const handleSelect = (node: TreeNode) => {
    setSelectedPath(node.path);
    setContextMenu(null);
  };

  const resolveAbsolutePath = useCallback((path: string): string => {
    const rootPath = currentWorkspace?.rootPath;
    if (!rootPath) return path;
    if (path.startsWith(rootPath)) return path;
    if (path.startsWith('/')) return path;
    return `${rootPath}/${path}`.replace(/\/+/g, '/');
  }, [currentWorkspace?.rootPath]);

  const getRelativePath = useCallback((path: string): string => {
    const rootPath = currentWorkspace?.rootPath;
    if (!rootPath) return path;
    const normalizedRoot = rootPath.replace(/\/$/, '');
    const normalizedPath = path.replace(/\/$/, '');
    if (normalizedPath === normalizedRoot) return '.';
    if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1) || '.';
    }
    return normalizedPath;
  }, [currentWorkspace?.rootPath]);

  const getParentPathForTarget = (path: string, isDirectory: boolean): string => {
    const absolutePath = resolveAbsolutePath(path);
    if (isDirectory) return absolutePath;
    const parts = absolutePath.split('/');
    parts.pop();
    return parts.join('/') || currentWorkspace?.rootPath || '';
  };

  const getParentDirectoryPath = (path: string): string => {
    const absolutePath = resolveAbsolutePath(path);
    const parts = absolutePath.split('/');
    parts.pop();
    return parts.join('/') || currentWorkspace?.rootPath || '';
  };

  const selectCreateTarget = (item: ContextMenuFileItem | null) => {
    if (!currentWorkspace?.rootPath) return;
    if (!item) {
      setSelectedPath(currentWorkspace.rootPath);
      return;
    }
    setSelectedPath(getParentPathForTarget(item.path, item.isDirectory));
  };

  const getParentPath = (): string => {
    if (selectedPath) {
      if (selectedPath === currentWorkspace?.rootPath) {
        return selectedPath;
      }
      const selectedNode = findNode(tree, selectedPath);
      if (selectedNode?.isDirectory) {
        return selectedPath;
      }
      const parts = selectedPath.split('/');
      parts.pop();
      return parts.join('/') || currentWorkspace?.rootPath || '';
    }
    return currentWorkspace?.rootPath || '';
  };

  const findNode = (nodes: TreeNode[], path: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  };

  const handleCopyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (error) {
      console.error('Failed to copy via clipboard API:', error);
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (error) {
      console.error('Failed to copy via execCommand:', error);
    }
  };

  const startRename = (item: ContextMenuFileItem) => {
    setNewItemType(null);
    setNewItemName('');
    setContextMenu(null);
    setRenameTarget(item);
    setRenameValue(item.name);
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renameTarget.name || trimmed.includes('/')) {
      setRenameTarget(null);
      setRenameValue('');
      return;
    }

    const parentPath = getParentDirectoryPath(renameTarget.path);
    const newPath = `${parentPath}/${trimmed}`;
    const oldPath = resolveAbsolutePath(renameTarget.path);

    try {
      await fs.renamePath(oldPath, newPath);
      if (!renameTarget.isDirectory) {
        const editorStore = useEditorStore.getState();
        editorStore.closeFile(oldPath);
        editorStore.openFile(newPath);
      }
      setSelectedPath(newPath);
      await loadWorkspace();
    } catch (error) {
      console.error('Failed to rename:', error);
    }

    setRenameTarget(null);
    setRenameValue('');
  };

  const handleCancelRename = () => {
    setRenameTarget(null);
    setRenameValue('');
  };

  const handleRenameItem = (item: ContextMenuFileItem) => {
    startRename(item);
  };

  const handleDeleteItem = async (item: ContextMenuFileItem) => {
    const confirmed = window.confirm(
      `Delete ${item.isDirectory ? 'folder' : 'file'} "${item.name}"?`
    );
    if (!confirmed) return;

    try {
      const targetPath = resolveAbsolutePath(item.path);
      await fs.deletePath(targetPath);
      if (!item.isDirectory) {
        useEditorStore.getState().closeFile(targetPath);
      }
      if (selectedPath === item.path || selectedPath === targetPath) {
        setSelectedPath(null);
      }
      await loadWorkspace();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleRevealInFinder = async (path: string) => {
    const revealPath = resolveAbsolutePath(path);
    try {
      await fs.revealInFinder(revealPath);
    } catch (error) {
      console.error('Failed to reveal in Finder:', error);
    }
  };

  const handleOpenInTerminal = (item: ContextMenuFileItem | null) => {
    const targetPath = item
      ? getParentPathForTarget(item.path, item.isDirectory)
      : currentWorkspace?.rootPath;
    const resolvedPath = targetPath ? resolveAbsolutePath(targetPath) : targetPath;
    if (!resolvedPath) return;

    const escapedPath = resolvedPath.replace(/"/g, '\\"');
    useLayoutStore.getState().setActiveBottomTab('terminal');
    const terminalId = `file-tree-${Date.now()}`;
    window.dispatchEvent(new CustomEvent('run-command', {
      detail: {
        terminalId,
        command: `cd "${escapedPath}" && pwd`,
        cwd: resolvedPath,
        label: item ? `Terminal: ${item.name}` : 'Terminal',
      },
    }));
  };

  const handleOpenContextMenu = (event: MouseEvent<HTMLDivElement>, node?: TreeNode) => {
    event.preventDefault();
    event.stopPropagation();
    setRenameTarget(null);
    setRenameValue('');
    let item = node
      ? { path: node.path, name: node.name, isDirectory: node.isDirectory }
      : null;
    if (!item && selectedPath) {
      const selectedNode = findNode(tree, selectedPath);
      if (selectedNode) {
        item = { path: selectedNode.path, name: selectedNode.name, isDirectory: selectedNode.isDirectory };
      }
    }
    if (item) {
      setSelectedPath(item.path);
    }
    setContextMenu({
      position: { x: event.clientX, y: event.clientY },
      fileItem: item,
    });
  };

  const buildContextMenuItems = (item: ContextMenuFileItem | null): ContextMenuItem[] => {
    const rootPath = currentWorkspace?.rootPath;
    const targetPath = item?.path || rootPath;
    const resolvedTargetPath = targetPath ? resolveAbsolutePath(targetPath) : undefined;
    const isRoot = Boolean(item && rootPath && item.path === rootPath);

    const items: ContextMenuItem[] = [];
    const addDivider = (id: string) => {
      if (items.length > 0 && !items[items.length - 1].divider) {
        items.push({ id, divider: true });
      }
    };

    items.push(
      {
        id: 'new-file',
        label: 'New File',
        icon: <FilePlus size={14} />,
        disabled: !rootPath,
        action: () => {
          selectCreateTarget(item);
          handleNewFile();
        },
      },
      {
        id: 'new-folder',
        label: 'New Folder',
        icon: <FolderPlus size={14} />,
        disabled: !rootPath,
        action: () => {
          selectCreateTarget(item);
          handleNewFolder();
        },
      }
    );
    addDivider('divider-create');

    if (item && !item.isDirectory) {
      items.push({
        id: 'open-file',
        label: 'Open',
        icon: <FileText size={14} />,
        action: () => useEditorStore.getState().openFile(item.path),
      });
    }

    if (item) {
      items.push(
        {
          id: 'rename',
          label: 'Rename',
          icon: <Pencil size={14} />,
          disabled: isRoot,
          action: () => handleRenameItem(item),
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: isRoot,
          action: () => handleDeleteItem(item),
        }
      );
    }

    if (resolvedTargetPath) {
      addDivider('divider-path');
      items.push(
        {
          id: 'copy-path',
          label: 'Copy Path',
          icon: <Copy size={14} />,
          action: () => handleCopyToClipboard(resolvedTargetPath),
        },
        {
          id: 'copy-relative-path',
          label: 'Copy Relative Path',
          icon: <Copy size={14} />,
          action: () => handleCopyToClipboard(getRelativePath(resolvedTargetPath)),
        },
        {
          id: 'reveal-finder',
          label: 'Reveal in Finder',
          icon: <FolderOpen size={14} />,
          action: () => handleRevealInFinder(resolvedTargetPath),
        },
        {
          id: 'open-terminal',
          label: 'Open in Terminal',
          icon: <Terminal size={14} />,
          action: () => handleOpenInTerminal(item),
        },
        {
          id: 'refresh',
          label: 'Refresh',
          icon: <RefreshCw size={14} />,
          action: () => void loadWorkspace(),
        }
      );
    }

    return items;
  };

  const handleNewFile = () => {
    setRenameTarget(null);
    setRenameValue('');
    setNewItemType('file');
    setNewItemName('');
  };

  const handleNewFolder = () => {
    setRenameTarget(null);
    setRenameValue('');
    setNewItemType('folder');
    setNewItemName('');
  };

  const handleCreateItem = async () => {
    if (!newItemName.trim() || !newItemType) return;
    
    const parentPath = getParentPath();
    const newPath = `${parentPath}/${newItemName.trim()}`;
    
    try {
      if (newItemType === 'file') {
        await fs.createFile(newPath);
        useEditorStore.getState().openFile(newPath);
      } else {
        await fs.createDirectory(newPath);
      }
      await loadWorkspace();
    } catch (error) {
      console.error(`Failed to create ${newItemType}:`, error);
    }
    
    setNewItemType(null);
    setNewItemName('');
  };

  const handleCancelCreate = () => {
    setNewItemType(null);
    setNewItemName('');
  };

  const handleOpenFolder = async () => {
    const folderPath = await dialog.openDirectory();
    if (folderPath) {
      await openFolder(folderPath);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className={styles.empty}>
        <p>No folder opened</p>
        <button className={styles.openButton} onClick={handleOpenFolder}>
          <FolderPlus size={16} />
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className={styles.fileTree}>
      <div className={styles.toolbar}>
        <button
          className={styles.toolbarButton}
          onClick={handleNewFile}
          title="New File"
        >
          <FilePlus size={16} />
        </button>
        <button
          className={styles.toolbarButton}
          onClick={handleNewFolder}
          title="New Folder"
        >
          <FolderPlus size={16} />
        </button>
        <button
          className={styles.toolbarButton}
          onClick={loadWorkspace}
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {newItemType && (
        <div className={styles.newItemInput}>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateItem();
              if (e.key === 'Escape') handleCancelCreate();
            }}
            placeholder={newItemType === 'file' ? 'filename.ext' : 'folder name'}
            autoFocus
          />
          <button onClick={handleCreateItem} className={styles.createBtn}>Create</button>
          <button onClick={handleCancelCreate} className={styles.cancelBtn}>Cancel</button>
        </div>
      )}
      {renameTarget && (
        <div className={styles.newItemInput}>
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') handleCancelRename();
            }}
            placeholder={renameTarget.isDirectory ? 'folder name' : 'filename.ext'}
            autoFocus
          />
          <button onClick={handleRenameSubmit} className={styles.createBtn}>Rename</button>
          <button onClick={handleCancelRename} className={styles.cancelBtn}>Cancel</button>
        </div>
      )}
      <div
        className={styles.treeContent}
        onContextMenu={(event) => handleOpenContextMenu(event)}
      >
        {isLoading ? (
          <div className={styles.loading}>Loading...</div>
        ) : (
          tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onContextMenu={handleOpenContextMenu}
              selectedPath={selectedPath}
            />
          ))
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          position={contextMenu.position}
          items={buildContextMenuItems(contextMenu.fileItem)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
