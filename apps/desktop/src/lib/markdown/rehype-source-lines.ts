/**
 * Rehype plugin that annotates block-level elements with source line numbers.
 * Adds data-source-line and data-source-end-line attributes from the hast
 * position data preserved by remark-rehype, enabling precise preview-to-editor
 * sync without fragile text matching.
 */

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'table', 'tr', 'td', 'th',
  'pre', 'ul', 'ol', 'hr', 'div', 'dl', 'dt', 'dd',
]);

function visit(node: HastNode) {
  if (
    node.type === 'element' &&
    node.tagName &&
    BLOCK_TAGS.has(node.tagName) &&
    node.position
  ) {
    if (!node.properties) node.properties = {};
    node.properties['data-source-line'] = node.position.start.line;
    node.properties['data-source-end-line'] = node.position.end.line;
  }

  if (node.children) {
    for (const child of node.children) {
      visit(child);
    }
  }
}

export function rehypeSourceLines() {
  return (tree: HastNode) => {
    visit(tree);
  };
}
