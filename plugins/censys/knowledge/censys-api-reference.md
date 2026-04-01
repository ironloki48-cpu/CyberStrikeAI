# Censys API Reference

Base URL: https://search.censys.io/api/v2
Auth: HTTP Basic (API_ID:API_SECRET)

## Endpoints
- GET /v2/hosts/search?q=QUERY&per_page=N — search hosts
- GET /v2/hosts/{ip} — host details
- GET /v2/certificates/search?q=QUERY — search certificates
- GET /v2/hosts/{ip}/diff — host change history

## CQL Query Language
- Field matching: `field: "value"`
- Boolean: `AND`, `OR`, `NOT`
- CIDR: `ip: 1.2.3.0/24`
- Wildcards: `*.example.com`
- Ranges: `services.port: [80 TO 443]`
- Exists: `services.http.response.headers.server: *`
