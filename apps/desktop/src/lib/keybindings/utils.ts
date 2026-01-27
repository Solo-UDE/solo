/**
 * Keybinding Utilities - Parse and format keybinding strings
 */

/**
 * Parse a KeyboardEvent into a keybinding string.
 */
export function parseKeyboardEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    if (key === ' ') {
      parts.push('Space');
    } else if (key.length === 1) {
      parts.push(key.toUpperCase());
    } else {
      parts.push(key);
    }
  }

  return parts.join('+');
}

/**
 * Check if a keybinding string matches a KeyboardEvent.
 */
export function matchesKeybinding(binding: string, e: KeyboardEvent): boolean {
  const eventKey = parseKeyboardEvent(e);
  return normalizeForComparison(binding) === normalizeForComparison(eventKey);
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
