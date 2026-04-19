import { useState, useEffect } from 'react';
import { Type } from 'lucide-react';
import styles from './FontSizeIndicator.module.css';

export function FontSizeIndicator() {
  const [fontSize, setFontSize] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const handleFontSizeChange = (event: CustomEvent<{ fontSize: number }>) => {
      setFontSize(event.detail.fontSize);
      setVisible(true);

      // Clear existing timeout
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Hide after 1.5 seconds
      timeoutId = setTimeout(() => {
        setVisible(false);
      }, 1500);
    };

    window.addEventListener('font-size-changed', handleFontSizeChange as EventListener);
    
    return () => {
      window.removeEventListener('font-size-changed', handleFontSizeChange as EventListener);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  if (!visible || fontSize === null) return null;

  return (
    <div className={styles.indicator}>
      <Type size={20} />
      <span className={styles.value}>{fontSize}</span>
    </div>
  );
}
