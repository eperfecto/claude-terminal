/** @jest-environment jsdom */
/**
 * Keeping the history list clear of chats already on screen.
 *
 * A live cloud chat is keyed locally as `headless-<cloud id>`, while the same
 * conversation on disk is named by the SDK's id. Comparing those two directly
 * never matches, so every open cloud chat was also listed again underneath as
 * if it were an old one.
 */

const { _unlistedPastSessions } = require('../../remote-ui/app.js');

test('drops a past session already open as a live cloud chat', () => {
  const live = { 'headless-cloud-1': { sessionId: 'headless-cloud-1', messages: [] } };
  const past = [
    { sessionId: 'sdk-1', cloudSessionId: 'cloud-1' },
    { sessionId: 'sdk-2' },
  ];

  expect(_unlistedPastSessions(past, live)).toEqual([{ sessionId: 'sdk-2' }]);
});

test('drops a past session already listed as a desktop chat', () => {
  const live = { 'sdk-1': { sessionId: 'sdk-1', messages: [] } };
  const past = [{ sessionId: 'sdk-1' }, { sessionId: 'sdk-2' }];

  expect(_unlistedPastSessions(past, live)).toEqual([{ sessionId: 'sdk-2' }]);
});

test('keeps a past session whose cloud id belongs to no open chat', () => {
  const live = { 'headless-cloud-9': { sessionId: 'headless-cloud-9', messages: [] } };
  const past = [{ sessionId: 'sdk-1', cloudSessionId: 'cloud-1' }];

  expect(_unlistedPastSessions(past, live)).toEqual(past);
});

test('survives a project with no history at all', () => {
  expect(_unlistedPastSessions(undefined, {})).toEqual([]);
});
