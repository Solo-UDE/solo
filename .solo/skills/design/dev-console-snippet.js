// =============================================================================
// Solo Design — Codex DevTools Extraction Snippet
// =============================================================================
// Paste this entire file into the DevTools Console of a running Electron app
// (Codex.app or any Electron renderer). It dumps all loaded stylesheets,
// @font-face rules, and :root CSS custom properties into a downloadable JSON
// file named `codex-dump.json`.
//
// Drop the downloaded file into:
//   solo/packages/ui/design-dump/codex/manual/codex-dump.json
//
// Then run the post-processor:
//   cd solo && bun scripts/codex-extract/post-process.ts
//
// The post-processor splits the manual dump into the same layout as the
// automated CDP extraction (stylesheets/*.css, tokens.json, fonts.json).
// =============================================================================

(async () => {
  const start = performance.now();
  console.log('[solo-design] beginning extraction...');

  // ---------------------------------------------------------------------------
  // Stylesheets — text of every loaded stylesheet, with CORS-safe fallback
  // ---------------------------------------------------------------------------
  const stylesheets = [...document.styleSheets].map((sheet, index) => {
    const base = {
      index,
      href: sheet.href || '<inline>',
      media: sheet.media ? [...sheet.media].join(', ') : '',
      disabled: sheet.disabled,
    };
    try {
      const rules = [...sheet.cssRules].map(r => r.cssText).join('\n');
      return { ...base, rules, error: null };
    } catch (err) {
      // CORS-blocked (cross-origin stylesheet without the right headers).
      // Try fetching the href directly — often succeeds when cssRules doesn't.
      return { ...base, rules: null, error: String(err) };
    }
  });

  // Best-effort re-fetch of CORS-blocked sheets
  for (const s of stylesheets) {
    if (s.rules === null && s.href && s.href !== '<inline>') {
      try {
        const res = await fetch(s.href);
        if (res.ok) s.rules = await res.text();
      } catch (_) { /* leave as null */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Fonts — @font-face declarations + loaded FontFace instances
  // ---------------------------------------------------------------------------
  const loadedFonts = [];
  for (const f of document.fonts) {
    loadedFonts.push({
      family: f.family,
      weight: f.weight,
      style: f.style,
      display: f.display,
      stretch: f.stretch,
      unicodeRange: f.unicodeRange,
      status: f.status,
    });
  }

  // ---------------------------------------------------------------------------
  // CSS custom properties at :root and html
  // ---------------------------------------------------------------------------
  function scanCustomProps(el, scope) {
    const style = getComputedStyle(el);
    const out = [];
    for (const prop of style) {
      if (prop.startsWith('--')) {
        out.push({
          name: prop,
          value: style.getPropertyValue(prop).trim(),
          scope,
        });
      }
    }
    return out;
  }

  const customProps = [
    ...scanCustomProps(document.documentElement, ':root'),
    ...scanCustomProps(document.body, 'body'),
  ];

  // Deduplicate by name (root wins over body)
  const seen = new Set();
  const dedupedProps = [];
  for (const p of customProps) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      dedupedProps.push(p);
    }
  }

  // ---------------------------------------------------------------------------
  // Keyframes — regex scan of stylesheet text for @keyframes rules
  // ---------------------------------------------------------------------------
  const keyframesMap = {};
  for (const s of stylesheets) {
    if (!s.rules) continue;
    const re = /@keyframes\s+([\w-]+)\s*{([^}]|{[^}]*})*}/g;
    // Simple pass — for nested braces we fall back to a bracket matcher
    let idx = 0;
    const text = s.rules;
    while ((idx = text.indexOf('@keyframes', idx)) !== -1) {
      const afterKw = idx + '@keyframes'.length;
      const braceStart = text.indexOf('{', afterKw);
      if (braceStart === -1) break;
      const name = text.slice(afterKw, braceStart).trim();
      let depth = 1;
      let i = braceStart + 1;
      while (i < text.length && depth > 0) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') depth--;
        i++;
      }
      keyframesMap[name] = text.slice(idx, i);
      idx = i;
    }
  }

  // ---------------------------------------------------------------------------
  // Meta — what app, what URL, what time
  // ---------------------------------------------------------------------------
  const meta = {
    extractedAt: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    durationMs: Math.round(performance.now() - start),
  };

  // ---------------------------------------------------------------------------
  // Bundle & download
  // ---------------------------------------------------------------------------
  const dump = {
    meta,
    stylesheets,
    fonts: loadedFonts,
    customProperties: dedupedProps,
    keyframes: keyframesMap,
  };

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `codex-dump-${meta.extractedAt.replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`[solo-design] done in ${meta.durationMs}ms`, {
    stylesheets: stylesheets.length,
    stylesheetsWithText: stylesheets.filter(s => s.rules).length,
    fonts: loadedFonts.length,
    customProperties: dedupedProps.length,
    keyframes: Object.keys(keyframesMap).length,
  });
})();
