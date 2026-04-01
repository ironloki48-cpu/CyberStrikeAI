# Censys OSINT Methodology

## Overview
Censys provides internet-wide scan data for hosts, services, and TLS certificates.
Use for: attack surface discovery, infrastructure mapping, certificate transparency.

## Key Queries
- `services.port: 443 AND services.tls.certificates.leaf_data.subject.common_name: "*.target.com"` — find all TLS hosts for a domain
- `services.http.response.headers.server: "Apache" AND ip: 10.0.0.0/8` — internal Apache servers
- `services.banner: "SSH-2.0-OpenSSH_7"` — outdated SSH versions
- `labels: "c2"` — known C2 infrastructure

## Workflow
1. Start with broad domain/IP queries
2. Identify services and ports
3. Correlate with certificate data
4. Map autonomous systems and hosting providers
5. Feed results into targeted scanning (nmap, nuclei)
