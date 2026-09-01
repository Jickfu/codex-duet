export const browserKinds = ['auto', 'chrome', 'msedge', 'bundled'] as const;
export type BrowserKind = (typeof browserKinds)[number];
export const transportKinds = ['auto', 'extension', 'cdp'] as const;
export type TransportKind = (typeof transportKinds)[number];
export type ConnectionMode =
  'existing-extension' | 'existing-channel-cdp' | 'raw-cdp' | 'managed-installed' | 'bundled';

export interface RuntimeSelection {
  mode: ConnectionMode;
  browser: Exclude<BrowserKind, 'auto'>;
  transport: 'cli' | 'library';
  endpoint?: string | undefined;
  session?: string | undefined;
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
