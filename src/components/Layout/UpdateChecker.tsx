import { useState, useEffect } from 'react';
import { Download, X, ExternalLink, RefreshCw } from 'lucide-react';
import styles from './UpdateChecker.module.css';

interface ReleaseInfo {
  version: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
}

const CURRENT_VERSION = '0.1.0';
const GITHUB_REPO = 'opencodebrew/opencodebrew';

export function UpdateChecker() {
  const [isChecking, setIsChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<ReleaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUpToDate, setIsUpToDate] = useState(false);

  useEffect(() => {
    const handleCheckUpdates = () => {
      checkForUpdates();
    };

    window.addEventListener('check-for-updates', handleCheckUpdates);
    return () => {
      window.removeEventListener('check-for-updates', handleCheckUpdates);
    };
  }, []);

  const checkForUpdates = async () => {
    setIsChecking(true);
    setError(null);
    setUpdateInfo(null);
    setIsUpToDate(false);
    setShowDialog(true);

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (response.status === 404) {
        setIsUpToDate(true);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to check for updates: ${response.statusText}`);
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, '');

      if (compareVersions(latestVersion, CURRENT_VERSION) > 0) {
        setUpdateInfo({
          version: latestVersion,
          name: release.name || `Version ${latestVersion}`,
          body: release.body || 'No release notes available.',
          html_url: release.html_url,
          published_at: release.published_at,
        });
      } else {
        setIsUpToDate(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for updates');
    } finally {
      setIsChecking(false);
    }
  };

  const compareVersions = (a: string, b: string): number => {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  };

  const openReleasePage = () => {
    if (updateInfo?.html_url) {
      window.open(updateInfo.html_url, '_blank');
    }
  };

  if (!showDialog) return null;

  return (
    <div className={styles.overlay} onClick={() => setShowDialog(false)}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Check for Updates</h2>
          <button className={styles.closeBtn} onClick={() => setShowDialog(false)}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.content}>
          {isChecking && (
            <div className={styles.checking}>
              <RefreshCw size={24} className={styles.spinner} />
              <p>Checking for updates...</p>
            </div>
          )}

          {error && (
            <div className={styles.error}>
              <p>{error}</p>
              <button className={styles.retryBtn} onClick={checkForUpdates}>
                Try Again
              </button>
            </div>
          )}

          {isUpToDate && !isChecking && (
            <div className={styles.upToDate}>
              <div className={styles.checkmark}>✓</div>
              <h3>You're up to date!</h3>
              <p>OpenCodeBrew {CURRENT_VERSION} is the latest version.</p>
            </div>
          )}

          {updateInfo && !isChecking && (
            <div className={styles.updateAvailable}>
              <div className={styles.updateIcon}>
                <Download size={32} />
              </div>
              <h3>Update Available</h3>
              <p className={styles.versionInfo}>
                Version {updateInfo.version} is now available (you have {CURRENT_VERSION})
              </p>
              
              <div className={styles.releaseNotes}>
                <h4>Release Notes</h4>
                <div className={styles.releaseBody}>
                  {updateInfo.body.split('\n').slice(0, 10).map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>

              <button className={styles.downloadBtn} onClick={openReleasePage}>
                <ExternalLink size={16} />
                View on GitHub
              </button>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.currentVersion}>Current version: {CURRENT_VERSION}</span>
        </div>
      </div>
    </div>
  );
}
