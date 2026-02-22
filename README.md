# 🦅 MentraClaw

**Give your AI eyes, ears, and voice through smart glasses**

*MentraClaw is the sensory extension for OpenClaw AI - if OpenClaw gives your AI hands to manipulate the world, MentraClaw gives it eyes to see, ears to hear, and voice to speak directly on your head.*

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRobertDaleSmith%2Fopenclaw-mentra-bridge)

## 🏗️ Architecture

```
Smart Glasses ↔ MentraOS App ↔ MentraOS Cloud ↔ Vercel Webhook ↔ OpenClaw ↔ AI Agent
```

This serverless bridge receives voice transcriptions and photos from MentraOS smart glasses and forwards them to OpenClaw for AI processing. Responses are sent back through the MentraOS ecosystem for text-to-speech playback on the glasses.

## ✨ Features

- 🎤 **Voice transcription forwarding** - Send voice commands to OpenClaw
- 📷 **Photo analysis** - Send photos for AI analysis via OpenClaw  
- ⚡ **Serverless architecture** - Auto-scaling on Vercel
- 🔒 **Secure authentication** - Token-based OpenClaw integration
- 📊 **Real-time logging** - Monitor all bridge activity
- 🌐 **Global deployment** - Low latency worldwide

## 🚀 Quick Deploy

### 1-Click Deploy to Vercel
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRobertDaleSmith%2Fopenclaw-mentra-bridge)

### Manual Deployment

1. **Clone and setup:**
   ```bash
   git clone https://github.com/RobertDaleSmith/openclaw-mentra-bridge.git
   cd openclaw-mentra-bridge
   npm install
   ```

2. **Deploy to Vercel:**
   ```bash
   vercel --prod
   ```

3. **Configure environment variables in Vercel:**
   - `OPENCLAW_TOKEN` - Your OpenClaw authentication token
   - `OPENCLAW_URL` - Your OpenClaw gateway URL (e.g., `https://your-openclaw.com`)

## 🔧 Configuration

### Environment Variables

Set these in your Vercel project settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENCLAW_TOKEN` | OpenClaw authentication token | `961d6392e1a960cc...` |
| `OPENCLAW_URL` | OpenClaw gateway URL | `https://your-openclaw.com` |

### MentraOS Setup

1. **Register your app:**
   - Go to [console.mentraglass.com](https://console.mentraglass.com)
   - Create a new app
   - Set webhook URL to: `https://your-app.vercel.app/api/webhook`

2. **Install on glasses:**
   - Use MentraOS mobile app
   - Install your bridge app
   - Start talking to OpenClaw!

## 🌐 API Endpoints

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/api/webhook` | POST | Main webhook for MentraOS data |
| `/api/health` | GET | Health check and status |
| `/` | GET | Status dashboard |

### Webhook Payload Format

The `/api/webhook` endpoint expects these payload types:

```typescript
// Voice transcription
{
  "type": "transcription",
  "userId": "user123",
  "sessionId": "session456",
  "data": {
    "text": "What's the weather like?",
    "isFinal": true
  }
}

// Photo analysis
{
  "type": "photo", 
  "userId": "user123",
  "sessionId": "session456",
  "data": {
    "imageBuffer": "base64-encoded-image",
    "mimeType": "image/jpeg"
  }
}
```

## 🛠️ Development

### Local Development

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Visit http://localhost:3000
```

### Project Structure

```
├── api/
│   ├── webhook.ts          # Main webhook handler
│   └── health.ts           # Health check endpoint
├── public/
│   └── index.html          # Status dashboard
├── package.json
├── vercel.json             # Vercel configuration
└── README.md
```

### Testing Webhooks

You can test the webhook locally using curl:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "transcription",
    "userId": "test-user", 
    "sessionId": "test-session",
    "data": {
      "text": "Hello OpenClaw",
      "isFinal": true
    }
  }'
```

## 🔒 Security

- **Token Authentication:** All OpenClaw requests use secure bearer token auth
- **Environment Variables:** Sensitive data stored as Vercel environment variables  
- **HTTPS Only:** All communication encrypted in transit
- **Input Validation:** Webhook payloads are validated before processing

## 🐛 Troubleshooting

### Common Issues

1. **"OpenClaw API error: 401"**
   - Check your `OPENCLAW_TOKEN` environment variable
   - Ensure OpenClaw is accessible from Vercel

2. **"Webhook not receiving data"**
   - Verify webhook URL in MentraOS console
   - Check Vercel function logs for errors

3. **"Function timeout"**
   - OpenClaw requests should complete within Vercel's 10s limit
   - Check OpenClaw response times

### Debugging

View real-time logs in Vercel dashboard:
1. Go to your Vercel project
2. Click "Functions" tab
3. Click on `/api/webhook` function
4. View invocation logs

## 📊 Monitoring

### Health Check

Visit `https://your-app.vercel.app/api/health` to check:
- Service status
- Environment configuration
- OpenClaw connectivity

### Vercel Analytics

Enable Vercel Analytics for:
- Request volume and performance
- Error rates
- Geographic distribution

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with real MentraOS webhooks
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔗 Links

- **MentraOS:** [mentraglass.com](https://mentraglass.com)
- **OpenClaw:** [openclaw.ai](https://openclaw.ai)
- **Vercel:** [vercel.com](https://vercel.com)
- **Developer Console:** [console.mentraglass.com](https://console.mentraglass.com)

---

**Built with ❤️ for the smart glasses revolution**