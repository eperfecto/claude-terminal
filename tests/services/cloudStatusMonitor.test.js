/**
 * The desktop's "cloud connected" light used to be the relay socket. With the
 * relay gone it is a REST probe, and it must keep the same contract the
 * renderer relies on: an event only when the state actually flips.
 */

const CloudStatusMonitor = require('../../src/main/services/CloudStatusMonitor');

afterEach(() => { CloudStatusMonitor.stop(); });

test('emits connected:true after the first successful probe', async () => {
  const events = [];
  CloudStatusMonitor.start({
    probe: async () => true,
    emit: (s) => events.push(s),
    intervalMs: 0,
  });
  await CloudStatusMonitor.probeNow();

  expect(events).toEqual([{ connected: true }]);
});

test('emits connected:false when the probe starts failing', async () => {
  const events = [];
  let ok = true;
  CloudStatusMonitor.start({
    probe: async () => ok,
    emit: (s) => events.push(s),
    intervalMs: 0,
  });
  await CloudStatusMonitor.probeNow();
  ok = false;
  await CloudStatusMonitor.probeNow();

  expect(events).toEqual([{ connected: true }, { connected: false }]);
});

test('does not re-emit while the state is unchanged', async () => {
  const events = [];
  CloudStatusMonitor.start({
    probe: async () => true,
    emit: (s) => events.push(s),
    intervalMs: 0,
  });
  await CloudStatusMonitor.probeNow();
  await CloudStatusMonitor.probeNow();
  await CloudStatusMonitor.probeNow();

  expect(events).toHaveLength(1);
});

test('a throwing probe counts as disconnected, not as a crash', async () => {
  const events = [];
  CloudStatusMonitor.start({
    probe: async () => { throw new Error('ECONNREFUSED'); },
    emit: (s) => events.push(s),
    intervalMs: 0,
  });
  await CloudStatusMonitor.probeNow();

  expect(events).toEqual([{ connected: false }]);
});

test('reports disconnected once stopped, whatever the last probe said', async () => {
  CloudStatusMonitor.start({ probe: async () => true, emit: () => {}, intervalMs: 0 });
  await CloudStatusMonitor.probeNow();
  expect(CloudStatusMonitor.isConnected()).toBe(true);

  CloudStatusMonitor.stop();

  expect(CloudStatusMonitor.isConnected()).toBe(false);
});
