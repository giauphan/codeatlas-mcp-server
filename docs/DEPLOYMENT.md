# Deployment Guide

## Production Deployment

### Prerequisites

- Node.js 20+ on target machine
- Oracle Instant Client installed
- Firebase Admin credentials file

### 1. Clone & Install

```bash
git clone https://github.com/giauphan/codeatlas-mcp-server.git
cd codeatlas-mcp-server
corepack enable && corepack prepare pnpm@9 --activate
pnpm install --frozen-lockfile
pnpm run build
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with production values
# NEVER commit .env
```

Minimum required for production:
```bash
PORT=3000
CODEATLAS_MCP_PORT=3001
ORACLE_CONNECTION_STRING=your-oracle-host:1521/YOUR_SERVICE
ORACLE_USER=your_user
ORACLE_PASSWORD=your_password
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
ALLOWED_ORIGINS=https://your-domain.com
```

### 3. Initialize Database

```bash
pnpm run db-init
pnpm run db-migrate
```

## Process Managers

### PM2

```bash
pnpm add -g pm2
pm2 start dist/index.js --name codeatlas-mcp
pm2 save
pm2 startup
```

### systemd

```ini
# /etc/systemd/system/codeatlas-mcp.service
[Unit]
Description=CodeAtlas MCP Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/codeatlas-mcp-server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable codeatlas-mcp
sudo systemctl start codeatlas-mcp
sudo systemctl status codeatlas-mcp
```

## Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/mcp.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Healthcheck

The server exposes a `/health` endpoint. Monitor it:

```bash
curl -s http://localhost:3000/health | jq
```

## Docker

Docker support is available via the base `codeatlas-platform` repo. Build locally:

```bash
docker build -t codeatlas-mcp .
docker run -p 3001:3001 --env-file .env codeatlas-mcp
```

## Security Checklist

- [ ] `.env` file is not committed
- [ ] Firebase credentials stored securely (not in repo)
- [ ] `ALLOWED_ORIGINS` restricted to specific domains
- [ ] TLS enabled via reverse proxy
- [ ] Database credentials use minimal-privilege user
- [ ] Rate limiting configured on reverse proxy
- [ ] Logs rotated (logrotate or journalctl)

## Backup

- Oracle database: regular RMAN or Data Pump backups
- Firebase: use Firebase Console export or gcloud CLI
- Config files: keep `.env` and service account keys in secrets manager
