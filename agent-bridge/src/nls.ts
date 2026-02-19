/**
 * Simple localization utility for agent-bridge
 * Replaces VS Code's nls module with simple string passthrough
 */

/**
 * Localize a string (for agent-bridge, we just return the message as-is)
 * @param key - The localization key (unused in simple implementation)
 * @param message - The message to return
 * @returns The message string
 */
export function localize(_key: string, message: string): string {
  return message;
}
