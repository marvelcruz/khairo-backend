# KhairoDietClinic Production Hardening

## Health Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | JSON health check: uptime, database status, environment |
| `GET /health` | Redirects to `/api/health` |

## Error Alerting

- 5xx server errors send email to `ADMIN_EMAIL` or `SEED_ADMIN_EMAIL`.
- Alert includes route, message, timestamp, and stack trace.
- 4xx client errors are not emailed.

## Backup / Restore

- Use MongoDB Atlas backups.
- Take a snapshot before major releases.
- Test restore before launch.
- Restore test:
  1. Restore into a temporary database.
  2. Start backend with restored `MONGODB_URI`.
  3. Confirm CRM, clients, payments, subscriptions, medical reviews, and audit logs.

## Monitoring

| Item | Tool |
| --- | --- |
| Uptime/HTTP | External uptime monitor calling `/api/health` |
| Database | MongoDB Atlas metrics |
| Backend logs | Render logs |
| Frontend | Vercel logs |
| Cron jobs | Search Render logs for failure patterns |

## Recovery

- Rollback to last healthy Render deploy if needed.
- Check `MONGODB_URI`, `JWT_SECRET`, `PAYSTACK_SECRET_KEY`.
- Restart service after fixing configuration.
