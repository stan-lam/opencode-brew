import { useEffect, useRef } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useOutputStore } from '../../store/outputStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './OutputPanel.module.css';

export function OutputPanel() {
  const { channels, activeChannel, setActiveChannel, clearChannel } = useOutputStore();
  const settings = useSettingsStore();
  const contentRef = useRef<HTMLDivElement>(null);

  const currentChannel = channels.find((c) => c.id === activeChannel);

  // Auto-scroll to bottom when new content is added
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [currentChannel?.content]);

  return (
    <div 
      className={styles.outputPanel}
      style={{
        backgroundColor: settings.terminalBackground,
        color: settings.terminalForeground,
      }}
    >
      <div className={styles.header}>
        <div className={styles.channelSelector}>
          <select
            value={activeChannel}
            onChange={(e) => setActiveChannel(e.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={styles.selectIcon} />
        </div>
        <button
          className={styles.clearBtn}
          onClick={() => clearChannel(activeChannel)}
          title="Clear Output"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div 
        className={styles.content} 
        ref={contentRef}
        style={{
          backgroundColor: settings.terminalBackground,
          color: settings.terminalForeground,
          fontFamily: settings.terminalFontFamily,
          fontSize: settings.terminalFontSize,
          lineHeight: settings.terminalLineHeight,
        }}
      >
        {currentChannel?.content.length === 0 ? (
          <div className={styles.empty}>No output</div>
        ) : (
          currentChannel?.content.map((line, index) => (
            <div key={index} className={styles.line}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
