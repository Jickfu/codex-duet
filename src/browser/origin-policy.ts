import { ChatbridgeError } from '../core/errors.js';

export class OriginPolicy {
  private readonly origins: ReadonlySet<string>;
  constructor(origins: readonly string[]) {
    this.origins = new Set(origins.map((origin) => new URL(origin).origin));
  }
  allows(url: string): boolean {
    try {
      return this.origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  }
  assertAllowed(url: string) {
    if (!this.allows(url))
      throw new ChatbridgeError(`Origin is not allowlisted: ${safeOrigin(url)}`, 'ORIGIN_DENIED');
  }
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '<invalid URL>';
  }
}
