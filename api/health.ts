import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.json({
    status: 'ok',
    service: 'faceclaw',
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      openclawConfigured: !!process.env.OPENCLAW_TOKEN,
      openclawUrl: process.env.OPENCLAW_URL || 'http://localhost:18789',
      mentraosConfigured: !!process.env.MENTRAOS_API_KEY
    }
  });
}