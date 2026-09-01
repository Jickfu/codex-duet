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
}
