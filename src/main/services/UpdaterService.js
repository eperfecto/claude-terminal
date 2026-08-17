/**
 * Updater Service
 * Manages application auto-updates
 */

const { autoUpdater } = require('electron-updater');
const { app, Notification } = require('electron');
const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { UPDATE_REPO } = require('../utils/updateRepo');

// Check interval: 30 minutes
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Set CT_DEV_UPDATER=1 to exercise the update cycle from an unpackaged checkout
// (electron-updater then reads dev-app-update.yml instead of app-update.yml).
const DEV_UPDATER_ENABLED = process.env.CT_DEV_UPDATER === '1';

/**
 * Numeric semver-ish comparison. A plain string compare is wrong here:
 * '1.2.9' >= '1.2.17' is true lexicographically.
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

class UpdaterService {
  constructor() {
    this.mainWindow = null;
    this.isInitialized = false;
    this.checkInterval = null;
    this.lastKnownVersion = null;
    this.isDownloading = false;
    this.installAfterDownload = false;
    this.isVerifying = false;
    this.lastNotifiedVersion = null;
  }

  /**
   * Set the main window reference for IPC communication
   * @param {BrowserWindow} window
   */
  setMainWindow(window) {
    this.mainWindow = window;
  }

  /**
   * Safely send IPC message to main window
   */
  safeSend(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Whether electron-updater will actually do anything. Mirrors its own
   * `isUpdaterActive()`: packaged builds, or dev runs with CT_DEV_UPDATER=1.
   */
  isUpdaterAvailable() {
    return app.isPackaged || DEV_UPDATER_ENABLED;
  }

  /**
   * Resolve the directory electron-updater caches a pending download in.
   * Mirrors its own resolution: `getAppCacheDir()` (AppAdapter.js) joined with
   * the `updaterCacheDirName` baked into app-update.yml, falling back to the
   * app name. Note this is the OS *cache* dir, NOT `userData/..`.
   */
  getPendingCacheDir() {
    let baseCachePath;
    if (process.platform === 'win32') {
      baseCachePath = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    } else if (process.platform === 'darwin') {
      baseCachePath = path.join(os.homedir(), 'Library', 'Caches');
    } else {
      baseCachePath = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    }

    let dirName = null;
    try {
      const configPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app-update.yml')
        : path.join(app.getAppPath(), 'dev-app-update.yml');
      if (fs.existsSync(configPath)) {
        const match = fs.readFileSync(configPath, 'utf-8').match(/^updaterCacheDirName:\s*(.+)$/m);
        if (match) dirName = match[1].trim();
      }
    } catch {
      // fall through to the app-name default
    }

    return path.join(baseCachePath, dirName || `${app.getName()}-updater`, 'pending');
  }

  /**
   * Clear stale updater cache if the app version already matches or exceeds the pending update.
   * Prevents old cached downloads from blocking detection of newer versions.
   */
  clearStalePendingCache() {
    try {
      const cacheDir = this.getPendingCacheDir();
      const infoPath = path.join(cacheDir, 'update-info.json');

      if (!fs.existsSync(infoPath)) return;

      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
      const cachedFileName = info.fileName || '';
      const versionMatch = cachedFileName.match(/(\d+\.\d+\.\d+)/);
      if (!versionMatch) return;

      const cachedVersion = versionMatch[1];
      const currentVersion = app.getVersion();

      if (compareVersions(currentVersion, cachedVersion) >= 0) {
        console.debug(`Clearing stale updater cache (cached: ${cachedVersion}, current: ${currentVersion})`);
        const files = fs.readdirSync(cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(cacheDir, file));
        }
      }
    } catch (err) {
      console.error('Failed to clear stale updater cache:', err);
    }
  }

  /**
   * Initialize the auto updater
   */
  initialize() {
    if (this.isInitialized) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    // Only ever true in dev with CT_DEV_UPDATER=1; makes electron-updater read
    // dev-app-update.yml so the cycle can be tested without packaging.
    autoUpdater.forceDevUpdateConfig = !app.isPackaged && DEV_UPDATER_ENABLED;

    // Handle update available
    autoUpdater.on('update-available', (info) => {
      this.lastKnownVersion = info.version;
      this.isDownloading = true;
      // Skip UI update if this event was triggered by verifyLatestBeforeNotify
      if (this.isVerifying) return;
      // Already notified for this version (periodic re-check on cached download) — don't reset the banner
      if (this.lastNotifiedVersion === info.version) return;
      // Pre-fetch changelog while downloading
      this.pendingChangelog = this.fetchReleaseNotes(info.version);
      this.safeSend('update-status', { status: 'available', version: info.version });
    });

    // Handle update downloaded
    autoUpdater.on('update-downloaded', (info) => {
      this.lastKnownVersion = info.version;
      this.isDownloading = false;

      // If install was requested while downloading, proceed now
      if (this.installAfterDownload) {
        this.installAfterDownload = false;
        this.quitAndInstall();
        return;
      }

      // Skip if triggered during verification (will be handled by verifyLatestBeforeNotify)
      if (this.isVerifying) return;

      // Re-check if an even newer version exists before showing banner
      this.verifyLatestBeforeNotify(info.version);
    });

    // Handle update not available
    autoUpdater.on('update-not-available', (info) => {
      this.isDownloading = false;
      // If we had a downloaded version but now there's nothing newer,
      // it means we're up to date (after an install)
      this.safeSend('update-status', { status: 'not-available' });
    });

    // Handle error
    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err);
      this.isDownloading = false;
      this.safeSend('update-status', { status: 'error', error: err.message });
    });

    // Handle download progress
    autoUpdater.on('download-progress', (progressObj) => {
      this.safeSend('update-status', { status: 'downloading', progress: progressObj.percent });
    });

    this.isInitialized = true;
  }

  /**
   * Check for updates (only in production, or in dev with CT_DEV_UPDATER=1)
   * @param {boolean} [isPackaged] - Whether the app is packaged
   */
  checkForUpdates(isPackaged = app.isPackaged) {
    if (isPackaged || DEV_UPDATER_ENABLED) {
      this.clearStalePendingCache();
      this.initialize();
      autoUpdater.checkForUpdatesAndNotify();

      // Start periodic update checks
      this.startPeriodicCheck();
    }
  }

  /**
   * Start periodic update checks
   */
  startPeriodicCheck() {
    // Clear any existing interval
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    // Check every 30 minutes for new versions
    this.checkInterval = setInterval(() => {
      // Only check if not currently downloading
      if (!this.isDownloading) {
        console.debug('Periodic update check...');
        autoUpdater.checkForUpdates().catch(err => {
          console.error('Periodic update check failed:', err);
        });
      }
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic update checks
   */
  stopPeriodicCheck() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Manually trigger an update check.
   * Always resolves with a verdict instead of leaking electron-updater's raw
   * result: the server version alone is not an update (it equals the installed
   * version when up to date), and in dev the check cannot run at all.
   * @returns {Promise<{available: boolean, version: string|null, currentVersion: string, devMode: boolean}>}
   */
  async manualCheck() {
    const currentVersion = app.getVersion();

    if (!this.isUpdaterAvailable()) {
      return { available: false, version: null, currentVersion, devMode: true };
    }

    this.initialize();
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version || null;

    return {
      available: !!version && compareVersions(version, currentVersion) > 0,
      version,
      currentVersion,
      devMode: false
    };
  }

  /**
   * After a download completes, verify no newer version exists on the server.
   * Only shows the banner if the downloaded version is truly the latest.
   * @param {string} downloadedVersion
   */
  async verifyLatestBeforeNotify(downloadedVersion) {
    this.isVerifying = true;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const serverVersion = result.updateInfo.version;
        if (serverVersion !== downloadedVersion) {
          console.debug(`Downloaded ${downloadedVersion} but ${serverVersion} is available, re-downloading...`);
          this.isVerifying = false;
          // autoDownload will handle downloading the newer version
          // Don't show the banner yet - wait for the new download
          this.safeSend('update-status', { status: 'available', version: serverVersion });
          return;
        }
      }
    } catch (err) {
      console.error('Verify latest failed:', err);
    }
    this.isVerifying = false;

    // Already notified for this version — avoid spamming banner + native notif on each periodic check
    if (this.lastNotifiedVersion === downloadedVersion) {
      this.pendingChangelog = null;
      return;
    }
    this.lastNotifiedVersion = downloadedVersion;

    // Use pre-fetched changelog or fetch now
    const changelog = await (this.pendingChangelog || this.fetchReleaseNotes(downloadedVersion));
    this.pendingChangelog = null;

    // Downloaded version is the latest, show banner
    this.safeSend('update-status', { status: 'downloaded', version: downloadedVersion, changelog });

    // Show native OS notification if main window is not visible (minimized to tray)
    this.showNativeUpdateNotification(downloadedVersion);
  }

  /**
   * Show native OS notification when update is ready and window is hidden
   * @param {string} version
   */
  showNativeUpdateNotification(version) {
    try {
      const { isMainWindowVisible, showMainWindow } = require('../windows/MainWindow');
      if (!isMainWindowVisible()) {
        const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
        const iconPath = app.isPackaged
          ? path.join(process.resourcesPath, 'assets', iconName)
          : path.join(__dirname, '..', '..', '..', 'assets', iconName);

        const notif = new Notification({
          title: 'Claude Terminal',
          body: `v${version} ready to install`,
          icon: fs.existsSync(iconPath) ? iconPath : undefined
        });
        notif.on('click', () => showMainWindow());
        notif.show();
      }
    } catch (err) {
      console.error('Failed to show native update notification:', err);
    }
  }

  /**
   * Fetch release notes from GitHub for a specific version
   * @param {string} version
   * @returns {Promise<string|null>} Markdown body or null
   */
  fetchReleaseNotes(version) {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${UPDATE_REPO.owner}/${UPDATE_REPO.repo}/releases/tags/v${version}`,
        headers: {
          'User-Agent': 'ClaudeTerminal',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 10000
      };

      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const json = JSON.parse(data);
              resolve(json.body || null);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  /**
   * Quit and install update
   */
  async quitAndInstall() {
    try {
      // Check if there's a newer version available
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const serverVersion = result.updateInfo.version;

        if (this.lastKnownVersion && serverVersion !== this.lastKnownVersion) {
          console.debug(`Newer version available: ${serverVersion} (was: ${this.lastKnownVersion}), re-downloading...`);
          // Flag to auto-install once the new download completes
          this.installAfterDownload = true;
          this.safeSend('update-status', { status: 'downloading', progress: 0 });
          return;
        }
      }
    } catch (err) {
      console.error('Check before install failed:', err);
      // Proceed with install anyway
    }

    // Stop periodic checks before quitting
    this.stopPeriodicCheck();

    // Set quitting flag only right before install — if quitAndInstall throws,
    // the app remains functional (tray icon, reopen from tray, etc.)
    try {
      const { setQuitting } = require('../windows/MainWindow');
      setQuitting(true);
      autoUpdater.quitAndInstall();
    } catch (err) {
      console.error('quitAndInstall failed:', err);
      const { setQuitting } = require('../windows/MainWindow');
      setQuitting(false);
      this.safeSend('update-status', { status: 'error', error: err.message });
    }
  }
}

// Singleton instance
const updaterService = new UpdaterService();

module.exports = updaterService;
