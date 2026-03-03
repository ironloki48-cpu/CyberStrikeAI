# Tool Configuration Guide

## Overview

Each tool has its own configuration file stored in the `tools/` directory. This approach makes tool configuration clearer and easier to maintain. The system automatically loads all `.yaml` and `.yml` files in the `tools/` directory.

## Configuration File Format

Each tool configuration file is a YAML file. The table below lists the supported top-level fields and whether they are required:

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | ✅ | string | Unique tool identifier. Use lowercase letters, digits, and hyphens. |
| `command` | ✅ | string | The actual command or script name to execute; must be in the system PATH or use an absolute path. |
| `enabled` | ✅ | bool | Whether to register this tool in MCP; set to `false` to ignore the tool. |
| `description` | ✅ | string | Detailed description, supports multi-line Markdown; used for deep AI understanding and `resources/read` queries. |
| `short_description` | Optional | string | 20–50 character summary for the tool list to reduce token usage; auto-extracted from the start of `description` if omitted. |
| `args` | Optional | string[] | Fixed arguments prepended to the command line in order; commonly used to define default scan modes. |
| `parameters` | Optional | array | List of runtime-configurable parameters; see the "Parameter Definitions" section. |
| `arg_mapping` | Optional | string | Parameter mapping mode (`auto`/`manual`/`template`); defaults to `auto` — no need to specify unless you have special requirements. |

> If a field is incorrect or a required field is missing, the system will skip that tool on load and output a warning in the logs, but will not affect other tools.

## Tool Descriptions

### Short Description (`short_description`)

- **Purpose**: Used in the tool list to reduce token consumption sent to the LLM.
- **Requirement**: One sentence (20–50 characters) describing the core purpose of the tool.
- **Example**: `"Network scanner for discovering hosts, open ports, and services"`

### Detailed Description (`description`)

Supports multi-line text and should include:

1. **Tool functionality**: The main functions of the tool.
2. **Use cases**: When to use this tool.
3. **Notes**: Warnings and considerations for use.
4. **Examples**: Usage examples (optional).

**Important notes**:
- When the tool list is sent to the LLM, `short_description` is used (if present).
- If `short_description` is absent, the system auto-extracts the first line or first 100 characters from `description`.
- Detailed descriptions can be retrieved via the MCP `resources/read` endpoint (URI: `tool://tool_name`).

This significantly reduces token consumption, especially when many tools are loaded (e.g., 100+ tools).

## Parameter Definitions

Each parameter can include the following fields:

- `name`: Parameter name
- `type`: Parameter type (`string`, `int`, `bool`, `array`)
- `description`: Detailed parameter description (supports multi-line)
- `required`: Whether required (`true`/`false`)
- `default`: Default value
- `flag`: Command-line flag (e.g., `"-u"`, `"--url"`, `"-p"`)
- `position`: Position for positional parameters (integer, starting from 0)
- `format`: Parameter format (`"flag"`, `"positional"`, `"combined"`, `"template"`)
- `template`: Template string (used when `format="template"`)
- `options`: List of allowed values (for enum types)

### Parameter Format Reference

- **`flag`**: Flag parameter, format `--flag value` or `-f value`
  - Example: `flag: "-u"` → `-u http://example.com`

- **`positional`**: Positional parameter, appended in order
  - Example: `position: 0` → first positional argument

- **`combined`**: Combined format, `--flag=value`
  - Example: `flag: "--level"`, `format: "combined"` → `--level=3`

- **`template`**: Template format using a custom template string
  - Example: `template: "{flag} {value}"` → custom format

### Special Parameters

#### `additional_args`

`additional_args` is a special parameter for passing extra command-line options not defined in the parameters list. It is parsed and split by spaces into individual arguments.

**Use cases:**
- Pass advanced tool options
- Pass parameters not defined in the config
- Pass complex argument combinations

**Example:**
```yaml
- name: "additional_args"
  type: "string"
  description: "Additional tool arguments, separated by spaces"
  required: false
  format: "positional"
```

**Usage examples:**
- `additional_args: "--script vuln -O"` → parsed as `["--script", "vuln", "-O"]`
- `additional_args: "-T4 --max-retries 3"` → parsed as `["-T4", "--max-retries", "3"]`

**Notes:**
- Arguments are split by spaces but content inside quotes is preserved.
- Ensure correct argument format to avoid command injection risks.
- This parameter is appended at the end of the command.

#### `scan_type` (specific tools)

Some tools (e.g., `nmap`) support the `scan_type` parameter to override the default scan type arguments.

**Example (nmap):**
```yaml
- name: "scan_type"
  type: "string"
  description: "Scan type options to override the default scan type"
  required: false
  format: "positional"
```

