import { describe, expect, it } from 'bun:test';
import {
  buildEffectiveKeybindings,
  getEffectiveKeybinding,
} from './registry';
import {
  matchesKeybinding,
  parseKeyboardEvent,
} from './utils';

function keyboardEvent(
  init: Partial<Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>>
): KeyboardEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent;
}

describe('keybinding utilities', () => {
  it('normalizes shifted slash to Cmd+Shift+/', () => {
    const event = keyboardEvent({
      key: '?',
      code: 'Slash',
      metaKey: true,
      shiftKey: true,
    });

    expect(parseKeyboardEvent(event)).toBe('Cmd+Shift+/');
    expect(matchesKeybinding('Cmd+Shift+/', event)).toBe(true);
  });

  it('normalizes shifted bracket keys to their unshifted binding tokens', () => {
    const event = keyboardEvent({
      key: '}',
      code: 'BracketRight',
      metaKey: true,
      shiftKey: true,
    });

    expect(parseKeyboardEvent(event)).toBe('Cmd+Shift+]');
    expect(matchesKeybinding('Cmd+Shift+]', event)).toBe(true);
  });

  it('normalizes shifted backquote for terminal session shortcuts', () => {
    const event = keyboardEvent({
      key: '~',
      code: 'Backquote',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(parseKeyboardEvent(event)).toBe('Ctrl+Shift+`');
    expect(matchesKeybinding('Ctrl+Shift+`', event)).toBe(true);
  });

  it('lets Cmd+= bindings match the shifted plus key on the same physical key', () => {
    const event = keyboardEvent({
      key: '+',
      code: 'Equal',
      metaKey: true,
      shiftKey: true,
    });

    expect(parseKeyboardEvent(event)).toBe('Cmd+Shift+=');
    expect(matchesKeybinding('Cmd+=', event)).toBe(true);
  });

  it('resolves effective keybindings with custom overrides', () => {
    const customKeybindings = {
      'nav.nextWorkspace': 'Ctrl+]',
    };

    expect(getEffectiveKeybinding('nav.nextWorkspace', customKeybindings)).toBe('Ctrl+]');

    const effective = buildEffectiveKeybindings(customKeybindings);
    expect(effective['nav.nextWorkspace']).toBe('Ctrl+]');
    expect(effective['nav.focusWorktree1']).toBe('Ctrl+1');
  });
});
