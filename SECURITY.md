# Security Policy

## Reporting a Vulnerability

We take the security of CodeAtlas MCP Server seriously. If you believe you have found a security vulnerability, please report it to **giauphan012@gmail.com** or open a [private security advisory](https://github.com/giauphan/codeatlas-mcp-server/security/advisories/new).

You should receive a response within 48 hours.

Please include:
- Type of issue
- Affected source files
- Steps to reproduce
- Impact of the issue

## Disclosure

Please do not publicly disclose the vulnerability until we have had the opportunity to address it.

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 3.x     | :white_check_mark: |
| < 3.0   | :x:                |

## Security Features

- Bind variables for all SQL queries (no string concatenation)
- No `any` types — uses `unknown`
- Error handling for database operations
- Secure credential storage via environment variables
- Restricted CORS origins (`ALLOWED_ORIGINS`)
- Rate limiting on public endpoints
- Authentication via API key or Firebase JWT
- Input validation and sanitization

## Reporting Security Issues

- Use private security advisories on GitHub
- Include reproduction steps and affected files
- Expect response within 48 hours
- Do not publicly disclose until fixed
