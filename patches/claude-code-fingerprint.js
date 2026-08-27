// Claude Code request-body fingerprint, captured from a real claude-cli 2.1.241
// run against the same relay. anyrouter-family gateways gate /v1/messages on
// three things, each confirmed by ablation against a live route:
//
//   metadata.user_id  must be a JSON string carrying device_id   (else 503)
//   system            must contain the client-identity block     (else 503)
//   tools             must contain these tools BY NAME           (else 429)
//
// The tool set below is the minimum that passes: Glob, Grep, Read. It is
// deliberately read-only — a model that reaches for one of these sentinels at
// worst attempts a search DSH cannot run, rather than executing a command or
// editing a file. Any two of them fail, and 16 low-traffic tools (CronCreate,
// DesignSync, …) fail as well, so the gate is on these names, not on a count.
//
// What the relay checks, measured: renaming the tools drops the request to 429,
// but replacing their descriptions with same-length filler still returns 200.
// So the NAMES carry the fingerprint and the descriptions do not — meaning a
// Claude Code release that only rewords these tools does NOT invalidate this
// file. The verbatim descriptions are kept anyway: they cost ~5 KB per request,
// they are what a real client sends, and a relay that starts checking them
// would otherwise fail in a way that reads exactly like a busy gateway.
//
// Re-capture if Claude Code renames or drops Glob/Grep/Read. To check a relay
// against the current file: node test/body-fingerprint-probe.mjs --host <relay>

module.exports = {
  "capturedFrom": "claude-cli/2.1.241 (external, sdk-cli)",
  "identitySystemBlock": "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
  "billingSystemBlock": "x-anthropic-billing-header: cc_version=2.1.241.dda; cc_entrypoint=sdk-cli;",
  "sentinelTools": [
    {
      "name": "Glob",
      "description": "Fast file pattern matching. Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\". Returns matching file paths sorted by modification time.",
      "input_schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "pattern": {
            "description": "The glob pattern to match files against",
            "type": "string"
          },
          "path": {
            "description": "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided.",
            "type": "string"
          }
        },
        "required": [
          "pattern"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "Grep",
      "description": "Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash — results integrate with the permission UI and file links.\n\n- Full regex syntax (e.g. \"log.*Error\", \"function\\s+\\w+\"). Ripgrep, not grep — escape literal braces (`interface\\{\\}`).\n- Filter with `glob` (e.g. \"**/*.tsx\") or `type` (e.g. \"js\", \"py\", \"rust\").\n- `output_mode`: \"content\" (matching lines), \"files_with_matches\" (paths only, default), or \"count\".\n- `multiline: true` for patterns that span lines.",
      "input_schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "pattern": {
            "description": "The regular expression pattern to search for in file contents",
            "type": "string"
          },
          "path": {
            "description": "File or directory to search in (rg PATH). Defaults to current working directory.",
            "type": "string"
          },
          "glob": {
            "description": "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob",
            "type": "string"
          },
          "output_mode": {
            "description": "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"files_with_matches\".",
            "type": "string",
            "enum": [
              "content",
              "files_with_matches",
              "count"
            ]
          },
          "-B": {
            "description": "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise.",
            "type": "number"
          },
          "-A": {
            "description": "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise.",
            "type": "number"
          },
          "-C": {
            "description": "Alias for context.",
            "type": "number"
          },
          "context": {
            "description": "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise.",
            "type": "number"
          },
          "-n": {
            "description": "Show line numbers in output (rg -n). Requires output_mode: \"content\", ignored otherwise. Defaults to true.",
            "type": "boolean"
          },
          "-i": {
            "description": "Case insensitive search (rg -i)",
            "type": "boolean"
          },
          "-o": {
            "description": "Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). Requires output_mode: \"content\", ignored otherwise. Defaults to false.",
            "type": "boolean"
          },
          "type": {
            "description": "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
            "type": "string"
          },
          "head_limit": {
            "description": "Limit output to first N lines/entries, equivalent to \"| head -N\". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context).",
            "type": "number"
          },
          "offset": {
            "description": "Skip first N lines/entries before applying head_limit, equivalent to \"| tail -n +N | head -N\". Works across all output modes. Defaults to 0.",
            "type": "number"
          },
          "multiline": {
            "description": "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
            "type": "boolean"
          }
        },
        "required": [
          "pattern"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "Read",
      "description": "Reads a file from the local filesystem.\n\n- `file_path` must be an absolute path.\n- Reads up to 2000 lines by default.\n- When you already know which part of the file you need, only read that part. This can be important for larger files.\n- Results are returned using cat -n format, with line numbers starting at 1\n- Reads images (PNG, JPG, …) and presents them visually. Reads PDFs via the `pages` parameter (e.g. \"1-5\", max 20 pages/request; required for PDFs over 10 pages). Reads Jupyter notebooks (.ipynb) as cells with outputs.\n- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.\n- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.",
      "input_schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "file_path": {
            "description": "The absolute path to the file to read",
            "type": "string"
          },
          "offset": {
            "description": "The line number to start reading from. Only provide if the file is too large to read at once",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "limit": {
            "description": "The number of lines to read. Only provide if the file is too large to read at once.",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "pages": {
            "description": "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request.",
            "type": "string"
          }
        },
        "required": [
          "file_path"
        ],
        "additionalProperties": false
      }
    }
  ]
};
