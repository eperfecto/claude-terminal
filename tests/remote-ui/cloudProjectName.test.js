/** @jest-environment jsdom */
/**
 * Addressing a cloud project.
 *
 * The cloud API knows a project by the server's canonical key, which the PWA
 * stores in `path` when it maps /api/projects into state. `name` holds the
 * human-facing displayName, which the server has never seen — sending it makes
 * every cloud call fail with `Project "<displayName>" does not exist`.
 */

const { _cloudProjectName } = require('../../remote-ui/app.js');

const cloudProject = {
  id: 'cloud-project-1786576204080-ptd1hdefz',
  name: 'agrochemicals-frontend',
  path: 'project-1786576204080-ptd1hdefz',
  _cloud: true,
};

test('addresses a cloud project by its server key, not its display name', () => {
  expect(_cloudProjectName(cloudProject)).toBe('project-1786576204080-ptd1hdefz');
});

test('returns an empty string when there is no project', () => {
  expect(_cloudProjectName(null)).toBe('');
});
