import { z } from 'zod';
export const ConfigSchema = z.object({
  profileDir: z.string().min(1),
  cdpPort: z.number().int().min(1024).max(65535).default(9223),
  chatgptUrl: z.string().url().default('https://chatgpt.com/'),
  timeoutMs: z.number().int().positive().default(120000),
  debug: z.boolean().default(false),
  screenshots: z.boolean().default(false),
});
export type Config = z.infer<typeof ConfigSchema>;
