/**
 * Keybinding Utilities - Parse and format keybinding strings
 */

const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
};

function getEventKey(e: KeyboardEvent): string {
  if (e.key === ' ') {
    return 'Space';
  }

  if (e.key === 'Esc') {
    return 'Escape';
  }

  if (e.code in CODE_TO_KEY) {
    return CODE_TO_KEY[e.code];
  }

  if (e.key.length === 1) {
    return e.key.toUpperCase();
  }

  return e.key;
}

function getEventModifiers(e: KeyboardEvent, includeShift: boolean = true): string[] {
  const parts: string[] = [];

  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (includeShift && e.shiftKey) parts.push('Shift');

  return parts;
}

/**
 * Parse a KeyboardEvent into a keybinding string.
 */
export function parseKeyboardEvent(e: KeyboardEvent): string {
  const parts = getEventModifiers(e);
  const key = getEventKey(e);
  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    parts.push(key);
  }

  return parts.join('+');
}

/**
 * Check if a keybinding string matches a KeyboardEvent.
 */
export function matchesKeybinding(binding: string, e: KeyboardEvent): boolean {
  const eventKey = parseKeyboardEvent(e);
  const normalizedBinding = normalizeForComparison(binding);

  if (normalizedBinding === normalizeForComparison(eventKey)) {
    return true;
  }

  // Treat the shifted "+" variant on the "=" key as a match for bindings
  // stored as Cmd+=, which is how zoom-in is represented in the registry.
  if (e.code === 'Equal' && e.shiftKey) {
    const eventWithoutShift = [...getEventModifiers(e, false), getEventKey(e)].join('+');
    return normalizedBinding === normalizeForComparison(eventWithoutShift);
  }

  return false;
}

/**
 * Normalize a keybinding for comparison (lowercase, sorted modifiers).
 */
function normalizeForComparison(key: string): string {
  const parts = key.split('+').map((p) => p.trim().toLowerCase());
  const modifierOrder = ['cmd', 'ctrl', 'alt', 'shift'];
  const modifiers: string[] = [];
  let mainKey = '';

  for (const part of parts) {
    if (modifierOrder.includes(part)) {
      modifiers.push(part);
    } else {
      mainKey = part;
    }
  }

  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));
  return [...modifiers, mainKey].join('+');
}

/**
 * Check if a keybinding has at least one modifier key.
 */
export function hasModifier(binding: string): boolean {
  const modifiers = ['cmd', 'ctrl', 'alt', 'shift'];
  const parts = binding.toLowerCase().split('+');
  return parts.some((p) => modifiers.includes(p));
}

/**
 * Get a human-readable description of a keybinding.
 */
export function describeKeybinding(binding: string): string {
  return binding
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'cmd':
          return 'Command';
        case 'ctrl':
          return 'Control';
        case 'alt':
          return 'Option';
        case 'shift':
          return 'Shift';
        case 'space':
          return 'Space';
        default:
          return part;
      }
    })
    .join(' + ');
}
