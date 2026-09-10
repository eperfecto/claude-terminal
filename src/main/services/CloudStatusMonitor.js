/**
 * CloudStatusMonitor
 *
 * Tracks whether the cloud server is reachable. This used to be implied by the
 * relay WebSocket staying open; with the relay gone it is an explicit REST
 * probe. The event only fires on a transition, because the renderer raises
 * user-facing toasts on `connected` and a chatty signal would spam them.
 */

const DEFAULT_INTERVAL_MS = 60_000;

let _timer = null;
let _probe = null;
let _emit = null;
let _connected = null; // null = never probed

function start({ probe, emit, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  stop();
  _probe = probe;
  _emit = emit;
  _connected = null;
  if (intervalMs > 0) {
    _timer = setInterval(() => { probeNow().catch(() => {}); }, intervalMs);
    if (_timer.unref) _timer.unref();
  }
}

async function probeNow() {
  if (!_probe) return false;
  let ok = false;
  try {
    ok = (await _probe()) === true;
  } catch {
    ok = false;
  }
  if (ok !== _connected) {
    _connected = ok;
    if (_emit) _emit({ connected: ok });
  }
  return ok;
}

function isConnected() {
  return _connected === true;
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  _probe = null;
  _emit = null;
  _connected = null;
}

module.exports = { start, probeNow, isConnected, stop };
