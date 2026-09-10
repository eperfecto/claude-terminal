/** @jest-environment jsdom */
/**
 * The server version indicator.
 *
 * Knowing which build the cloud server runs used to require an SSH session: the
 * PWA showed nothing and /health reported the frozen version of the cloud
 * package. The indicator answers it at a glance — but only when the answer is
 * real. A dash or a "?" in that pill reads as a broken app, so anything short of
 * a version keeps it hidden.
 */

const { conn, _applyServerVersion, _fetchServerVersion } = require('../../remote-ui/app.js');

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const pill = () => document.getElementById('server-version');

beforeEach(() => {
  document.body.innerHTML = `
    <div class="view-header">
      <h2 class="view-title">Projects</h2>
      <span class="view-count" id="projects-count">0</span>
      <span class="view-count view-version" id="server-version" hidden></span>
    </div>`;
  conn.cloudUrl = 'https://cloud.example.com';
  conn.cloudApiKey = 'ctc_k';
});

test('shows the version the server reports', () => {
  _applyServerVersion({ status: 'ok', version: '2.0.0', cloud: true });

  expect(pill().hidden).toBe(false);
  expect(pill().textContent).toBe('2.0.0');
});

test('stays hidden when the server reports no version', () => {
  _applyServerVersion({ status: 'ok', cloud: true });

  expect(pill().hidden).toBe(true);
  expect(pill().textContent).toBe('');
});

test('stays hidden when the probe failed', () => {
  _applyServerVersion(null);

  expect(pill().hidden).toBe(true);
});

test('hides a version it had already shown once the server stops reporting one', () => {
  _applyServerVersion({ version: '2.0.0' });
  _applyServerVersion(null);

  expect(pill().hidden).toBe(true);
  expect(pill().textContent).toBe('');
});

test('reads /health on the cloud origin, without a credential', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ version: '2.0.0' }),
  }));

  await _fetchServerVersion();
  await flush();

  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('https://cloud.example.com/health');
  // /health is public; sending the API key to it would leak the credential to an
  // endpoint that has no use for it.
  expect(opts?.headers?.Authorization).toBeUndefined();
  expect(pill().textContent).toBe('2.0.0');
});

test('leaves the indicator hidden when /health is unreachable', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));

  await _fetchServerVersion();
  await flush();

  expect(pill().hidden).toBe(true);
});
