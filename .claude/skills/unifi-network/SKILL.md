---
name: unifi-network
description: |
  Interact with UniFi Network controllers via the LOCAL Integration API v1 (NOT the cloud Site Manager API). Use when: (1) querying network devices, clients, or statistics, (2) managing networks, WiFi SSIDs, firewall zones, ACL rules, (3) generating/managing hotspot vouchers, (4) listing VPN servers, WAN interfaces, RADIUS profiles. Supports UDM, UDM-Pro, UDM-SE, and Cloud Key controllers with full CRUD operations.
---

# UniFi Network Integration API (Local)

Query and manage UniFi Network controllers using the **local** Integration API v1.

> **Important:** This is the **LOCAL Integration API** that runs on your UniFi controller (UDM/Cloud Key), NOT the cloud-based Site Manager API at `api.ui.com`. The Site Manager API is for remote management via Ubiquiti's cloud; this API connects directly to your controller on your local network.

## Configuration

```bash
export UNIFI_HOST="udm.joyful.house"
export UNIFI_NETWORK_API_KEY="your-api-key"
export UNIFI_SITE_ID="default"
```

Retrieve API key from Phase:
```bash
export UNIFI_NETWORK_API_KEY=$(phase secrets get UNIFI_NETWORK_API_KEY --app claude-code --env development | jq -r .value)
```

## Access Points (12 total)

| Name | MAC | Location |
|------|-----|----------|
| U6-M-Pro:North | 9c:05:d6:f1:32:80 | North side |
| U6-E-IW:Office | e4:38:83:e6:6d:0a | Office |
| U6-M:Backyard | d0:21:f9:fe:40:b2 | Backyard |
| U7-Pro:Garage | 9c:05:d6:b3:8b:b3 | Garage |
| U6-IW:Kofen | 70:a7:41:e7:9f:ac | Kofen room |
| U6-LR:ADU | ac:8b:a9:32:ee:11 | ADU |
| U6-M-Pro:Pool Equipment | 9c:05:d6:f1:31:4b | Pool equipment |
| U6-LR:1st_Floor | 70:a7:41:61:ba:63 | 1st floor |
| U6-Lite:Shed | 70:a7:41:ca:3e:b8 | Shed |
| U6-IW:Kaelyn | f4:e2:c6:bb:5c:09 | Kaelyn room |
| U6-LR:2nd_Floor | 70:a7:41:61:b7:eb | 2nd floor |
| U6-IW:Sunroom | f4:e2:c6:bb:04:31 | Sunroom |

## Quick Start

```bash
# Controller info
scripts/unifi info

# List sites (get site IDs)
scripts/unifi sites

# List devices
scripts/unifi devices --site default

# List clients with filter
scripts/unifi clients --site default --filter "hostname.like('iPhone*')"
```

## Commands

### Global (no site required)
| Command | Description |
|---------|-------------|
| `info` | Controller system info |
| `sites` | List all sites |
| `pending` | List pending devices |
| `countries` | List country codes |
| `dpi-apps` | List DPI applications |
| `dpi-categories` | List DPI categories |

### Site-Scoped (require `--site`)
| Command | Description |
|---------|-------------|
| `devices` | List adopted devices |
| `device <id>` | Get device details |
| `device-stats <id>` | Get device statistics |
| `clients` | List connected clients |
| `client <id>` | Get client details |
| `networks` | List networks |
| `network <id>` | Get network details |
| `wifi` | List WiFi broadcasts |
| `wifi-detail <id>` | Get WiFi details |
| `vouchers` | List hotspot vouchers |
| `firewall-zones` | List firewall zones |
| `acl-rules` | List ACL rules |
| `traffic-lists` | List traffic matching lists |
| `wans` | List WAN interfaces |
| `vpn-servers` | List VPN servers |
| `vpn-tunnels` | List site-to-site tunnels |
| `radius` | List RADIUS profiles |

## Options

- `--host <ip>` - Override UNIFI_HOST
- `--site <id>` - Override UNIFI_SITE_ID
- `--filter <expr>` - Filter expression
- `--limit <n>` - Results per page (max 200)
- `--offset <n>` - Pagination offset
- `--raw` - Raw JSON output

## Filtering

Use `--filter` with property expressions:

