
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import styles from './ContextMenu.module.css';

export interface ContextMenuPosition {
  x: number;
  y: number;
}

export interface ContextMenuFileItem {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
  action?: () => void;
}

interface ContextMenuProps {
  position: ContextMenuPosition;
  onClose: () => void;
  items: ContextMenuItem[];
}

export function ContextMenu({ position, onClose, items }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  const menuWidth = 220;
  const menuHeight = items.length * 32 + 8;
  const adjustedX = position.x + menuWidth > window.innerWidth
    ? window.innerWidth - menuWidth - 8
    : position.x;
  const adjustedY = position.y + menuHeight > window.innerHeight
    ? window.innerHeight - menuHeight - 8
    : position.y;

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) =>
        item.divider ? (
          <div key={item.id} className={styles.divider} />
        ) : (
          <button
            key={item.id}
            className={`${styles.menuItem} ${item.disabled ? styles.disabled : ''} ${item.danger ? styles.danger : ''}`}
            onClick={() => {
              if (!item.disabled && item.action) {
                item.action();
                onClose();
              }
            }}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}