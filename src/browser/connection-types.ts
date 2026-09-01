export const browserKinds = ['auto', 'chrome', 'msedge', 'bundled'] as const;
export type BrowserKind = (typeof browserKinds)[number];
export const transportKinds = ['auto', 'extension', 'cdp'] as const;
export type TransportKind = (typeof transportKinds)[number];
export type ConnectionMode = 'existing-cdp' | 'managed-installed' | 'bundled';

export interface RuntimeSelection {
  mode: ConnectionMode;
  browser: Exclude<BrowserKind, 'auto'>;
  endpoint: string;
  attachedAt: string;
}

export interface ConnectionCandidate {
  mode: ConnectionMode;
  browser: Exclude<BrowserKind, 'auto'>;
  available: boolean;
  endpoint: string;
}

export function selectConnection(candidates: readonly ConnectionCandidate[]): ConnectionCandidate {
  const selected = candidates.find((candidate) => candidate.available);
  if (!selected) throw new Error('No attachable or installed supported browser is available');
  return selected;
}
