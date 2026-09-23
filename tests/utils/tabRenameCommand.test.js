const { parseRenameCommand } = require('../../src/renderer/utils/tabRenameCommand');

describe('parseRenameCommand', () => {
  test('reads the name after /rename', () => {
    expect(parseRenameCommand('/rename Release prep')).toEqual({ name: 'Release prep' });
  });

  test('accepts the /name alias', () => {
    expect(parseRenameCommand('/name Release prep')).toEqual({ name: 'Release prep' });
  });

  test('trims the command and the name', () => {
    expect(parseRenameCommand('  /rename   Release prep  ')).toEqual({ name: 'Release prep' });
  });

  test('returns an empty name for a bare /rename', () => {
    expect(parseRenameCommand('/rename')).toEqual({ name: '' });
    expect(parseRenameCommand('/rename   ')).toEqual({ name: '' });
  });

  test.each([
    ['a longer command', '/renamed foo'],
    ['a missing slash', 'rename foo'],
    ['another command', '/compact'],
    ['a regular prompt', 'please rename this function'],
    ['empty input', ''],
    ['no input', undefined],
  ])('ignores %s', (_label, input) => {
    expect(parseRenameCommand(input)).toBeNull();
  });
});
