# Simple Remote MCP Setup Guide

This guide shows you how to deploy your Marvin MCP server to the internet for easy access from apps like Poke.

## 🚀 Quick Setup (3 Steps)

### Step 1: Deploy to Coolify

1. **Push to Git** (if you haven't already)
   ```bash
   git push origin main
   ```

2. **Create Application in Coolify**
   - Go to your Coolify dashboard
   - Click "Add New Resource" → "Application"
   - Select your Git repository
   - Choose this project

3. **Set Environment Variables**

   In Coolify's environment variables section, add:

   ```env
   MARVIN_API_TOKEN=your-marvin-api-token-here
   MARVIN_FULL_ACCESS_TOKEN=your-marvin-full-access-token-here
   API_KEY=your-secure-api-key-here
   NODE_ENV=production
   ```

   **To get your Marvin tokens:**
   - Open Amazing Marvin app
   - Go to Settings → API
   - Copy both tokens

   **To generate a secure API_KEY:**
   ```bash
   openssl rand -hex 32
   ```

4. **Configure Build Settings**
   - Port: `3000`
   - Health Check Path: `/health`
   - Coolify will auto-detect nixpacks

5. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Copy your server URL (e.g., `https://your-app.coolify.app`)

### Step 2: Connect from Poke

1. Open Poke app
2. Go to Integrations → Add New Integration
3. Fill in:
   - **Name**: `Marvin` (or whatever you want)
   - **Server URL**: `https://your-app.coolify.app/mcp`
   - **API Key**: Paste the API_KEY from Step 1
4. Click "Create Integration"

### Step 3: Start Using!

That's it! You can now use Marvin tools in Poke:
- "Show me my tasks for today"
- "Create a task to buy groceries"
- "What's in my inbox?"

## 🔧 Configuration Details

### Required Environment Variables

| Variable | Where to Get It | Example |
|----------|-----------------|---------|
| `MARVIN_API_TOKEN` | Amazing Marvin → Settings → API | `abc123...` |
| `MARVIN_FULL_ACCESS_TOKEN` | Amazing Marvin → Settings → API | `xyz789...` |
| `API_KEY` | Generate with `openssl rand -hex 32` | `a1b2c3...` |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Set to `production` for HTTPS enforcement |
| `ALLOWED_ORIGINS` | * | CORS origins (comma-separated) |

## 🔒 Security Notes

- **API_KEY is optional** - If you don't set it, anyone with your URL can access your Marvin data. Only skip it if:
  - You're testing locally
  - Your server is behind another authentication layer
  - You trust your network

- **Always use HTTPS in production** - Set `NODE_ENV=production` and Coolify will handle HTTPS automatically

- **Keep your API_KEY secret** - Treat it like a password

## 🧪 Testing Your Deployment

### Check if it's running:
```bash
curl https://your-app.coolify.app/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-12-25T13:29:00.000Z",
  "activeSessions": 0,
  "uptime": 42
}
```

### Test with your API key:
```bash
curl -X POST "https://your-app.coolify.app/mcp?token=your-api-key" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test",
        "version": "1.0.0"
      }
    },
    "id": 1
  }'
```

Should return an initialize response with available capabilities.

## 🐛 Troubleshooting

### "Missing required environment variables"
- Make sure you set `MARVIN_API_TOKEN` and `MARVIN_FULL_ACCESS_TOKEN` in Coolify
- Check the logs in Coolify to see which variables are missing

### "Invalid API key"
- The API_KEY in Poke must match exactly the one in Coolify
- Check for extra spaces or typos
- Regenerate if needed

### "Connection refused" or "Cannot connect"
- Check if the server is running: visit `https://your-app.coolify.app/health`
- Verify your URL ends with `/mcp`
- Check Coolify logs for errors

### Poke can't connect
- Make sure Server URL includes `/mcp` at the end
- Verify API Key is correct
- Try without API Key first (remove `API_KEY` from Coolify env vars) to test connection

## 📱 Connecting from Other Apps

### Claude Desktop (with mcp-remote)

```json
{
  "mcpServers": {
    "marvin-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-app.coolify.app/mcp",
        "--header",
        "Authorization:Bearer your-api-key"
      ]
    }
  }
}
```

### Custom TypeScript Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://your-app.coolify.app/mcp'),
  {
    headers: {
      'Authorization': 'Bearer your-api-key'
    }
  }
);

const client = new Client({
  name: "my-client",
  version: "1.0.0"
}, { capabilities: {} });

await client.connect(transport);
```

## 🔄 Updating Your Deployment

1. Make changes to your code
2. Commit and push:
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```
3. Coolify will automatically rebuild and redeploy

## 💡 Tips

- **Test locally first**: Run `npm run dev:remote` with a `.env` file to test before deploying
- **Monitor your sessions**: Visit `https://your-app.coolify.app/stats` (with API key) to see active sessions
- **Sessions auto-cleanup**: Inactive sessions are removed after 1 hour
- **Multiple clients**: You can connect from multiple devices with the same API key

## 📖 Advanced Configuration

For multi-user setups, OAuth, rate limiting, and other advanced features, see [REMOTE_DEPLOYMENT.md](./REMOTE_DEPLOYMENT.md).

## 🆘 Need Help?

- Check Coolify logs for server errors
- Verify all environment variables are set correctly
- Test the `/health` endpoint first
- Try removing `API_KEY` temporarily to isolate auth issues
