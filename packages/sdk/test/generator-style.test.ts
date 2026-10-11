// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { styleSvg } from "../src/generator";

describe("styleSvg original fill mapping", () => {
  it.each([
    ["#FFFFFF", "#ffffff"],
    ["#FFFFFF", "#FFFFFF"],
    ["#ffffff", "#ffffff"],
    ["#ffffff", "#FFFFFF"],
  ])("keeps white bars with original background %s and foreground %s", (originalWhite, foreground) => {
    const svg = `<svg width="2" height="1"><rect id="background" fill="${originalWhite}"/><path id="bars" fill="#000000"/></svg>`;

    const styled = styleSvg(svg, foreground, "#000000");

    expect(styled).toContain('<rect id="background" fill="#000000"/>');
    expect(styled).toContain(`<path id="bars" fill="${foreground}"/>`);
  });

  it.each(["transparent", "none"])("preserves inserted white foreground with %s background", (background) => {
    const svg = '<svg width="2" height="1"><rect id="background" fill="#FFFFFF"/><path id="bars" fill="#000000"/></svg>';

    const styled = styleSvg(svg, "#FFFFFF", background);

    expect(styled).toContain('<rect id="background" fill="none"/>');
    expect(styled).toContain('<path id="bars" fill="#FFFFFF"/>');
  });
});