```bash
# Pattern matching
--filter "name.like('Guest*')"

# Equality
--filter "state.eq('CONNECTED')"

# Compound
--filter "and(enabled.eq(true), name.like('Office*'))"

# Negation
--filter "not(expired.eq(true))"
```

Functions: `eq`, `ne`, `gt`, `ge`, `lt`, `le`, `like`, `in`, `notIn`, `isNull`, `isNotNull`, `contains`, `containsAny`, `containsAll`

## Direct API Access

For write operations (create/update/delete), use curl directly:

```bash
# Create network
curl -sk -X POST "https://${UNIFI_HOST}/proxy/network/integration/v1/sites/${UNIFI_SITE_ID}/networks" \
  -H "X-API-KEY: ${UNIFI_NETWORK_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Guest", "vlanId": 100, ...}'

# Delete voucher
curl -sk -X DELETE "https://${UNIFI_HOST}/proxy/network/integration/v1/sites/${UNIFI_SITE_ID}/hotspot/vouchers?filter=expired.eq(true)" \
  -H "X-API-KEY: ${UNIFI_NETWORK_API_KEY}"
```

## Resources

- [references/api-endpoints.md](references/api-endpoints.md) - Endpoint reference with filtering
- [references/openapi.json](references/openapi.json) - Full OpenAPI 3.1 spec with schemas

## Common Tasks

### Find disconnected devices
```bash
scripts/unifi devices --site default | jq '.data[] | select(.state != "CONNECTED")'
```

### List wireless clients
```bash
scripts/unifi clients --site default --filter "type.eq('WIRELESS')"
```

### Get device uptime
```bash
scripts/unifi device-stats <device-id> --site default | jq '.uptime'
```

### List active vouchers
```bash
scripts/unifi vouchers --site default --filter "not(expired.eq(true))"
```

## Device Management (Standard API)

The Integration API is read-only for device control. Use the **Standard API** for device management operations like restart, adopt, and provision.

### Standard API Base URL
```
https://udm.joyful.house/proxy/network/api/s/default
```

### List All APs
```bash
cat > /tmp/unifi_list_aps.sh << 'SCRIPT'
#!/bin/bash
curl -sk 'https://udm.joyful.house/proxy/network/api/s/default/stat/device' \
  -H 'X-API-KEY: YOUR_API_KEY' \
  -H 'Accept: application/json' | jq -r '.data[] | select(.type == "uap") | "\(.name)\t\(.mac)\t\(.state)"'
SCRIPT
chmod +x /tmp/unifi_list_aps.sh && /tmp/unifi_list_aps.sh
```

### Restart a Single AP
```bash
curl -sk -X POST 'https://udm.joyful.house/proxy/network/api/s/default/cmd/devmgr' \
  -H 'X-API-KEY: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"cmd": "restart", "mac": "aa:bb:cc:dd:ee:ff"}'
```

### Restart ALL APs (for IoT/Tuya connectivity issues)
```bash
cat > /tmp/unifi_restart_aps.sh << 'SCRIPT'
#!/bin/bash
API_KEY="YOUR_API_KEY"
BASE_URL="https://udm.joyful.house/proxy/network/api/s/default"

APS=$(curl -sk "$BASE_URL/stat/device" \
  -H "X-API-KEY: $API_KEY" | jq -r '.data[] | select(.type == "uap") | .mac')

for mac in $APS; do
  name=$(curl -sk "$BASE_URL/stat/device" -H "X-API-KEY: $API_KEY" | jq -r --arg m "$mac" '.data[] | select(.mac == $m) | .name')
  echo -n "Restarting $name ($mac)... "
  curl -sk -X POST "$BASE_URL/cmd/devmgr" \
    -H "X-API-KEY: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"cmd\": \"restart\", \"mac\": \"$mac\"}" | jq -r 'if .meta.rc == "ok" then "OK" else "FAILED" end'
done
SCRIPT
chmod +x /tmp/unifi_restart_aps.sh && /tmp/unifi_restart_aps.sh
```

### Device State Values
- `1` = Connected/Online
- `0` = Disconnected/Offline

## Troubleshooting

### Tuya/IoT Devices Offline
IoT devices on 2.4GHz often lose connectivity when APs get into weird states. Restart all APs to force clean reconnects.

### API Key Issues
The API key may contain special characters. Always use script files with heredocs (`<< 'SCRIPT'`) instead of inline curl commands to avoid shell parsing issues.
