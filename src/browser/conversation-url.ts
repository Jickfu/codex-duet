import { ChatbridgeError } from '../core/errors.js';
import { OriginPolicy } from './origin-policy.js';

export class ConversationUrlPolicy {
  private readonly origins: OriginPolicy;

  constructor(allowedOrigins: readonly string[]) {
    this.origins = new OriginPolicy(allowedOrigins);
  }

  canonicalize(value: string): string {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new ChatbridgeError('Conversation URL is invalid', 'INVALID_CONVERSATION_URL');
    }
    if (parsed.username || parsed.password)
      throw new ChatbridgeError(
        'Conversation URL must not contain credentials',
        'INVALID_CONVERSATION_URL',
      );
    parsed.hash = '';
    this.origins.assertAllowed(parsed.href);
    return parsed.href;
  }

  isStableConversationUrl(value: string): boolean {
    try {
      this.canonicalizeStable(value);
      return true;
    } catch {
      return false;
    }
  }

  canonicalizeStable(value: string): string {
    const canonical = this.canonicalize(value);
    const parsed = new URL(canonical);
    const segments = parsed.pathname.split('/').filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
      const identity = segments[index + 1]!;
      if (segments[index] === 'c' && identity.length <= 128 && /^[A-Za-z0-9_-]+$/.test(identity))
        return canonical;
    }
    throw new ChatbridgeError(
      'Conversation URL must contain a concrete conversation identity',
      'CHATGPT_CONVERSATION_IDENTITY_REQUIRED',
    );
  }
}
