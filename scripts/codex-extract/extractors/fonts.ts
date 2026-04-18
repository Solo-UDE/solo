import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtractorContext, FontDump } from '../types';

interface RuntimeEvaluateResult {
  result: {
    type: string;
    value?: unknown;
  };
  exceptionDetails?: unknown;
}

const FONT_SCAN_EXPR = `JSON.stringify([...document.fonts].map(f => ({
  family: f.family,
  weight: String(f.weight),
  style: f.style,
  display: f.display,
  stretch: f.stretch,
  unicodeRange: f.unicodeRange,
  status: f.status,
})))`;

export async function extractFonts(ctx: ExtractorContext): Promise<FontDump[]> {
  const log = ctx.logger.child('fonts');

  const res = await ctx.cdp.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression: FONT_SCAN_EXPR,
    returnByValue: true,
    awaitPromise: false,
  });

  let fonts: FontDump[] = [];
  if (res.exceptionDetails) {
    log.warn('Runtime.evaluate exception scanning document.fonts', res.exceptionDetails);
  } else if (typeof res.result.value === 'string') {
    try { fonts = JSON.parse(res.result.value); }
    catch (err) { log.warn('failed to parse fonts JSON', err); }
  }

  await writeFile(join(ctx.outDir, 'fonts.json'), JSON.stringify(fonts, null, 2), 'utf8');
  log.info(`wrote ${fonts.length} font record(s)`);
  return fonts;
}
