import type { ChatGPTWebAdapter, WaitOptions } from './chatgpt-adapter.js';
export class ResponseWaiter {
  constructor(private readonly adapter: ChatGPTWebAdapter) {}
  wait(options?: WaitOptions) {
    return this.adapter.waitForAssistantMessage(options);
  }
}
