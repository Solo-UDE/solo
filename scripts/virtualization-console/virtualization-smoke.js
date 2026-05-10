/*
 * Solo virtualization smoke test.
 *
 * Paste this into the Tauri webview DevTools console after opening the app
 * screen you want to validate. It inspects every mounted element with
 * data-virtualized-list, scrolls it, and reports whether it is actually
 * windowing rows instead of rendering the whole dataset.
 */
(async () => {
  const expectedSurfaces = [
    { id: 'agent-message-feed', priority: 'high' },
    { id: 'file-tree', priority: 'high' },
    { id: 'agent-session-list', priority: 'high' },
    { id: 'session-thread-list', priority: 'high' },
    { id: 'source-control-staged-files', priority: 'high' },
    { id: 'source-control-unstaged-files', priority: 'high' },
    { id: 'worktree-changes-staged-files', priority: 'high' },
    { id: 'worktree-changes-unstaged-files', priority: 'high' },
    { id: 'worktree-panel-list', priority: 'high' },
    { id: 'worktree-setup-output', priority: 'high' },
    { id: 'branch-diff-files', priority: 'high' },
    { id: 'worktree-diff-entries', priority: 'high' },
    { id: 'file-diff-lines', priority: 'high' },
    { id: 'file-viewer-lines', priority: 'high' },
    { id: 'symbol-outline', priority: 'high' },
    { id: 'tab-switcher-results', priority: 'high' },
    { id: 'tab-overflow-menu', priority: 'high' },
    { id: 'editor-tabs', priority: 'high' },
    { id: 'sidebar-terminal-tabs', priority: 'high' },
    { id: 'vault-entry-list', priority: 'high' },
    { id: 'vault-search-results', priority: 'high' },
    { id: 'vault-unsorted-tray', priority: 'high' },
    { id: 'task-list-view', priority: 'high' },
    { prefix: 'task-kanban-column-', priority: 'high' },
    { id: 'task-runs-tab', priority: 'high' },
    { id: 'marketplace-results', priority: 'high' },
    { id: 'repo-list', priority: 'medium' },
    { id: 'repo-rail', priority: 'medium' },
    { id: 'branch-picker-branches', priority: 'medium' },
    { id: 'workspace-switcher-recents', priority: 'medium' },
    { id: 'mention-dropdown-results', priority: 'medium' },
    { id: 'slash-command-dropdown', priority: 'medium' },
    { id: 'cycle-selector-options', priority: 'medium' },
    { id: 'project-selector-options', priority: 'medium' },
    { id: 'label-selector-options', priority: 'medium' },
    { id: 'settings-shortcuts', priority: 'medium' },
    { id: 'keyboard-shortcuts-overlay', priority: 'medium' },
    { prefix: 'settings-skills-', priority: 'medium' },
    { id: 'settings-installed-plugins', priority: 'medium' },
    { id: 'settings-adapter-plugins', priority: 'medium' },
    { id: 'voice-history', priority: 'medium' },
    { id: 'leaderboard-entries', priority: 'medium' },
    { id: 'sidebar-plugins-list', priority: 'medium' },
    { id: 'marketplace-detail-files', priority: 'medium' },
    { id: 'marketplace-primary-file', priority: 'medium' },
    { id: 'forked-skills', priority: 'medium' },
    { prefix: 'installed-skills-', priority: 'medium' },
    { id: 'skill-suggestion-files', priority: 'medium' },
    { id: 'task-subtasks', priority: 'medium' },
    { prefix: 'tool-output-', priority: 'medium' },
    { prefix: 'search-tool-results-', priority: 'medium' },
    { id: 'legacy-glob-tool-files', priority: 'medium' },
    { id: 'legacy-grep-tool-results', priority: 'medium' },
    { id: 'legacy-write-tool-lines', priority: 'medium' },
    { id: 'legacy-edit-tool-lines', priority: 'medium' },
    { id: 'legacy-web-search-output', priority: 'medium' },
    { id: 'legacy-web-fetch-output', priority: 'medium' },
    { id: 'legacy-task-tool-output', priority: 'medium' },
    { id: 'legacy-todo-tool-items', priority: 'medium' },
  ];

  const sleepFrames = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const nameOf = (el) => el.getAttribute('data-virtualized-list') || '(unnamed)';
  const numberAttr = (el, name) => Number(el.getAttribute(name) || '0');
  const rowIndices = (el) =>
    Array.from(el.querySelectorAll('[data-virtual-row][data-index]'))
      .map((row) => Number(row.getAttribute('data-index')))
      .filter(Number.isFinite);

  const mounted = Array.from(document.querySelectorAll('[data-virtualized-list]'));
  const mountedNames = mounted.map(nameOf);

  const surfaceMatches = (spec, name) =>
    spec.id ? name === spec.id : typeof spec.prefix === 'string' && name.startsWith(spec.prefix);

  const expectedReport = expectedSurfaces.map((spec) => ({
    surface: spec.id || `${spec.prefix}*`,
    priority: spec.priority,
    mounted: mountedNames.some((name) => surfaceMatches(spec, name)),
  }));

  const listReports = [];

  for (const el of mounted) {
    const surface = nameOf(el);
    const totalBefore = numberAttr(el, 'data-total-items');
    const renderedBefore = numberAttr(el, 'data-rendered-items');
    const beforeIndices = rowIndices(el);
    const startTop = el.scrollTop;
    const startLeft = el.scrollLeft;
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const canScroll = maxTop > 2 || maxLeft > 2;

    if (canScroll) {
      el.scrollTo({ top: maxTop, left: maxLeft, behavior: 'auto' });
      await sleepFrames();
    }

    const totalAfter = numberAttr(el, 'data-total-items');
    const renderedAfter = numberAttr(el, 'data-rendered-items');
    const afterIndices = rowIndices(el);
    const moved = el.scrollTop !== startTop || el.scrollLeft !== startLeft;
    const rowWindowMoved =
      beforeIndices.length > 0 &&
      afterIndices.length > 0 &&
      beforeIndices.join(',') !== afterIndices.join(',');
    const total = Math.max(totalBefore, totalAfter);
    const rendered = Math.max(renderedBefore, renderedAfter);
    const isWindowed = total === 0 || rendered < total || total <= 30;
    const pass = isWindowed && (!canScroll || moved || rowWindowMoved || total <= 30);

    listReports.push({
      surface,
      total,
      rendered,
      scrollable: canScroll,
      moved,
      rowWindowMoved,
      status: pass ? 'PASS' : 'CHECK',
    });

    if (canScroll) {
      el.scrollTo({ top: startTop, left: startLeft, behavior: 'auto' });
    }
  }

  const summary = {
    mountedVirtualizedLists: listReports.length,
    mountedExpectedSurfaces: expectedReport.filter((row) => row.mounted).length,
    missingExpectedSurfaces: expectedReport.filter((row) => !row.mounted).length,
    checksNeedingAttention: listReports.filter((row) => row.status !== 'PASS').length,
  };

  console.group('Solo virtualization smoke');
  console.table(listReports);
  console.table(expectedReport);
  console.log(summary);
  console.groupEnd();

  window.__soloVirtualizationSmoke = { summary, listReports, expectedReport };
})();
