export const FIGMA_FILE_KEY = "IUzvz0OdxdqsZxJdALzv6w";

export interface FigmaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  absoluteBoundingBox?: FigmaBox;
  children?: FigmaNode[];
}

export interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
}

export async function fetchFigmaFile(fileKey: string = FIGMA_FILE_KEY): Promise<FigmaFileResponse> {
  const token = process.env.FIGMA_TOKEN?.trim();
  if (!token) {
    console.error(
      "FIGMA_TOKEN is required.\n\n" +
        "1. Log in at https://www.figma.com\n" +
        "2. Open Settings → Security → Personal access tokens\n" +
        "3. Generate a token with file read access\n" +
        "4. Add to .env: FIGMA_TOKEN=figd_...\n"
    );
    process.exit(1);
  }

  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
    headers: { "X-Figma-Token": token },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<FigmaFileResponse>;
}

export function walkNodes(node: FigmaNode, visit: (node: FigmaNode, path: string[]) => void, path: string[] = []): void {
  visit(node, path);
  for (const child of node.children ?? []) {
    walkNodes(child, visit, [...path, child.name]);
  }
}

export function findSections(document: FigmaNode): FigmaNode[] {
  const sections: FigmaNode[] = [];
  walkNodes(document, (node) => {
    if (node.type === "SECTION") sections.push(node);
  });
  return sections;
}

export function sectionMatches(section: FigmaNode, query: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, " ");
  const name = section.name.toLowerCase().replace(/\s+/g, " ");
  return name.includes(q) || q.includes(name);
}

export function boxContains(outer: FigmaBox, inner: FigmaBox): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return (
    cx >= outer.x &&
    cx <= outer.x + outer.width &&
    cy >= outer.y &&
    cy <= outer.y + outer.height
  );
}

const TEXT_TYPES = new Set(["TEXT", "STICKY", "SHAPE_WITH_TEXT", "TABLE_CELL"]);

export function extractTextFromNode(node: FigmaNode): string | null {
  if (node.characters?.trim()) return node.characters.trim();

  if (node.type === "TABLE_CELL" || node.type === "STICKY") {
    for (const child of node.children ?? []) {
      const t = extractTextFromNode(child);
      if (t) return t;
    }
  }

  if (node.type === "TABLE") {
    return null;
  }

  if (TEXT_TYPES.has(node.type)) {
    for (const child of node.children ?? []) {
      const t = extractTextFromNode(child);
      if (t) return t;
    }
  }

  return null;
}

export interface TextCell {
  text: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  nodeType: string;
  nodeName: string;
}

export function collectTextCells(root: FigmaNode, bounds?: FigmaBox): TextCell[] {
  const cells: TextCell[] = [];

  walkNodes(root, (node) => {
    if (node.type === "TABLE") return;

    const text = extractTextFromNode(node);
    const box = node.absoluteBoundingBox;
    if (!text || !box || text.length < 2) return;
    if (bounds && !boxContains(bounds, box)) return;

    cells.push({
      text: text.replace(/\s+/g, " ").trim(),
      x: box.x,
      y: box.y,
      cx: box.x + box.width / 2,
      cy: box.y + box.height / 2,
      nodeType: node.type,
      nodeName: node.name,
    });
  });

  const seen = new Set<string>();
  return cells.filter((c) => {
    const key = `${Math.round(c.cx / 10)}:${Math.round(c.cy / 10)}:${c.text.slice(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exportTableNode(table: FigmaNode): string[][] {
  const cells: { row: number; col: number; text: string }[] = [];

  walkNodes(table, (node) => {
    if (node.type !== "TABLE_CELL") return;
    const box = node.absoluteBoundingBox;
    const text = extractTextFromNode(node);
    if (!text || !box) return;
    cells.push({ row: Math.round(box.y), col: Math.round(box.x), text });
  });

  if (cells.length === 0) return [];

  const rowKeys = [...new Set(cells.map((c) => c.row))].sort((a, b) => a - b);
  const colKeys = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);

  const rowIndex = new Map(rowKeys.map((k, i) => [k, i]));
  const colIndex = new Map(colKeys.map((k, i) => [k, i]));

  const grid: string[][] = Array.from({ length: rowKeys.length }, () =>
    Array(colKeys.length).fill("")
  );

  for (const c of cells) {
    grid[rowIndex.get(c.row)!][colIndex.get(c.col)!] = c.text;
  }

  return grid;
}
