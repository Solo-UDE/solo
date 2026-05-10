/*
 * Solo virtualization scroll-container audit.
 *
 * Paste this into the Tauri webview DevTools console after visiting a screen.
 * It reports scrollable containers that are not themselves virtualized and do
 * not contain a virtualized list. Use it while navigating through high and
 * medium priority areas to catch leftover non-windowed scroll regions.
 */
(() => {
  const ignoreSelector = [
    'textarea',
    'select',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[data-radix-select-viewport]',
    '[data-radix-scroll-area-viewport]',
  ].join(',');

  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const isScrollable = (el) => {
    const style = getComputedStyle(el);
    const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
    const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 2;
    return x || y;
  };

  const describe = (el) => {
    const classes = Array.from(el.classList).slice(0, 5).join('.');
    return [
      el.tagName.toLowerCase(),
      el.id ? `#${el.id}` : '',
      classes ? `.${classes}` : '',
    ].join('');
  };

  const suspects = Array.from(document.querySelectorAll('body *'))
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => isVisible(el) && isScrollable(el))
    .filter((el) => !el.matches(ignoreSelector))
    .filter((el) => !el.closest('[data-virtualized-list]'))
    .filter((el) => !el.querySelector('[data-virtualized-list]'))
    .map((el) => ({
      element: describe(el),
      children: el.childElementCount,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      textLines: (el.textContent || '').split('\n').length,
    }))
    .filter((row) => row.children > 20 || row.textLines > 80 || row.scrollHeight > row.clientHeight * 3);

  console.group('Solo non-virtualized scroll-container audit');
  if (suspects.length === 0) {
    console.log('PASS: no suspicious non-virtualized scroll containers found on this screen.');
  } else {
    console.table(suspects);
  }
  console.groupEnd();

  window.__soloScrollContainerAudit = { suspects };
})();
