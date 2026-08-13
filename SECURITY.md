# Security Policy

## Supported version

Security fixes are provided for the latest published release.

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/Earr22/agent-island/security/advisories/new) to report vulnerabilities privately. Do not include secrets, private prompts, clipboard contents, notification text, local paths, or personal information in a public issue.

Include the affected version, reproduction steps, expected impact, and any safe proof of concept. You should receive an initial acknowledgement within seven days. Please allow time for investigation and a coordinated fix before public disclosure.

## Scope notes

Agent Island exposes a loopback-only HTTP API. Reports involving access from another local process should explain the crossed trust boundary and resulting impact. The project does not claim to isolate mutually untrusted programs running under the same Windows user account.
