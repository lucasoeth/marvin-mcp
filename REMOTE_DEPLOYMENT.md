# Remote MCP Server Deployment Guide

This guide covers deploying the Amazing Marvin MCP server as a remote HTTP service that can be accessed over the internet.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Deployment Options](#deployment-options)
  - [Deploy to Coolify](#deploy-to-coolify)
  - [Deploy with Docker](#deploy-with-docker)
  - [Deploy to Other Platforms](#deploy-to-other-platforms)
- [Configuration](#configuration)
- [Authentication Setup](#authentication-setup)
- [Client Configuration](#client-configuration)
- [Security Considerations](#security-considerations)
- [Monitoring and Maintenance](#monitoring-and-maintenance)

## Overview

The remote MCP server exposes all Amazing Marvin tools over HTTP using Server-Sent Events (SSE) for bidirectional communication. This allows you to connect to your Marvin data from:

- Claude Desktop (with remote connector support)
- Custom MCP clients
- Multiple devices simultaneously
- Any platform with HTTP access

**Key Features:**
- ✅ Multi-user support with session management
- ✅ Bearer token authentication
- ✅ Automatic session cleanup
- ✅ Health monitoring endpoints
- ✅ CORS configuration
- ✅ Production-ready security

## Architecture

```
┌─────────────┐
│   Client    │ (Claude Desktop, Custom Client)
└──────┬──────┘
       │ HTTP/SSE
       │ Bearer Token
       ▼
┌─────────────────────────────────────┐
│   Remote MCP Server (Express)      │
├─────────────────────────────────────┤
│ • Authentication Middleware         │
│ • Session Management                │
│ • CORS & Security                   │
└──────┬──────────────────────────────┘
       │
       │ Creates per-user instance
       ▼
┌─────────────────────────────────────┐
│   MCP Server Instance (per user)   │
├─────────────────────────────────────┤
│ • Tool Handlers                     │
│ • Marvin API Client                 │
└──────┬──────────────────────────────┘
       │
       │ User's API tokens
       ▼
┌─────────────────────────────────────┐
│   Amazing Marvin API                │
└─────────────────────────────────────┘
```

## Deployment Options

### Deploy to Coolify

Coolify with nixpacks provides the easiest deployment experience.

#### Prerequisites

1. Coolify instance running
2. Git repository connected to Coolify
3. Domain name configured (optional but recommended)

#### Steps

1. **Push your code to a Git repository**

   ```bash
   git add .
   git commit -m "Add remote MCP server"
   git push origin main
   ```

2. **Create a new project in Coolify**

   - Go to your Coolify dashboard
   - Click "Add New Resource" → "Application"
   - Select your Git source
   - Choose this repository

3. **Configure build settings**

   Coolify will auto-detect the nixpacks configuration from `nixpacks.toml`.

   - **Build Pack**: Nixpacks (auto-detected)
   - **Port**: 3000
   - **Health Check Path**: `/health`

4. **Set environment variables**

   In Coolify's environment variables section, add:

   ```env
   PORT=3000
   NODE_ENV=production
   ALLOWED_ORIGINS=*
   ADMIN_SECRET=your-secure-random-string-here
   ```

   > **Important**: Generate a strong random string for `ADMIN_SECRET`:
   > ```bash
   > openssl rand -hex 32
   > ```

5. **Deploy**

   - Click "Deploy"
   - Coolify will build and start your application
   - Check logs to verify successful startup

6. **Configure domain (recommended)**

   - In Coolify, add a domain to your application
   - Enable "Force HTTPS"
   - The server enforces HTTPS in production mode

### Deploy with Docker

#### Build and run locally

```bash
# Build the Docker image
docker build -t marvin-mcp-remote .

# Run the container
docker run -d \
  --name marvin-mcp \
  -p 3000:3000 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS=* \
  -e ADMIN_SECRET=your-secure-secret \
  marvin-mcp-remote
```

#### Deploy to Docker Hub and use in Coolify

```bash
# Tag and push to Docker Hub
docker tag marvin-mcp-remote username/marvin-mcp-remote:latest
docker push username/marvin-mcp-remote:latest
```

Then in Coolify:
- Create a new Docker Image resource
- Use image: `username/marvin-mcp-remote:latest`
- Configure environment variables as above

#### Using Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  marvin-mcp:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - ALLOWED_ORIGINS=*
      - ADMIN_SECRET=${ADMIN_SECRET}
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Run with:
```bash
docker-compose up -d
```

### Deploy to Other Platforms

#### Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create your-marvin-mcp

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set ALLOWED_ORIGINS=*
heroku config:set ADMIN_SECRET=$(openssl rand -hex 32)

# Deploy
git push heroku main
```

#### Google Cloud Run

```bash
# Build and deploy
gcloud run deploy marvin-mcp \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,ALLOWED_ORIGINS=*,ADMIN_SECRET=your-secret
```

#### Azure Container Apps

```bash
# Create container registry and build
az acr build --registry myregistry --image marvin-mcp:latest .

# Deploy to Container Apps
az containerapp create \
  --name marvin-mcp \
  --resource-group mygroup \
  --image myregistry.azurecr.io/marvin-mcp:latest \
  --environment myenv \
  --target-port 3000 \
  --env-vars NODE_ENV=production ADMIN_SECRET=your-secret
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Port the server listens on |
| `NODE_ENV` | No | development | Environment mode (`development` or `production`) |
| `ALLOWED_ORIGINS` | No | * | CORS allowed origins (comma-separated) |
| `ADMIN_SECRET` | Yes | - | Secret for creating authentication tokens |

### CORS Configuration

For development:
```env
ALLOWED_ORIGINS=*
```

For production (recommended):
```env
ALLOWED_ORIGINS=https://your-frontend.com,https://app.claude.ai
```

### HTTPS Configuration

In production mode (`NODE_ENV=production`), the server:
- Enforces HTTPS (checks `x-forwarded-proto` header)
- Sets secure headers
- Requires valid SSL certificates (handled by Coolify/reverse proxy)

## Authentication Setup

The remote server uses Bearer token authentication. Each token maps to a user's Amazing Marvin credentials.

### Step 1: Generate an Admin Secret

```bash
openssl rand -hex 32
```

Set this as the `ADMIN_SECRET` environment variable.

### Step 2: Create User Authentication Tokens

After deployment, create authentication tokens for users:

```bash
curl -X POST https://your-server.com/admin/tokens \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "apiToken": "user-marvin-api-token",
    "fullAccessToken": "user-marvin-full-access-token",
    "adminSecret": "your-admin-secret"
  }'
```

Response:
```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "message": "Token created successfully"
}
```

**Save the returned token** - users will need this to connect.

### Step 3: Secure Token Storage

**Production considerations:**
- The current implementation stores tokens in memory (lost on restart)
- For production, replace with a database (PostgreSQL, Redis, etc.)
- Store tokens hashed, not in plaintext
- Implement token rotation and expiration

## Client Configuration

### Using mcp-remote Proxy (Recommended)

The easiest way to connect is using the `mcp-remote` proxy package:

```json
{
  "mcpServers": {
    "marvin-remote": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://your-server.com/mcp",
        "--header",
        "Authorization:Bearer ${MARVIN_MCP_TOKEN}"
      ],
      "env": {
        "MARVIN_MCP_TOKEN": "your-token-from-step-2"
      }
    }
  }
}
```

Add this to:
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

### TypeScript Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({
  name: "marvin-client",
  version: "1.0.0"
}, {
  capabilities: {}
});

const transport = new StreamableHTTPClientTransport(
  new URL('https://your-server.com/mcp'),
  {
    headers: {
      'Authorization': 'Bearer your-token-here'
    }
  }
);

await client.connect(transport);

// Use the client
const tools = await client.listTools();
console.log(tools);
```

### cURL Examples

**List available tools:**
```bash
curl -X POST https://your-server.com/mcp \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

**Call a tool:**
```bash
curl -X POST https://your-server.com/mcp \
  -H "Authorization: Bearer your-token" \
  -H "Mcp-Session-Id: your-session-id" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "marvin_get_today_tasks",
      "arguments": {}
    },
    "id": 2
  }'
```

## Security Considerations

### Critical Security Measures

1. **Always use HTTPS in production**
   - Set `NODE_ENV=production`
   - Configure SSL certificates in your reverse proxy (Coolify handles this)

2. **Secure your ADMIN_SECRET**
   - Never commit to Git
   - Use environment variables or secret managers
   - Rotate periodically

3. **Implement proper token storage**
   - Current implementation is for demonstration
   - Use a database with encrypted storage
   - Implement token expiration and rotation

4. **Configure CORS properly**
   - Don't use `*` in production
   - Specify exact allowed origins

5. **Rate limiting** (recommended addition)
   - Add rate limiting middleware to prevent abuse
   - Example using `express-rate-limit`:

   ```typescript
   import rateLimit from 'express-rate-limit';

   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 minutes
     max: 100 // limit each IP to 100 requests per windowMs
   });

   app.use('/mcp', limiter);
   ```

6. **Monitor and log**
   - Set up logging for authentication attempts
   - Monitor active sessions
   - Alert on suspicious activity

### Additional Recommendations

- Implement IP whitelisting for admin endpoints
- Add request validation and sanitization
- Use helmet.js for additional security headers
- Implement session timeouts (currently 1 hour)
- Add audit logging for all tool executions

## Monitoring and Maintenance

### Health Checks

The server provides several monitoring endpoints:

**Health status:**
```bash
curl https://your-server.com/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-25T10:30:00.000Z",
  "activeSessions": 5,
  "uptime": 86400
}
```

**User statistics (authenticated):**
```bash
curl https://your-server.com/stats \
  -H "Authorization: Bearer your-token"
```

Response:
```json
{
  "userId": "user-123",
  "activeSessions": 2,
  "sessions": [
    {
      "sessionId": "abc-123",
      "createdAt": "2025-12-25T10:00:00.000Z",
      "lastActivity": "2025-12-25T10:29:00.000Z"
    }
  ]
}
```

### Logs

Monitor server logs for:
- Authentication failures
- Session creation/termination
- Errors and exceptions
- Performance issues

In Coolify, access logs from the application dashboard.

### Automatic Cleanup

The server automatically:
- Removes inactive sessions after 1 hour
- Cleans up every 10 minutes
- Logs cleanup operations

### Troubleshooting

**Common Issues:**

1. **401 Unauthorized**
   - Check token is valid
   - Verify `Authorization: Bearer token` header format
   - Ensure token was created via `/admin/tokens`

2. **Connection timeout**
   - Check firewall rules
   - Verify server is running: `curl https://your-server.com/health`
   - Check logs for errors

3. **CORS errors**
   - Add client origin to `ALLOWED_ORIGINS`
   - Restart server after environment changes

4. **Session expired**
   - Sessions timeout after 1 hour of inactivity
   - Client should reconnect and get new session

## Upgrade Path

### Future Enhancements

Consider implementing:

1. **Database-backed token storage**
   - PostgreSQL, MongoDB, or Redis
   - Persistent tokens across restarts
   - Token rotation and expiration

2. **OAuth 2.0 Integration**
   - Follow MCP OAuth specification
   - PKCE for security
   - Refresh token support

3. **WebSocket transport**
   - Lower latency than SSE
   - Better for real-time applications

4. **Prometheus metrics**
   - Request counts, latency
   - Session metrics
   - Integration with monitoring tools

5. **Multi-tenancy**
   - Organization support
   - Role-based access control
   - Usage quotas

## Support

For issues or questions:
- Check the [main README](./README.md) for general MCP setup
- Review server logs for error messages
- Verify environment variables are set correctly
- Test with the health endpoint first

## License

MIT License - same as the main project
