const FILE_DENY = [
  /^\.env(?:\..+)?$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^(?:application_default_credentials|credentials|secrets|token|tokens)\.json$/i,
  /^passwords\.txt$/i,
  /^\.(?:netrc|npmrc|pypirc)$/i,
];

export function isSensitiveWorkspacePath(relativePath: string): boolean {
  const parts = relativePath.split('/');
  const lower = parts.map((part) => part.toLowerCase());
  if (lower.includes('.git') || lower.includes('.chatbridge') || lower.includes('.ssh'))
    return true;
  if (lower.includes('.azure')) return true;
  if (containsSequence(lower, ['.aws', 'credentials'])) return true;
  if (containsSequence(lower, ['.config', 'gcloud'])) return true;
  return FILE_DENY.some((pattern) => pattern.test(parts.at(-1) ?? ''));
}

function containsSequence(parts: string[], sequence: string[]): boolean {
  return parts.some((_, index) => sequence.every((part, offset) => parts[index + offset] === part));
}
