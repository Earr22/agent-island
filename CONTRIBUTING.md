# Contributing

Thanks for helping improve Agent Island.

## Before opening an issue

- Search existing Issues and Discussions.
- Remove private prompts, clipboard data, notification content, usernames, local paths, tokens, and screenshots containing personal information.
- Use GitHub Security Advisories for vulnerabilities.

## Development

Requirements: Windows 10 or 11, Node.js 20 or newer.

```powershell
npm ci
npm run check
npm test
npm start
```

Keep changes focused. Add or update tests for behavior changes. Preserve the local-first model: no telemetry, remote logging, or new outbound data flow without an explicit design discussion and user control.

## Pull requests

Describe the problem, the change, privacy or security impact, and how you verified it. UI changes should include a synthetic-data screenshot that contains no private desktop content.

By submitting a contribution, you agree that it may be distributed under the MIT License.
