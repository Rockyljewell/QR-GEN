// Central brand + URL config. Rename the project here.
export const BRAND = {
  name: "QRGen",
  wordmark: "QRGEN",
  tagline: "Open-source smart data capture",
  description:
    "QRGen is an open-source barcode, QR code and ID scanning SDK for web, iOS, Android, React Native, Flutter, .NET, Node.js and Python, with pre-built scanning UI, batch scanning, a barcode generator and Agent Skills for coding agents.",
};

/** The project's creator, credited in the footer, about page and NOTICE. */
export const AUTHOR = {
  name: "Rockyljewell",
  url: "https://github.com/Rockyljewell",
};

export const GITHUB = {
  owner: "Rockyljewell",
  repo: "QR-GEN",
  url: "https://github.com/Rockyljewell/QR-GEN",
  issues: "https://github.com/Rockyljewell/QR-GEN/issues",
  discussions: "https://github.com/Rockyljewell/QR-GEN/discussions",
};

export const SITE_URL = "https://rockyljewell.github.io/QR-GEN/";
export const NPM_PACKAGE = "qrgen-sdk";
export const PYPI_PACKAGE = "qrgen-sdk";
export const SKILLS_REPO = "https://github.com/Rockyljewell/QR-GEN";
export const MARKETPLACE = "Rockyljewell/QR-GEN";
export const PLUGIN = "qrgen-sdk@qrgen-plugins";
/** Tarball of the current SDK build, hosted with the site (works before the npm release). */
export const TARBALL_URL = `${SITE_URL}downloads/qrgen-sdk.tgz`;
export const CDN_ESM = `${SITE_URL}sdk/qrgen.js`;
export const CDN_IIFE = `${SITE_URL}sdk/qrgen.iife.js`;

/** Prefix an internal path with the configured base. */
export function url(path = ""): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
