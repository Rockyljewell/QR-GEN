# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/Rockyljewell/QR-GEN/security/advisories/new), not in public issues.
Include the affected package and version, a description of the impact, and steps to reproduce.
We aim to acknowledge reports within a week.

## Scope notes

- Scanned data is untrusted input. QRGen's parsers never execute content, but apps should validate
  URLs and payloads before acting on them (for example, show the domain before opening a scanned link).
- The SDKs process camera frames on-device and make no network requests other than loading their own
  assets (the WebAssembly engine, which can be self-hosted).
- The REST API has no authentication. Put it behind your own gateway or network controls when
  exposing it beyond localhost.
