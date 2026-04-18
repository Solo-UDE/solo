import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Archetype, ComputedStyleDump, ExtractorContext } from '../types';

interface GetDocumentResult {
  root: { nodeId: number; backendNodeId: number };
}

interface QuerySelectorResult {
  nodeId: number;
}

interface CssProperty {
  name: string;
  value: string;
}

interface ComputedStyleForNodeResult {
  computedStyle: CssProperty[];
}

const PROPERTIES_OF_INTEREST = new Set([
  // typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-feature-settings',
  'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-decoration',
  // color + background
  'color', 'background-color', 'background-image', 'opacity',
  // border + outline + ring
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'box-shadow',
  // spacing + sizing
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // layout
  'display', 'position', 'flex-direction', 'align-items', 'justify-content', 'gap',
  'grid-template-columns', 'grid-template-rows',
  // visual
  'cursor', 'transform', 'transition', 'animation', 'backdrop-filter', 'filter',
  'overflow', 'overflow-x', 'overflow-y',
]);

function prune(style: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(style)) {
    if (PROPERTIES_OF_INTEREST.has(k) || k.startsWith('--')) {
      out[k] = v;
    }
  }
  return out;
}

async function findNode(
  ctx: ExtractorContext,
  rootNodeId: number,
  selectors: string[],
): Promise<{ nodeId: number; selector: string } | null> {
  for (const sel of selectors) {
    try {
      const res = await ctx.cdp.send<QuerySelectorResult>('DOM.querySelector', {
        nodeId: rootNodeId,
        selector: sel,
      });
      if (res.nodeId) return { nodeId: res.nodeId, selector: sel };
    } catch {
      // selector invalid or not found — try next
    }
  }
  return null;
}

async function captureState(
  ctx: ExtractorContext,
  nodeId: number,
  state: 'default' | 'hover' | 'focus' | 'active' | 'disabled',
): Promise<Record<string, string> | null> {
  if (state !== 'default') {
    const pseudoMap: Record<typeof state, string[]> = {
      default: [],
      hover: ['hover'],
      focus: ['focus', 'focus-visible'],
      active: ['active'],
      disabled: [],
    };
    try {
      await ctx.cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcePseudoClasses: pseudoMap[state],
      });
    } catch (err) {
      ctx.logger.warn(`forcePseudoState ${state} failed`, err);
    }
  }

  try {
    const res = await ctx.cdp.send<ComputedStyleForNodeResult>('CSS.getComputedStyleForNode', {
      nodeId,
    });
    const map: Record<string, string> = {};
    for (const p of res.computedStyle) map[p.name] = p.value;
    return prune(map);
  } catch (err) {
    ctx.logger.warn(`getComputedStyleForNode failed`, err);
    return null;
  } finally {
    if (state !== 'default') {
      try {
        await ctx.cdp.send('CSS.forcePseudoState', { nodeId, forcePseudoClasses: [] });
      } catch { /* ignore cleanup error */ }
    }
  }
}

export async function extractComputedStyles(ctx: ExtractorContext): Promise<ComputedStyleDump[]> {
  const log = ctx.logger.child('computed');

  const doc = await ctx.cdp.send<GetDocumentResult>('DOM.getDocument', { depth: -1 });
  const rootNodeId = doc.root.nodeId;

  const out: ComputedStyleDump[] = [];
  for (const arch of ctx.archetypes) {
    const match = await findNode(ctx, rootNodeId, arch.selectors);
    if (!match) {
      log.warn(`archetype '${arch.name}': no selector matched`);
      out.push({
        archetype: arch.name,
        matchedSelector: null,
        states: {},
        missing: true,
      });
      continue;
    }

    const states = arch.states ?? ['default'];
    const record: ComputedStyleDump = {
      archetype: arch.name,
      matchedSelector: match.selector,
      states: {},
      missing: false,
    };
    for (const state of states) {
      record.states[state] = await captureState(ctx, match.nodeId, state);
    }
    out.push(record);
    log.info(`archetype '${arch.name}': matched ${match.selector} (${Object.keys(record.states).length} state(s))`);
  }

  await writeFile(join(ctx.outDir, 'computed-styles.json'), JSON.stringify(out, null, 2), 'utf8');
  log.info(`wrote ${out.length} archetype record(s); ${out.filter((r) => r.missing).length} missing`);
  return out;
}
