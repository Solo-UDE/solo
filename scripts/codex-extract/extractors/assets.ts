import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetDump, ExtractorContext } from '../types';

interface RuntimeEvaluateResult {
  result: { type: string; value?: unknown };
  exceptionDetails?: unknown;
}

const ASSET_SCAN_EXPR = `(() => {
  const assets = new Map();
  function add(url, origin) {
    if (!url || url.startsWith('data:')) return;
    if (assets.has(url)) return;
    const ext = (url.split('?')[0].split('#')[0].match(/\\.([a-z0-9]+)$/i) ?? [])[1] ?? '';
    const kind =
      /woff|woff2|ttf|otf/i.test(ext) ? 'font' :
      /svg/i.test(ext) ? 'svg' :
      /png|jpg|jpeg|webp|gif|avif/i.test(ext) ? 'image' :
      'unknown';
    assets.set(url, { url, origin, kind });
  }
  for (const img of document.querySelectorAll('img[src]')) add(img.src, 'img');
  for (const use of document.querySelectorAll('use')) {
    const href = use.getAttribute('xlink:href') || use.getAttribute('href') || '';
    add(href, 'svg-use');
  }
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const urls = bg.match(/url\\((['"]?)([^'"\\)]+)\\1\\)/g) ?? [];
    for (const u of urls) {
      const inner = u.match(/url\\((['"]?)([^'"\\)]+)\\1\\)/);
      if (inner) add(inner[2], 'background-image');
    }
  }
  return JSON.stringify([...assets.values()]);
})()`;

// Downloads under this byte size are copied into assets/. Everything else
// gets a manifest entry only.
const DOWNLOAD_LIMIT = 100 * 1024;

export async function extractAssets(ctx: ExtractorContext): Promise<AssetDump[]> {
  const log = ctx.logger.child('assets');

  const res = await ctx.cdp.send<RuntimeEvaluateResult>('Runtime.evaluate', {
    expression: ASSET_SCAN_EXPR,
    returnByValue: true,
    awaitPromise: false,
  });

  let raw: AssetDump[] = [];
  if (res.exceptionDetails) {
    log.warn('Runtime.evaluate exception scanning assets', res.exceptionDetails);
  } else if (typeof res.result.value === 'string') {
    try { raw = JSON.parse(res.result.value); }
    catch (err) { log.warn('failed to parse assets JSON', err); }
  }

  const assetsDir = join(ctx.outDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const out: AssetDump[] = [];
  for (const asset of raw) {
    const enriched: AssetDump = { ...asset, downloaded: false };
    try {
      const response = await fetch(asset.url);
      const length = Number(response.headers.get('content-length') ?? 0);
      enriched.sizeBytes = length || undefined;
      if (length && length < DOWNLOAD_LIMIT) {
        const ab = await response.arrayBuffer();
        const safe = asset.url.replace(/[^a-z0-9.-]/gi, '_').slice(-120);
        const localPath = join(assetsDir, safe);
        await writeFile(localPath, Buffer.from(ab));
        enriched.downloaded = true;
        enriched.localPath = localPath;
      }
    } catch (err) {
      log.warn(`asset fetch failed ${asset.url}`, err);
    }
    out.push(enriched);
  }

  await writeFile(join(ctx.outDir, 'assets.json'), JSON.stringify(out, null, 2), 'utf8');
  log.info(`wrote ${out.length} asset record(s), ${out.filter((a) => a.downloaded).length} downloaded`);
  return out;
}