**Usage examples:**
- `scan_type: "-sV -sC"` → version detection and script scanning
- `scan_type: "-A"` → comprehensive scan

**Notes:**
- If `scan_type` is specified, it replaces the default scan type arguments in the tool config.
- Multiple options are separated by spaces.

### Parameter Description Requirements

Parameter descriptions should include:

1. **Purpose**: What this parameter does.
2. **Format requirements**: The required format for the parameter value (e.g., URL format, port range format).
3. **Example values**: Concrete examples (multiple examples as a list).
4. **Notes**: Things to be aware of (permission requirements, performance impact, security warnings).

**Recommended description format:**
- Use Markdown formatting for readability.
- Use `**bold**` to highlight important information.
- Use lists to present multiple examples or options.
- Use code blocks for complex formats.

**Example:**
```yaml
description: |
  Target IP address or domain name. Can be a single IP, IP range, CIDR, or domain.

  **Example values:**
  - Single IP: "192.168.1.1"
  - IP range: "192.168.1.1-100"
  - CIDR: "192.168.1.0/24"
  - Domain: "example.com"

  **Notes:**
  - Ensure the target address format is correct.
  - Required parameter — cannot be empty.
```

## Parameter Type Reference

### Boolean Type (`bool`)

Boolean parameters have special handling:
- `true`: Adds only the flag, no value (e.g., `--flag`)
- `false`: Adds nothing
- Supports multiple input formats: `true`/`false`, `1`/`0`, `"true"`/`"false"`

**Example:**
```yaml
- name: "verbose"
  type: "bool"
  description: "Enable verbose output"
  required: false
  default: false
  flag: "-v"
  format: "flag"
```

### String Type (`string`)

Most common parameter type; supports any string value.

### Integer Type (`int` / `integer`)

Used for numeric parameters such as port numbers and levels.

**Example:**
```yaml
- name: "level"
  type: "int"
  description: "Test level, range 1-5"
  required: false
  default: 3
  flag: "--level"
  format: "combined"  # --level=3
```

### Array Type (`array`)

Arrays are automatically converted to comma-separated strings.

**Example:**
```yaml
- name: "ports"
  type: "array"
  description: "List of ports"
  required: false
  # Input:  [80, 443, 8080]
  # Output: "80,443,8080"
```

## Examples

Refer to existing tool configuration files in the `tools/` directory:

- `nmap.yaml`: Network scanning tool (includes `scan_type` and `additional_args` examples)
- `sqlmap.yaml`: SQL injection detection tool (includes `additional_args` examples)
- `nikto.yaml`: Web server scanning tool
- `dirb.yaml`: Web directory scanning tool
- `exec.yaml`: System command execution tool

### Full Example: nmap Tool Configuration

```yaml
name: "nmap"
command: "nmap"
args: ["-sT", "-sV", "-sC"]  # Default scan type
enabled: true

short_description: "Network scanner for discovering hosts, open ports, and services"

description: |
  Network mapping and port scanning tool for discovering hosts, services, and open ports.

  **Key features:**
  - Host discovery: detect active hosts on the network
  - Port scanning: identify open ports on target hosts
  - Service identification: detect service types and versions running on ports
  - OS detection: identify the operating system of target hosts
  - Vulnerability detection: use NSE scripts to detect common vulnerabilities

parameters:
  - name: "target"
    type: "string"
    description: "Target IP address or domain name"
    required: true
    position: 0
    format: "positional"

  - name: "ports"
    type: "string"
    description: "Port range, e.g.: 1-1000"
    required: false
    flag: "-p"
    format: "flag"

  - name: "scan_type"
    type: "string"
    description: "Scan type options, e.g.: '-sV -sC'"
    required: false
    format: "positional"

  - name: "additional_args"
    type: "string"
    description: "Additional Nmap arguments, e.g.: '--script vuln -O'"
    required: false
    format: "positional"
```

## Adding a New Tool

To add a new tool, create a new YAML file in the `tools/` directory, e.g., `my_tool.yaml`:

