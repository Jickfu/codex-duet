import type { WaitOptions } from './browser-automation-session.js';
import type { ChatGPTWebAdapter } from './chatgpt-adapter.js';
export class ResponseWaiter {
  constructor(private readonly adapter: ChatGPTWebAdapter) {}
  wait(options: WaitOptions) {
    return this.adapter.waitForAssistantMessage(options);
  }
}
