import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ExtractorContext, StylesheetDump } from '../types';

interface CssStyleSheetHeader {
  styleSheetId: string;
  frameId?: string;
  sourceURL: string;
  sourceMapURL?: string;
  origin: 'user-agent' | 'author' | 'inspector' | 'injected' | 'regular';
  title: string;
  ownerNode?: number;
  disabled: boolean;
  isInline: boolean;
  isMutable: boolean;
  isConstructed: boolean;
  startLine: number;
  startColumn: number;
  length: number;
}

interface StyleSheetTextResult {
  text: string;
}

export async function extractStylesheets(ctx: ExtractorContext): Promise<StylesheetDump[]> {
  const log = ctx.logger.child('stylesheets');

  // Newer CDP versions don't expose `CSS.getAllStyleSheets`. Collect via the
  // event stream instead: disable+re-enable the CSS domain triggers replay
  // of `CSS.styleSheetAdded` for every currently-loaded sheet.
  const collected: CssStyleSheetHeader[] = [];
  const unsub = ctx.cdp.on('CSS.styleSheetAdded', (params) => {
    const header = (params as { header: CssStyleSheetHeader }).header;
    if (header) collected.push(header);
  });

  try {
    // Try the direct method first (older Chrome / some Electron versions)
    const res = await ctx.cdp.send<{ headers?: CssStyleSheetHeader[] }>('CSS.getAllStyleSheets').catch(() => null);
    if (res?.headers?.length) {
      collected.push(...res.headers);
    } else {
      // Event-based: cycle the CSS domain to replay added events
      await ctx.cdp.send('CSS.disable');
      await ctx.cdp.send('CSS.enable');
      // Give the replay a brief window to arrive
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    unsub();
  }

  // Deduplicate by styleSheetId (some builds emit duplicates)
  const byId = new Map<string, CssStyleSheetHeader>();
  for (const h of collected) byId.set(h.styleSheetId, h);
  const sheets = [...byId.values()];
  log.info(`discovered ${sheets.length} stylesheet header(s)`);

  const out: StylesheetDump[] = [];
  const sheetsDir = join(ctx.outDir, 'stylesheets');
  await mkdir(sheetsDir, { recursive: true });

  for (let i = 0; i < sheets.length; i++) {
    const header = sheets[i];
    const record: StylesheetDump = {
      index: i,
      styleSheetId: header.styleSheetId,
      href: header.sourceURL || '<inline>',
      origin: header.origin,
      title: header.title,
      disabled: header.disabled,
      text: null,
    };

    if (header.origin === 'user-agent') {
      log.info(`skipping user-agent sheet #${i}`);
      out.push(record);
      continue;
    }

    try {
      const res = await ctx.cdp.send<StyleSheetTextResult>('CSS.getStyleSheetText', {
        styleSheetId: header.styleSheetId,
      });
      record.text = res.text;
    } catch (err) {
      record.textError = String(err);
      log.warn(`sheet #${i} text unavailable: ${record.textError}`);
    }

    if (record.text) {
      const hash = createHash('sha1').update(record.text).digest('hex').slice(0, 8);
      const pad = String(i).padStart(2, '0');
      const filename = `${pad}-${hash}.css`;
      const headerComment = [
        '/*',
        ` * source: ${record.href}`,
        ` * origin: ${record.origin}`,
        ` * index:  ${i}`,
        ` * extracted: ${new Date().toISOString()}`,
        ' */',
        '',
      ].join('\n');
      await writeFile(join(sheetsDir, filename), headerComment + record.text, 'utf8');
    }

    out.push(record);
  }

  // Index file summarising what we captured
  const indexSummary = out.map((s) => ({
    index: s.index,
    origin: s.origin,
    href: s.href,
    bytes: s.text?.length ?? 0,
    textError: s.textError ?? null,
  }));
  await writeFile(
    join(sheetsDir, '_index.json'),
    JSON.stringify(indexSummary, null, 2),
    'utf8',
  );

  log.info(`wrote ${out.filter((s) => s.text).length} sheet(s) with text, ${out.filter((s) => s.textError).length} failed`);
  return out;
}
