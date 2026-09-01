import type { WaitOptions } from './chatgpt-adapter.js';

/** Transport-independent capability boundary consumed by send/wait. */
export interface BrowserAutomationSession {
  connect(): Promise<void>;
  ensureConversation(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  sendMessage(message: string): Promise<number>;
  waitForAssistantMessage(options?: WaitOptions): Promise<string>;
  close(): Promise<void>;
}
