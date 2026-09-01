import type { BrowserContext } from 'playwright';
export interface BrowserConnection {
  connect(): Promise<BrowserContext>;
  close(): Promise<void>;
}
