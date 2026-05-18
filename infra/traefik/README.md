# Traefik dynamic config

Deploy path on server: `/data/coolify/proxy/dynamic/robloxbank-ssl.yaml`

Traefik watches this directory live — changes apply without restart.

## Routing

| Rule | Container | Priority |
|---|---|---|
| `robloxbank.ru` (catch-all) | main-svc (port 3000) | 1 |
| `/guide?source=wb` | guide-svc (port 3001) | 100 |
| `/_next-guide/*` | guide-svc + StripPrefix | 101 |
| `/api/wb-code`, `/api/wb-link` | guide-svc | 102 |

HTTP → HTTPS redirect is handled by `rb-redirect` router (priority 50).

## Rate limits

| Middleware | Limit | Applied to |
|---|---|---|
| `rate-limit-general` | 60 req/min per IP | pages |
| `rate-limit-api` | 20 req/min per IP | `/api/wb-*` |
| `rate-limit-static` | 200 req/min per IP | `/_next-guide/*` |

## Traefik access logs

Enabled in `/data/coolify/proxy/docker-compose.yml`:
```
--accesslog=true
--accesslog.filepath=/traefik/access.log
```

Log path on server: `/data/coolify/proxy/access.log`
Consumed by CrowdSec for threat detection.

## CrowdSec

- Container: `crowdsec` (Docker, network: coolify)
- Config: `/data/crowdsec/config/`
- Firewall bouncer: `crowdsec-firewall-bouncer-iptables` (systemd service on host)
- Collections: `crowdsecurity/traefik`, `crowdsecurity/http-cve`, `crowdsecurity/base-http-scenarios`
- Acquisition: reads `/data/coolify/proxy/access.log`

To check bans: `docker exec crowdsec cscli decisions list`
To check bouncers: `docker exec crowdsec cscli bouncers list`
