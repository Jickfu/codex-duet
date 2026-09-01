import { z } from 'zod';
export const ConfigSchema = z.object({
  profileDir: z.string().min(1),
  cdpPort: z.number().int().min(1024).max(65535).default(9223),
  existingChromeEndpoint: z.string().url().default('http://127.0.0.1:9222'),
  existingEdgeEndpoint: z.string().url().default('http://127.0.0.1:9224'),
  chatgptUrl: z.string().url().default('https://chatgpt.com/'),
  allowedOrigins: z.array(z.string().url()).min(1).default(['https://chatgpt.com']),
  timeoutMs: z.number().int().positive().default(120000),
  debug: z.boolean().default(false),
  screenshots: z.boolean().default(false),
});
export type Config = z.infer<typeof ConfigSchema>;