```yaml
name: "my_tool"
command: "my-command"
args: ["--default-arg"]  # Fixed arguments (optional)
enabled: true

# Short description (recommended) — used in the tool list to reduce token usage
short_description: "One-line summary of the tool's purpose"

# Detailed description — used for tool documentation and AI comprehension
description: |
  Detailed tool description; supports multi-line text and Markdown.

  **Key features:**
  - Feature 1
  - Feature 2

  **Use cases:**
  - Use case 1
  - Use case 2

  **Notes:**
  - Usage considerations
  - Permission requirements
  - Performance impact

parameters:
  - name: "target"
    type: "string"
    description: |
      Detailed target parameter description.

      **Example values:**
      - "value1"
      - "value2"

      **Notes:**
      - Format requirements
      - Usage restrictions
    required: true
    position: 0
    format: "positional"

  - name: "option"
    type: "string"
    description: "Option parameter description"
    required: false
    flag: "--option"
    format: "flag"

  - name: "verbose"
    type: "bool"
    description: "Enable verbose output"
    required: false
    default: false
    flag: "-v"
    format: "flag"

  - name: "additional_args"
    type: "string"
    description: "Additional tool arguments, separated by spaces"
    required: false
    format: "positional"
```

After saving the file, restart the server to auto-load the new tool.

### Tool Configuration Best Practices

1. **Parameter design**
   - Define common parameters explicitly so AI can understand and use them.
   - Use `additional_args` to provide flexibility for advanced usage.
   - Provide clear descriptions and examples for each parameter.

2. **Description optimization**
   - Use `short_description` to reduce token usage.
   - Make `description` detailed to help AI understand the tool's purpose.
   - Use Markdown formatting for readability.

3. **Default values**
   - Set sensible defaults for common parameters.
   - Boolean defaults are usually `false`.
   - Numeric defaults should reflect the tool's typical behavior.

4. **Parameter validation**
   - Clearly state format requirements in descriptions.
   - Provide multiple example values.
   - Document restrictions and notes.

5. **Security**
   - Add warnings in descriptions for dangerous operations.
   - Document permission requirements.
   - Remind users to run only in authorized environments.

## Disabling a Tool

To disable a tool, set the `enabled` field to `false` in its configuration file, or delete/rename the file.

Once disabled, the tool will not appear in the tool list and cannot be called by AI.

## Tool Configuration Validation

The system performs basic validation when loading tool configurations:

- ✅ Checks required fields (`name`, `command`, `enabled`)
- ✅ Validates parameter definition format
- ✅ Checks that parameter types are supported

If the configuration is invalid, the system logs a warning at startup but does not prevent the server from starting. Invalid tool configurations are skipped; all other tools remain functional.

## FAQ

### Q: How do I pass multiple parameter values?

A: For array-type parameters, the system automatically converts them to comma-separated strings. To pass multiple independent arguments, use the `additional_args` parameter.

### Q: How do I override a tool's default arguments?

A: Some tools (e.g., `nmap`) support the `scan_type` parameter to override the default scan type. For other cases, use `additional_args`.

### Q: What do I do if a tool execution fails?

A: Check the following:
1. Is the tool installed and in the system PATH?
2. Is the tool configuration correct?
3. Do the parameter formats meet requirements?
4. Check the server logs for detailed error information.

### Q: How do I test a tool configuration?

A: Use `cmd/test-config/main.go` to test configuration loading:
```bash
go run cmd/test-config/main.go
```

### Q: How do I control parameter order?

A: Use the `position` field to control the order of positional parameters. **The parameter at position 0 (e.g., gobuster's `dir` subcommand) is placed immediately after the command name, before all flag parameters**, for compatibility with CLIs that require a "subcommand + options" form. Other flag parameters are added in the order they appear in the `parameters` list, followed by positional parameters at positions 1, 2, … . `additional_args` is always appended at the end.

## Tool Configuration Templates

### Basic Tool Template

```yaml
name: "tool_name"
command: "command"
enabled: true

short_description: "Short description (20-50 characters)"

description: |
  Detailed description covering tool functionality, use cases, and notes.

parameters:
  - name: "target"
    type: "string"
    description: "Target parameter description"
    required: true
    position: 0
    format: "positional"

  - name: "additional_args"
    type: "string"
    description: "Additional tool arguments"
    required: false
    format: "positional"
```

### Tool Template with Flag Parameters

```yaml
name: "tool_name"
command: "command"
enabled: true

short_description: "Short description"

description: |
  Detailed description.

parameters:
  - name: "target"
    type: "string"
    description: "Target"
    required: true
    flag: "-t"
    format: "flag"

  - name: "option"
    type: "bool"
    description: "Option"
    required: false
    default: false
    flag: "--option"
    format: "flag"

  - name: "level"
    type: "int"
    description: "Level"
    required: false
    default: 3
    flag: "--level"
    format: "combined"

  - name: "additional_args"
    type: "string"
    description: "Additional arguments"
    required: false
    format: "positional"
```

## Related Documentation

- Main project README: See `README.md` for complete project documentation.
- Tool list: Browse the `tools/` directory for all tool configuration files.
- API documentation: See the API section in the main README.
