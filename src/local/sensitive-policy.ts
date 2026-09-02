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
  if (lower[0] === '.azure') return true;
  if (lower[0] === '.aws' && lower[1] === 'credentials') return true;
  if (lower[0] === '.config' && lower[1] === 'gcloud') return true;
  return FILE_DENY.some((pattern) => pattern.test(parts.at(-1) ?? ''));
}
