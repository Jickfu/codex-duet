export interface SendMarker {
  conversationUrl: string;
  outgoingUserMessageId: string;
  previousAssistantMessageId?: string;
}

export interface WaitOptions {
  checkpoint: SendMarker;
  timeoutMs?: number;
}

export interface BrowserConnectOptions {
  conversationUrl?: string;
}

export interface BrowserConversationSelection {
  conversationUrl: string;
}

/** Transport-independent capability boundary consumed by send/wait. */
export interface BrowserAutomationSession {
  connect(options?: BrowserConnectOptions): Promise<BrowserConversationSelection>;
  ensureConversation(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  sendMessage(message: string): Promise<SendMarker>;
  waitForAssistantMessage(options: WaitOptions): Promise<string>;
  close(): Promise<void>;
}
