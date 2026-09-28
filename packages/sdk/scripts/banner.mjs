// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

// Legal comment at the top of every JS output (tsup.config.ts, build-worker.mjs, postbuild.mjs).
// `/*!` comments survive minification.
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const BANNER = `/*! QRGen v${version} | (c) 2026 Rockyljewell | Apache-2.0 | https://github.com/Rockyljewell/QR-GEN */`;
