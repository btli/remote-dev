# UniFi Network Integration API Reference (Local)

> **This is the LOCAL Integration API**, not the cloud Site Manager API.
>
> | API | Base URL | Purpose |
> |-----|----------|---------|
> | **Integration API (this)** | `https://<your-controller>/proxy/network/integration/v1` | Direct local access to your controller |
> | Site Manager API | `https://api.ui.com/v1` | Cloud-based remote management via Ubiquiti |

## Base URL

```
https://<controller-host>/proxy/network/integration/v1
```

Replace `<controller-host>` with your UDM/Cloud Key IP (e.g., `172.16.0.1` or `udm.local`).

## Authentication

All requests require the `X-API-KEY` header with your **local controller API key** (not the Site Manager API key):

```
X-API-KEY: <your-network-api-key>
Accept: application/json
```

API keys are generated in **UniFi Network > Settings > System > Integrations** on your local controller.

> **Note:** This API key is different from the Site Manager API key generated at unifi.ui.com. The local Integration API key only works with your specific controller.

## Global Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/info` | Controller system information |
| GET | `/v1/sites` | List all sites |
| GET | `/v1/pending-devices` | List pending (unadopted) devices |
| GET | `/v1/countries` | List country codes |
| GET | `/v1/dpi/applications` | List DPI applications |
| GET | `/v1/dpi/categories` | List DPI categories |

## Site-Scoped Endpoints

All site endpoints require `{siteId}` from `/v1/sites`.

### Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/devices` | List adopted devices |
| GET | `/v1/sites/{siteId}/devices/{deviceId}` | Get device details |
| GET | `/v1/sites/{siteId}/devices/{deviceId}/statistics/latest` | Get device statistics |
| POST | `/v1/sites/{siteId}/devices/{deviceId}/actions` | Execute device action |
| POST | `/v1/sites/{siteId}/devices/{deviceId}/interfaces/ports/{portIdx}/actions` | Execute port action |
| GET | `/v1/sites/{siteId}/device-tags` | List device tags |

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/clients` | List connected clients |
| GET | `/v1/sites/{siteId}/clients/{clientId}` | Get client details |
| POST | `/v1/sites/{siteId}/clients/{clientId}/actions` | Execute client action |

### Networks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/networks` | List networks |
| POST | `/v1/sites/{siteId}/networks` | Create network |
| GET | `/v1/sites/{siteId}/networks/{networkId}` | Get network details |
| PUT | `/v1/sites/{siteId}/networks/{networkId}` | Update network |
| DELETE | `/v1/sites/{siteId}/networks/{networkId}` | Delete network |
| GET | `/v1/sites/{siteId}/networks/{networkId}/references` | Get network references |

### WiFi Broadcasts (SSIDs)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/wifi/broadcasts` | List WiFi broadcasts |
| POST | `/v1/sites/{siteId}/wifi/broadcasts` | Create WiFi broadcast |
| GET | `/v1/sites/{siteId}/wifi/broadcasts/{wifiBroadcastId}` | Get WiFi details |
| PUT | `/v1/sites/{siteId}/wifi/broadcasts/{wifiBroadcastId}` | Update WiFi broadcast |
| DELETE | `/v1/sites/{siteId}/wifi/broadcasts/{wifiBroadcastId}` | Delete WiFi broadcast |

### Hotspot Vouchers

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/hotspot/vouchers` | List vouchers |
| POST | `/v1/sites/{siteId}/hotspot/vouchers` | Generate vouchers |
| GET | `/v1/sites/{siteId}/hotspot/vouchers/{voucherId}` | Get voucher details |
| DELETE | `/v1/sites/{siteId}/hotspot/vouchers` | Delete vouchers (with filter) |

### Firewall

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/firewall/zones` | List firewall zones |
| POST | `/v1/sites/{siteId}/firewall/zones` | Create firewall zone |
| GET | `/v1/sites/{siteId}/firewall/zones/{firewallZoneId}` | Get zone details |
| PUT | `/v1/sites/{siteId}/firewall/zones/{firewallZoneId}` | Update firewall zone |
| DELETE | `/v1/sites/{siteId}/firewall/zones/{firewallZoneId}` | Delete firewall zone |

