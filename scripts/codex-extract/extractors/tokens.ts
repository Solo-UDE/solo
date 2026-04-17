import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractorContext, TokenDump } from '../types';

interface RuntimeEvaluateResult {
  result: { type: string; value?: unknown };
  exceptionDetails?: unknown;
}

// Collect CSS custom properties from :root, body, and any element with a
// [style*="--"] declaration (catches component-scoped tokens). We deduplicate
// by name — root wins over descendants.
const TOKEN_SCAN_EXPR = `(() => {
  const seen = new Map();
  function add(scope, el) {
    const cs = getComputedStyle(el);
    for (const prop of cs) {
      if (!prop.startsWith('--')) continue;
      if (seen.has(prop)) continue;
      seen.set(prop, { name: prop, value: cs.getPropertyValue(prop).trim(), scope });
    }
  }
  add(':root', document.documentElement);
  if (document.body) add('body', document.body);
  for (const el of document.querySelectorAll('[style*="--"]')) {
    const sel = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(/\\s+/).join('.') : '');
    add(sel.slice(0, 200), el);
  }
  return JSON.stringify([...seen.values()]);
})()`;

export async function extractTokens(ctx: ExtractorContext): Promise<TokenDump[]> {
  const log = ctx.logger.child('tokens');

  const res = await ctx.cdp.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression: TOKEN_SCAN_EXPR,
    returnByValue: true,
    awaitPromise: false,
  });

  let tokens: TokenDump[] = [];
  if (res.exceptionDetails) {
    log.warn('Runtime.evaluate exception scanning custom properties', res.exceptionDetails);
  } else if (typeof res.result.value === 'string') {
    try { tokens = JSON.parse(res.result.value); }
    catch (err) { log.warn('failed to parse tokens JSON', err); }
  }

  await writeFile(join(ctx.outDir, 'tokens.json'), JSON.stringify(tokens, null, 2), 'utf8');
  log.info(`wrote ${tokens.length} token record(s)`);
  return tokens;
}
