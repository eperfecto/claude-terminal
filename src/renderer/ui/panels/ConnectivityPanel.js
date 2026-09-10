/**
 * ConnectivityPanel
 * The "Connectivity" tab. It used to carry two sub-tabs — Local Wi-Fi and Cloud
 * — but the local remote server is gone: the phone talks to the cloud server and
 * nothing else, so this is now a thin wrapper around CloudPanel. It stays as its
 * own module because the sidebar, its persisted tab id and its CSS all key off
 * "connectivity".
 */

const CloudPanel = require('./CloudPanel');

function buildHtml(settings) {
  return `
    <div class="cn-panel">
      <div class="cn-content">
        <div class="cn-sub-panel active" data-cn-panel="cloud">
          <div class="cn-sub-panel-inner">
            ${CloudPanel.buildHtml(settings)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function setupHandlers(context) {
  CloudPanel.setupHandlers(context);
}

function cleanup() {
  CloudPanel.cleanup();
}

module.exports = { buildHtml, setupHandlers, cleanup };