### ACL Rules

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/acl-rules` | List ACL rules |
| POST | `/v1/sites/{siteId}/acl-rules` | Create ACL rule |
| GET | `/v1/sites/{siteId}/acl-rules/{aclRuleId}` | Get ACL rule |
| PUT | `/v1/sites/{siteId}/acl-rules/{aclRuleId}` | Update ACL rule |
| DELETE | `/v1/sites/{siteId}/acl-rules/{aclRuleId}` | Delete ACL rule |

### Traffic Matching Lists

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/traffic-matching-lists` | List traffic lists |
| POST | `/v1/sites/{siteId}/traffic-matching-lists` | Create traffic list |
| GET | `/v1/sites/{siteId}/traffic-matching-lists/{id}` | Get traffic list |
| PUT | `/v1/sites/{siteId}/traffic-matching-lists/{id}` | Update traffic list |
| DELETE | `/v1/sites/{siteId}/traffic-matching-lists/{id}` | Delete traffic list |

### Supporting Resources (Read-only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/sites/{siteId}/wans` | List WAN interfaces |
| GET | `/v1/sites/{siteId}/vpn/servers` | List VPN servers |
| GET | `/v1/sites/{siteId}/vpn/site-to-site-tunnels` | List VPN tunnels |
| GET | `/v1/sites/{siteId}/radius/profiles` | List RADIUS profiles |

## Filtering

List endpoints support filtering via `?filter=<expression>`.

### Syntax

```
# Property expression
property.function(arguments)

# Compound expression
and(expr1, expr2)
or(expr1, expr2, expr3)

# Negation
not(expression)
```

### Functions

| Function | Args | Description | Types |
|----------|------|-------------|-------|
| `isNull` | 0 | is null | all |
| `isNotNull` | 0 | is not null | all |
| `eq` | 1 | equals | STRING, INTEGER, DECIMAL, TIMESTAMP, BOOLEAN, UUID |
| `ne` | 1 | not equals | STRING, INTEGER, DECIMAL, TIMESTAMP, BOOLEAN, UUID |
| `gt` | 1 | greater than | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `ge` | 1 | >= | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `lt` | 1 | less than | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `le` | 1 | <= | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `like` | 1 | pattern match (`*` = any, `.` = single char) | STRING |
| `in` | 1+ | one of | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `notIn` | 1+ | not one of | STRING, INTEGER, DECIMAL, TIMESTAMP, UUID |
| `isEmpty` | 0 | set is empty | SET |
| `contains` | 1 | set contains | SET |
| `containsAny` | 1+ | set contains any | SET |
| `containsAll` | 1+ | set contains all | SET |
| `containsExactly` | 1+ | set equals | SET |

### Examples

```bash
# Find clients by name pattern
?filter=hostname.like('iPhone*')

# Find devices by state
?filter=state.eq('CONNECTED')

# Combine conditions
?filter=and(enabled.eq(true), name.like('Guest*'))

# Negate
?filter=not(expired.eq(true))
```

## Pagination

List endpoints support pagination:

- `?offset=0` - Starting offset (default: 0)
- `?limit=25` - Results per page (default: 25, max: 200)

## Device Actions

Available via POST `/v1/sites/{siteId}/devices/{deviceId}/actions`:

- `RESTART` - Restart device
- `ADOPT` - Adopt pending device
- `FORGET` - Forget/remove device
- `LOCATE` - Flash LEDs to locate device

## Client Actions

Available via POST `/v1/sites/{siteId}/clients/{clientId}/actions`:

- `RECONNECT` - Force client reconnection
- `BLOCK` - Block client
- `UNBLOCK` - Unblock client
- `AUTHORIZE` - Authorize guest
- `UNAUTHORIZE` - Remove guest authorization

## Full OpenAPI Spec

See [openapi.json](openapi.json) for complete schema definitions and request/response formats.
