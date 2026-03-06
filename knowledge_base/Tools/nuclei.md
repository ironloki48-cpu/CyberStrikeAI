# nuclei

## Overview
- Tool name: `nuclei`
- Enabled in config: `true`
- Executable: `nuclei`
- Default args: none
- Summary: Fast vulnerability scanner using YAML templates for vulnerability detection

## Detailed Description
Nuclei is a template-based fast vulnerability scanner that uses community-maintained YAML templates for vulnerability detection.

**Key Features:**
- Fast vulnerability scanning
- Template-based detection
- Support for multiple protocols (HTTP, TCP, DNS, etc.)
- Real-time result output
- Support for custom templates

**Use Cases:**
- Vulnerability scanning and discovery
- Security assessment
- Penetration testing
- Vulnerability verification

## Installed Template Packs
- Official templates: `/opt/cyberstrike-tools/nuclei-templates`
- Bitrix pack: `/opt/cyberstrike-tools/bitrix-nuclei-templates`
- Bitrix symlink under official tree: `/opt/cyberstrike-tools/nuclei-templates/custom/bitrix`

## Template Selection Quick Rules
- Use official templates for baseline posture and broad CVE checks.
- Use `-tags` and `-s` to reduce noise before widening scan scope.
- Use `-pt` to constrain protocol classes (for example `http`, `dns`, `ssl`).
- Use Bitrix templates only after confirming Bitrix fingerprints/endpoints.
- Prefer workflows (`-w`) or `-as` for structured phased coverage.

See the comprehensive selection matrix:
- [Nuclei Template Strategy Guide](./Nuclei%20Template%20Strategy%20Guide.md)

## Parameters
### `target`
- Type: `string`
- Required: `true`
- Flag: `-u`
- Format: `flag`
- Description: Target URL or IP

### `severity`
- Type: `string`
- Required: `false`
- Flag: `-s`
- Format: `flag`
- Description: Severity filter (critical,high,medium,low,info)

### `tags`
- Type: `string`
- Required: `false`
- Flag: `-tags`
- Format: `flag`
- Description: Tag filter (e.g. cve,rce,lfi)

### `template`
- Type: `string`
- Required: `false`
- Flag: `-t`
- Format: `flag`
- Description: Custom template path

### `additional_args`
- Type: `string`
- Required: `false`
- Format: `positional`
- Description: Additional Nuclei parameters

## Invocation Template
```bash
nuclei <target> <severity> <tags> <template> <additional_args>
```

## Model Usage Guidance
- Use this tool only within authorized scope.
- Prefer the narrowest target/argument set before broad scans.
- For long outputs, store results and summarize key findings.
- Validate parameter formats before execution to reduce command errors.
