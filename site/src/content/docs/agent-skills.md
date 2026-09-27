---
title: Agent Skills
description: Install QRGen's Agent Skills so Claude Code, Cursor, Codex, Copilot and other coding agents can integrate barcode scanning correctly on the first try.
group: Get started
order: 4
badge: AI
status: stable
---

QRGen ships a set of [Agent Skills](https://github.com/Rockyljewell/QR-GEN/tree/main/skills). Skills are Markdown instructions that coding agents load when a task matches. They describe the real APIs, platform setup (permissions, HTTPS, SSR), common failures, and how to verify the result.

## Install

With the open [skills CLI](https://github.com/vercel-labs/skills), which works with Claude Code, Cursor, Codex, GitHub Copilot, Windsurf, Gemini CLI and other agents:

```bash
npx skills add https://github.com/Rockyljewell/QR-GEN
```

Useful flags: `--list` shows the skills without installing, `--skill qrgen-sdk` installs one skill, `-g` installs for your user instead of the project, and `-a claude-code` targets a specific agent.

As a Claude Code plugin:

```bash
/plugin marketplace add Rockyljewell/QR-GEN
/plugin install qrgen-sdk@qrgen-plugins
```

Update later with `npx skills update` or `/plugin marketplace update qrgen-plugins`.

## The skills

| Skill | Use it for |
| --- | --- |
| `qrgen-sdk` | Adding a scanner to any stack: web frameworks, Node, Python, iOS, Android, React Native, Flutter, .NET, hybrid apps, REST. Includes one reference file per platform. |
| `qrgen-barcode-generation` | Creating QR, Data Matrix, GS1-128, EAN and other barcodes as SVG/PNG, with printing guidance. |
| `qrgen-data-parsing` | Turning scan results into data: URLs, Wi-Fi, contacts, payments, GS1 AIs, driver licenses. |
| `qrgen-batch-scanning` | Counting or picking many codes at once with tracking and tap-to-select. |
| `qrgen-id-scanning` | Driver license parsing and age verification, with privacy guidance. |
| `qrgen-migration` | Replacing html5-qrcode, ZXing, QuaggaJS, BarcodeDetector or a commercial SDK. |
| `qrgen-testing` | Round-trip unit tests and camera-free Playwright tests with a fake webcam. |

## Without skills: the agent prompt

Paste the prompt from the [Agent Skills page](../../agent-skills/#prompt) into any assistant, or point it at the plain-text version:

```text
https://rockyljewell.github.io/QR-GEN/agent-prompt.txt
```

## Docs for LLMs

- [`/llms.txt`](../../llms.txt): an index of every page with one-line descriptions.
- [`/llms-full.txt`](../../llms-full.txt): all documentation in one plain-text file.
- Every docs page has a **Copy as Markdown** button.

## Writing good requests

Agents do best when you name the outcome and the constraints:

- "Add a QR scanner to the check-in screen. Single scan, then show the ticket details."
- "Let warehouse staff count items on a shelf. Batch mode, retail barcodes, export CSV."
- "Verify customers are 21+ by scanning the back of their license. Do not store personal data."
- "Replace html5-qrcode with QRGen and keep the existing result handler."

> **Tip:** Ask the agent to finish with the verification steps from the skill: build, type-check, a generate→scan round-trip test, and how to try it on a phone over HTTPS.
