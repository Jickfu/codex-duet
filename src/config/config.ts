import path from 'node:path';
import process from 'node:process';
import { ConfigSchema, type Config } from './schema.js';
export function loadConfig(overrides: Partial<Config> = {}): Config {
  return ConfigSchema.parse({
    profileDir: path.resolve(process.cwd(), '.chatbridge/profile'),
    debug: process.env.CHATBRIDGE_DEBUG === '1',
    ...overrides,
  });
}
