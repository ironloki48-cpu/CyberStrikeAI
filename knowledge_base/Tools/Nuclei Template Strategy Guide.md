# Nuclei Template Strategy Guide

## Scope
This guide tells the model which Nuclei templates to run and when, so scans stay focused, high-signal, and aligned to authorized testing objectives.

## Installed Template Sources
- Official ProjectDiscovery templates:
  - `/opt/cyberstrike-tools/nuclei-templates`
- Bitrix community pack:
  - `/opt/cyberstrike-tools/bitrix-nuclei-templates`
  - linked at `/opt/cyberstrike-tools/nuclei-templates/custom/bitrix`

## Core Selection Policy
1. Start with the smallest useful set.
2. Expand only when prior results justify deeper coverage.
3. Bind scan scope to observed technology and attack surface.
4. Prefer severity and tag filters over full-pack sweeps.
5. Record scan rationale in memory before broadening.

## Decision Matrix (What To Run, When)
### Phase 1: Fast Baseline
Use when target is new or unprofiled.

Recommended:
```bash
nuclei -u https://target \
  -t /opt/cyberstrike-tools/nuclei-templates \
  -s critical,high \
  -tags cve,rce,lfi,sqli,xss,exposure,misconfig \
  -stats
```

Why:
- Finds high-impact known issues quickly.
- Avoids long low-value template execution during initial triage.

### Phase 2: Technology-Aligned Follow-Up
Use when fingerprinting identified stack details (CMS/framework/web server/cloud).

Recommended pattern:
```bash
nuclei -u https://target \
  -t /opt/cyberstrike-tools/nuclei-templates \
  -tags <tech>,cve,misconfig \
  -s critical,high,medium
```

Examples:
- WordPress detected: include `wordpress` tag.
- Apache/Nginx exposure surface detected: include related config and exposure tags.

Why:
- Increases precision and coverage density for confirmed technologies.

### Phase 3: Protocol-Constrained Scans
Use when target type is known and mixed protocol templates create noise.

Recommended:
```bash
nuclei -u https://target \
  -t /opt/cyberstrike-tools/nuclei-templates \
  -pt http \
  -s critical,high,medium
```

Why:
- Prevents unrelated protocol templates from wasting requests/time.

### Phase 4: Bitrix-Specific Expansion
Use only after Bitrix indicators are present (`/bitrix/`, Bitrix cookies, panel endpoints, module paths).

Recommended:
```bash
nuclei -u https://target \
  -t /opt/cyberstrike-tools/bitrix-nuclei-templates \
  -s critical,high,medium \
  -stats
```

Or via tool profile:
```bash
nuclei-bitrix -u https://target -s critical,high,medium
```

Why:
- Bitrix pack includes targeted installer exposure, historical CVE checks, and Bitrix-specific weak-point templates.

### Phase 5: Adaptive Auto-Scan
Use when broad web recon is desired with technology-aware auto-tagging.

Recommended:
```bash
nuclei -u https://target \
  -t /opt/cyberstrike-tools/nuclei-templates \
  -as \
  -s critical,high,medium
```

Why:
- `-as` maps detected technologies to relevant tags and reduces random template usage.

## What Not To Do
- Do not run all templates by default without tags/severity constraints.
- Do not run Bitrix templates if Bitrix is not evidenced.
- Do not prioritize informational templates before high-severity triage.
- Do not repeat identical scans without changed scope/filters.

## Escalation Rules
Escalate from narrow to broad only if:
1. High-impact findings need chain validation.
2. Technology confidence increases.
3. Initial scan returns sparse data and scope allows deeper coverage.
4. User explicitly requests full-spectrum assessment.

## Model-Facing Workflow
1. Confirm authorized target scope and objective.
2. Run baseline high-severity filtered templates.
3. Parse findings and identify technology indicators.
4. Select next template set by matrix phase.
5. Store decision and completion status in memory.
6. Avoid duplicate scans unless parameters changed.

## References
- ProjectDiscovery Nuclei docs (running scans and template selection):
  - https://docs.projectdiscovery.io/tools/nuclei/running
- Official nuclei-templates repository:
  - https://github.com/projectdiscovery/nuclei-templates
- Bitrix community template pack:
  - https://github.com/jhonnybonny/bitrix-nuclei-templates
