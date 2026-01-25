/**
 * Utility function for conditionally joining classNames
 * A lightweight alternative to clsx/classnames
 */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}
