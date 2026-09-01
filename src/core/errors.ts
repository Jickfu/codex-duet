export class ChatbridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ChatbridgeError';
  }
}
export class ProtocolError extends ChatbridgeError {
  constructor(message: string) {
    super(message, 'PROTOCOL_ERROR');
  }
}
export class BridgeTimeoutError extends ChatbridgeError {
  constructor(message: string) {
    super(message, 'BRIDGE_TIMEOUT');
  }
}
