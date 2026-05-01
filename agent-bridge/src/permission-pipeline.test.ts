import { describe, expect, test } from 'bun:test';

import { checkPermission, defaultTier, type PermissionsConfig } from './permission-pipeline.js';

function cfg(
  allow: string[] = [],
  deny: string[] = [],
  ask: string[] = []
): PermissionsConfig {
  return {
    defaultMode: null,
    allow,
    deny,
    ask,
    additionalDirectories: [],
    disableAcceptMode: false,
  };
}

describe('permission pipeline', () => {
  test('auto-allows read-only tools and skills MCP reads', () => {
    expect(
      checkPermission('Read', { file_path: '/tmp/file.txt' }, 'default', cfg()).behavior
    ).toBe('allow');
    expect(defaultTier('mcp__solo_skills__skill_list')).toBe('read');
    expect(
      checkPermission('mcp__solo_skills__skill_read', { name: 'ui' }, 'default', cfg()).behavior
    ).toBe('allow');
  });

  test('Task is permissioned instead of safe by default', () => {
    expect(checkPermission('Task', { prompt: 'spawn subagent' }, 'default', cfg()).behavior).toBe(
      'ask'
    );
  });

  test('accept mode auto-approves file edits but not Bash', () => {
    expect(
      checkPermission('Write', { file_path: '/tmp/file.txt' }, 'accept', cfg()).behavior
    ).toBe('allow');
    expect(checkPermission('Bash', { command: 'git status' }, 'accept', cfg()).behavior).toBe(
      'ask'
    );
  });

  test('Bash allow prefixes can approve safe commands', () => {
    expect(
      checkPermission('Bash', { command: 'git status' }, 'default', cfg(['Bash(git *)'])).behavior
    ).toBe('allow');
  });

  test('built-in dangerous Bash denies before allow rules', () => {
    expect(
      checkPermission('Bash', { command: 'git reset --hard HEAD' }, 'default', cfg(['Bash(git *)']))
        .behavior
    ).toBe('deny');
  });

  test('ask rules override accept mode', () => {
    expect(
      checkPermission(
        'Bash',
        { command: 'git push --force origin main' },
        'accept',
        cfg([], [], ['Bash(git push --force*)'])
      ).behavior
    ).toBe('ask');
  });
});
