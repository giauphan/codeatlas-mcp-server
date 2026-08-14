# Development Guide

## Environment Setup

### Prerequisites

- Node.js 20+ (recommended: 20.11.1 LTS)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9 --activate`)
- Oracle Instant Client (for Oracle 26ai integration)
- Firebase Admin SDK credentials

### Environment Variables

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `PORT` | HTTP server port | Yes | 3000 | 3000 |
| `CODEATLAS_MCP_PORT` | MCP server port | Yes | 3001 | 3001 |
| `ORACLE_USER` | Oracle DB username | No | - | oracle_user |
| `ORACLE_PASSWORD` | Oracle DB password | No | - | oracle_password |
| `ORACLE_CONNECTION_STRING` | Oracle DB connection string | No | - | localhost:1521/ORCLPDB1 |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Admin credentials path | No | - | ./serviceAccountKey.json |
| `NVIDIA_API_KEY` | NVIDIA API key | No | - | nvapi-xyz123 |
| `CODEATLAS_API_KEY` | CodeAtlas API key | No | - | api_key_123 |
| `CODEATLAS_MULTI_TENANT` | Enable multi-tenant mode | No | false | true |
| `CODEATLAS_PROJECTS_ROOT` | Projects root directory | No | ./tenants | ./tenants |
| `CODEATLAS_PROJECT_DIR` | Single project directory | No | - | ./my-project |
| `ALLOWED_ORIGINS` | CORS allowed origins | No | - | http://localhost:3000,https://app.example.com |
| `CODEATLAS_DISABLED_TOOLS` | Comma-separated disabled tools | No | - | scan_vulnerabilities,save_dream_memory |
| `A2A_MCP_TOKEN` | Agent-to-Agent MCP token | No | - | a2a_token_456 |
| `CRON_SETTINGS_PATH` | Cron settings file path | No | - | ./cron-settings.json |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID | No | - | my-firebase-project |
| `VITE_FIREBASE_API_KEY` | Firebase API key | No | - | AIzaSyD... |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain | No | - | my-project.firebaseapp.com |
| `VITE_FIREBASE_DATABASE_URL` | Firebase database URL | No | - | https://my-project.firebaseio.com |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket | No | - | my-project.appspot.com |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase sender ID | No | - | 1234567890 |
| `VITE_FIREBASE_APP_ID` | Firebase app ID | No | - | 1:1234567890:web:abcdef123456 |

### Quick Start

```bash
# Clone the repository
pnpm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials

# Build the project
pnpm run build

# Start the server
pnpm start

# For development with auto-reload
pnpm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run production server |
| `pnpm run dev` | Run development server with auto-reload |
| `pnpm test` | Run unit tests |
| `pnpm run db-init` | Initialize Oracle database schema |
| `pnpm run db-migrate` | Run database migrations |
| `pnpm run lint` | Run ESLint |
| `pnpm run format` | Format code with Prettier |

## Troubleshooting

### Oracle Connection Issues

**Error: ORA-12506: TNS:listener does not currently know of service requested in connect descriptor**

1. Verify `ORACLE_CONNECTION_STRING` is correct
2. Check Oracle listener is running: `lsnrctl status`
3. Ensure Oracle service is registered: `lsnrctl services`

**Error: ORA-12514: TNS:listener does not currently know of SID given in connect descriptor**

1. Verify `ORACLE_CONNECTION_STRING` uses SID format: `localhost:1521/ORCL`
2. Check Oracle SID: `sqlplus / as sysdba` → `SELECT instance_name FROM v$instance;`

**Error: NJS-040: unable to acquire a connection**

1. Check connection pool settings in `src/database/oracle.ts`
2. Verify Oracle user has sufficient privileges
3. Check Oracle resource limits: `SELECT * FROM v$resource_limit;`

### Firebase Authentication

**Error: Firebase Admin initialization failed**

1. Verify `GOOGLE_APPLICATION_CREDENTIALS` points to valid service account key
2. Check Firebase project ID matches service account
3. Ensure service account has proper permissions

### LD_LIBRARY_PATH

If you encounter Oracle Instant Client errors:

```bash
export LD_LIBRARY_PATH=/path/to/instantclient:$LD_LIBRARY_PATH
```

## Dashboard Development

```bash
cd dashboard
pnpm install
pnpm run dev
```

## Testing

Run unit tests with:

```bash
pnpm test
```

For dashboard tests:

```bash
cd dashboard
pnpm test
```

## Code Standards

- TypeScript strict mode — no `any` types
- Meaningful variable names, no abbreviations
- Comments only for non-obvious logic
- All public functions must have return type annotations

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
