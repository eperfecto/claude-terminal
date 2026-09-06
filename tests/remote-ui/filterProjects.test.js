/** @jest-environment jsdom */
/**
 * Filtering the project list.
 *
 * With 100+ cloud projects the list is unusable without a filter. Matching is a
 * plain case-insensitive substring: cloud project names come from directory
 * names on the server, which are restricted to [A-Za-z0-9._-], so there are no
 * accents or spaces to normalise.
 *
 * While a query is active the result is FLAT — cloud projects carry no folders
 * (_fetchCloudProjects sets state.folders = []), and filtering inside a
 * hierarchy would render folders whose children were all filtered out.
 */

const { _filterProjects } = require('../../remote-ui/app.js');

const P = [
  { id: '1', name: 'agrochemicals-service' },
  { id: '2', name: 'agrochemicals-frontend' },
  { id: '3', name: 'dashboard-frontend' },
  { id: '4', name: 'Harvest-Service' },
];

const names = list => list.map(p => p.name);

test('an empty query returns everything, untouched', () => {
  expect(_filterProjects(P, '')).toBe(P);
  expect(_filterProjects(P, '   ')).toBe(P);
  expect(_filterProjects(P, null)).toBe(P);
});

test('matches anywhere in the name, not just the start', () => {
  expect(names(_filterProjects(P, 'frontend')))
    .toEqual(['agrochemicals-frontend', 'dashboard-frontend']);
});

test('ignores case on both sides', () => {
  expect(names(_filterProjects(P, 'HARVEST'))).toEqual(['Harvest-Service']);
  expect(names(_filterProjects(P, 'service')))
    .toEqual(['agrochemicals-service', 'Harvest-Service']);
});

test('ignores surrounding whitespace in the query', () => {
  expect(names(_filterProjects(P, '  dashboard  '))).toEqual(['dashboard-frontend']);
});

test('returns an empty list when nothing matches', () => {
  expect(_filterProjects(P, 'zzz')).toEqual([]);
});

test('survives a project with no name', () => {
  expect(() => _filterProjects([{ id: 'x' }], 'a')).not.toThrow();
  expect(_filterProjects([{ id: 'x' }], 'a')).toEqual([]);
});
