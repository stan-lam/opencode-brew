import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';
import styles from './Notification.module.css';

interface NotificationData {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
}

export function NotificationContainer() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  useEffect(() => {
    const handleNotification = (event: CustomEvent<{ message: string; type?: 'info' | 'success' | 'error' }>) => {
      const id = Date.now();
      const type = event.detail.type || 'info';
      
      setNotifications(prev => [...prev, { id, message: event.detail.message, type }]);

      // Auto-remove after 4 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== id));
      }, 4000);
    };

    window.addEventListener('show-notification', handleNotification as EventListener);
    return () => {
      window.removeEventListener('show-notification', handleNotification as EventListener);
    };
  }, []);

  const removeNotification = (id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (notifications.length === 0) return null;

  return (
    <div className={styles.container}>
      {notifications.map(notification => (
        <div 
          key={notification.id} 
          className={`${styles.notification} ${styles[notification.type]}`}
        >
          <span className={styles.icon}>
            {notification.type === 'error' && <AlertCircle size={18} />}
            {notification.type === 'success' && <CheckCircle size={18} />}
            {notification.type === 'info' && <Info size={18} />}
          </span>
          <span className={styles.message}>{notification.message}</span>
          <button 
            className={styles.close}
            onClick={() => removeNotification(notification.id)}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
