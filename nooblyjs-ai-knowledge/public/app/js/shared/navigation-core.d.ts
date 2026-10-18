/**
 * Type declarations for navigation-core.js (shared wiki navigation logic).
 * Hand-maintained alongside the .js so TypeScript consumers (Teams) get types
 * without enabling allowJs. Keep in sync with navigation-core.js.
 */

export interface NavNode {
  name: string;
  path: string;
  type: 'folder' | 'document';
  title?: string;
  spaceName?: string;
  children?: NavNode[];
  size?: number;
  modified?: string;
}

export interface ChainSegment {
  label: string;
  path: string;
}

export interface DrillRow {
  kind: 'folder' | 'file';
  node: NavNode;
  level: number;
  isGroup: boolean;
  hasChildren: boolean;
  /** Collapsed single-child run this row stands for; null when not collapsed. */
  chain: ChainSegment[] | null;
}

export interface CollapsedChain {
  terminal: NavNode;
  segments: ChainSegment[];
  collapsed: boolean;
}

export interface DrillOptions {
  collapseChains?: boolean;
  maxSegments?: number;
}

export interface DrillResult {
  drillPath: string;
  headerLabel: string;
  headerIsRoot: boolean;
  parentPath: string;
  parentLabel: string | null;
  rows: DrillRow[];
  isEmpty: boolean;
}

export interface BreadcrumbSegment {
  label: string;
  path: string;
  isRoot: boolean;
  isLast: boolean;
  isLink: boolean;
}

export interface FolderOverviewItem extends NavNode {
  childCount?: number;
}

export interface FolderOverview {
  title: string;
  path: string;
  spaceName: string;
  stats: { files: number; folders: number };
  folders: FolderOverviewItem[];
  files: FolderOverviewItem[];
}

export interface TreeCacheEntry {
  tree: NavNode[];
  etag: string | null;
}

export interface TreeCache {
  read(spaceId: string): TreeCacheEntry | null;
  write(spaceId: string, tree: NavNode[], etag: string | null): void;
  invalidate(spaceId: string): void;
}

export interface TreeCacheOptions {
  storage?: Storage | null;
  maxSpaces?: number;
  keyPrefix?: string;
  indexKey?: string;
}

export function normalizeDrillPath(path: string | null | undefined): string;
export function isVisibleNode(node: NavNode | null | undefined): boolean;
export function findNodeInTree(nodes: NavNode[] | null | undefined, targetPath: string): NavNode | null;
export function sortVisibleChildren(children: NavNode[] | null | undefined): { folders: NavNode[]; files: NavNode[] };
export function getDrillChildren(tree: NavNode[] | null | undefined, normalizedPath: string): { children: NavNode[]; exists: boolean };
export function hasVisibleChildren(node: NavNode): boolean;
export const MAX_CHAIN_SEGMENTS: number;
export function isPassThroughRung(node: NavNode | null | undefined): boolean;
export function collapseChain(node: NavNode, options?: { maxSegments?: number }): CollapsedChain;
export function collapseAncestor(tree: NavNode[] | null | undefined, parentPath: string): string;
export function resolveDrill(tree: NavNode[] | null | undefined, spaceName: string, path?: string, options?: DrillOptions): DrillResult;
export function buildBreadcrumbSegments(spaceName: string, folderPath: string): BreadcrumbSegment[];
export function buildFolderOverview(nodes: NavNode[] | null | undefined, folderPath: string, spaceName: string): FolderOverview | null;
export function createTreeCache(options?: TreeCacheOptions): TreeCache;
