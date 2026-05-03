# Security policy

## Supported versions

Only the latest minor version on the `main` branch receives security fixes. There are no LTS branches.

| Version | Supported |
|---------|-----------|
| 0.5.x   | ✅ |
| < 0.5   | ❌ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Use GitHub's [private vulnerability reporting](https://github.com/jazz1x/deps-finder/security/advisories/new) instead. You will receive an acknowledgement within 7 days.

If private reporting is unavailable, email the maintainer at the address listed in [package.json](package.json) `author`. Use a subject line starting with `[security]`.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a minimal proof of concept.
- The affected version and your environment (OS, Node.js version).

## Scope

deps-finder is a static-analysis CLI. It reads `package.json` and source files on the local machine and never sends data over the network. Reports of concern include:

- Code execution via crafted input files (malicious `package.json`, malformed source).
- Path traversal during glob / file read.
- Prototype pollution via parsed JSON.
- Dependency confusion or supply-chain issues affecting the published package.

Out of scope:

- Bugs without a security implication (use a regular GitHub issue).
- Vulnerabilities in dependencies that are already publicly disclosed and tracked by `npm audit` (open a regular issue if a fix needs prioritising).
