/**
 * MentraOS Webhook Handler for Vercel
 * Receives transcription and photo data from MentraOS and forwards to OpenClaw
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

interface MentraWebhookPayload {
  type: 'transcription' | 'photo' | 'session_start' | 'session_end';
  userId: string;
  sessionId: string;
  data?: {
    text?: string;
    isFinal?: boolean;
    imageBuffer?: string;
    mimeType?: string;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Webhook received:`, req.method, req.url);

  // Only handle POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload: MentraWebhookPayload = req.body;
    console.log('Payload:', JSON.stringify(payload, null, 2));

    // Validate required environment variables
    const openclawToken = process.env.OPENCLAW_TOKEN;
    const openclawUrl = process.env.OPENCLAW_URL || 'http://localhost:18789';
    const mentraosApiKey = process.env.MENTRAOS_API_KEY;

    if (!openclawToken) {
      console.error('OPENCLAW_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!mentraosApiKey) {
      console.error('MENTRAOS_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Handle different payload types
    switch (payload.type) {
      case 'transcription':
        if (payload.data?.isFinal && payload.data?.text?.trim()) {
          console.log(`🎤 Final transcription from ${payload.userId}: "${payload.data.text}"`);
          
          const response = await sendToOpenClaw({
            text: payload.data.text,
            userId: payload.userId,
            openclawToken,
            openclawUrl
          });

          return res.json({ 
            success: true, 
            response: response?.message || 'Processed successfully',
            action: 'tts_response'
          });
        }
        break;

      case 'photo':
        if (payload.data?.imageBuffer) {
          console.log(`📷 Photo from ${payload.userId}`);
          
          const response = await sendImageToOpenClaw({
            imageBuffer: payload.data.imageBuffer,
            mimeType: payload.data.mimeType || 'image/jpeg',
            userId: payload.userId,
            openclawToken,
            openclawUrl
          });

          return res.json({ 
            success: true, 
            response: response?.message || 'Photo analyzed successfully',
            action: 'tts_response'
          });
        }
        break;

      case 'session_start':
        console.log(`🔗 Session started for ${payload.userId}`);
        return res.json({ success: true, message: 'Session initialized' });

      case 'session_end':
        console.log(`🔗 Session ended for ${payload.userId}`);
        return res.json({ success: true, message: 'Session closed' });

      default:
        console.log(`⚠️ Unknown payload type: ${payload.type}`);
        return res.json({ success: true, message: 'Payload received but not processed' });
    }

    return res.json({ success: true, message: 'Webhook processed' });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Send text message to OpenClaw
 */
async function sendToOpenClaw({
  text,
  userId,
  openclawToken,
  openclawUrl
}: {
  text: string;
  userId: string;
  openclawToken: string;
  openclawUrl: string;
}): Promise<{ message: string } | null> {
  try {
    const payload = {
      action: "send",
      target: `mentraos:${userId}`,
      message: text,
      source: "mentra-bridge-vercel"
    };

    console.log(`Sending to OpenClaw: ${openclawUrl}/api/message`);

    const response = await fetch(`${openclawUrl}/api/message`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openclawToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending to OpenClaw:', error);
    throw error;
  }
}

/**
 * Send image to OpenClaw
 */
async function sendImageToOpenClaw({
  imageBuffer,
  mimeType,
  userId,
  openclawToken,
  openclawUrl
}: {
  imageBuffer: string;
  mimeType: string;
  userId: string;
  openclawToken: string;
  openclawUrl: string;
}): Promise<{ message: string } | null> {
  try {
    const payload = {
      action: "send",
      target: `mentraos:${userId}`,
      message: "📷 Photo captured",
      media: `data:${mimeType};base64,${imageBuffer}`,
      source: "mentra-bridge-vercel"
    };

    const response = await fetch(`${openclawUrl}/api/message`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openclawToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending image to OpenClaw:', error);
    throw error;
  }
}