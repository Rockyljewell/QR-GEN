import { GITHUB } from "./site";

export interface NavLink {
  label: string;
  href: string;
  desc?: string;
  external?: boolean;
}
export interface NavColumn {
  title: string;
  links: NavLink[];
}
export interface NavItem {
  label: string;
  columns: NavColumn[];
  feature: { title: string; text: string; code?: string; href: string; cta: string };
}

export const NAV: NavItem[] = [
  {
    label: "Products",
    columns: [
      {
        title: "Core capabilities",
        links: [
          { label: "Barcode Scanning", href: "/products/barcode-scanning/", desc: "40+ symbologies, one API" },
          { label: "Batch Scanning", href: "/products/batch-scanning/", desc: "Track many codes at once with AR highlights" },
          { label: "ID Scanning", href: "/products/id-scanning/", desc: "Read driver licenses and verify age" },
          { label: "Barcode Generator", href: "/products/barcode-generator/", desc: "Create print-ready codes" },
        ],
      },
      {
        title: "Pre-built components",
        links: [
          { label: "Scanner UI", href: "/docs/web-components/", desc: "Drop-in <qrgen-scanner> element" },
          { label: "Embedded scanner", href: "/docs/embed-bridge/", desc: "Hosted scanner for any WebView" },
          { label: "REST API & Docker", href: "/docs/rest-api/", desc: "Scan and generate from any language" },
        ],
      },
      {
        title: "Try it",
        links: [
          { label: "Live demo", href: "/demo/", desc: "Scan with your camera right now" },
          { label: "Generate a code", href: "/demo/#generate", desc: "QR, Data Matrix, EAN, GS1…" },
          { label: "Pricing", href: "/pricing/", desc: "Free and open source" },
        ],
      },
    ],
    feature: {
      title: "See it in your browser",
      text: "Open the demo on your phone and scan any product, label or QR code. Everything runs on your device.",
      href: "/demo/",
      cta: "Open the live demo",
    },
  },
  {
    label: "Solutions",
    columns: [
      {
        title: "Industries",
        links: [
          { label: "Retail", href: "/solutions/#retail", desc: "Shelf, self-checkout, click & collect" },
          { label: "Logistics & Post", href: "/solutions/#logistics", desc: "Parcels, proof of delivery" },
          { label: "Healthcare", href: "/solutions/#healthcare", desc: "Medication and specimen tracking" },
          { label: "Manufacturing", href: "/solutions/#manufacturing", desc: "Parts, DPM codes, traceability" },
          { label: "Events & Ticketing", href: "/solutions/#events", desc: "Fast entry and check-in" },
        ],
      },
      {
        title: "Use cases",
        links: [
          { label: "Inventory counting", href: "/products/batch-scanning/", desc: "Count shelves in seconds" },
          { label: "Age verification", href: "/products/id-scanning/", desc: "Read licenses on-device" },
          { label: "Asset tracking", href: "/solutions/#manufacturing", desc: "Label and follow equipment" },
          { label: "Ticket validation", href: "/solutions/#events", desc: "Validate QR and Aztec tickets" },
        ],
      },
    ],
    feature: {
      title: "Built for real workflows",
      text: "GS1 parsing, duplicate filtering, batch tracking and ID parsing come built in, so you ship features, not plumbing.",
      href: "/solutions/",
      cta: "Explore solutions",
    },
  },
  {
    label: "Developers",
    columns: [
      {
        title: "Documentation",
        links: [
          { label: "Quick start", href: "/docs/quick-start/", desc: "Scanning in five minutes" },
          { label: "API reference", href: "/docs/api/", desc: "Every export, typed" },
          { label: "Symbologies", href: "/docs/symbologies/", desc: "What can be read and written" },
          { label: "All docs", href: "/docs/", desc: "Guides for every platform" },
        ],
      },
      {
        title: "SDKs",
        links: [
          { label: "SDK & Frameworks", href: "/sdk/", desc: "iOS, Android, Web, React Native, Flutter…" },
          { label: "JavaScript", href: "/docs/javascript/" },
          { label: "iOS (Swift)", href: "/docs/ios/" },
          { label: "Android (Kotlin)", href: "/docs/android/" },
        ],
      },
      {
        title: "Tools & resources",
        links: [
          { label: "Agent Skills", href: "/agent-skills/", desc: "Let your coding agent integrate QRGen" },
          { label: "CLI", href: "/docs/cli/", desc: "npx qrgen scan label.png" },
          { label: "GitHub", href: GITHUB.url, desc: "Source, issues and releases", external: true },
        ],
      },
    ],
    feature: {
      title: "Agent Skills",
      text: "Give Claude Code, Cursor, Codex and other agents everything they need to add scanning to your app.",
      code: "npx skills add https://github.com/Rockyljewell/QR-GEN",
      href: "/agent-skills/",
      cta: "Get Agent Skills",
    },
  },
  {
    label: "Resources",
    columns: [
      {
        title: "Learn",
        links: [
          { label: "Guides", href: "/docs/", desc: "Step-by-step integration guides" },
          { label: "Troubleshooting", href: "/docs/troubleshooting/", desc: "Camera, performance, CSP" },
          { label: "FAQ", href: "/docs/faq/" },
          { label: "Migration guides", href: "/docs/migration/", desc: "From html5-qrcode, ZXing, Quagga…" },
        ],
      },
      {
        title: "Community",
        links: [
          { label: "Discussions", href: GITHUB.discussions, external: true },
          { label: "Report an issue", href: GITHUB.issues, external: true },
          { label: "Releases", href: `${GITHUB.url}/releases`, external: true },
          { label: "llms.txt", href: "/llms.txt", desc: "Docs for AI assistants" },
        ],
      },
    ],
    feature: {
      title: "Docs your agent can read",
      text: "Every page is available as plain text for LLMs at /llms-full.txt, so assistants answer from the real API.",
      href: "/llms-full.txt",
      cta: "Open llms-full.txt",
    },
  },
  {
    label: "About",
    columns: [
      {
        title: "Company",
        links: [
          { label: "About QRGen", href: "/about/", desc: "Mission and principles" },
          { label: "Why open source", href: "/about/#open-source" },
          { label: "Privacy & security", href: "/about/#privacy" },
          { label: "Contribute", href: `${GITHUB.url}/blob/main/CONTRIBUTING.md`, external: true },
        ],
      },
    ],
    feature: {
      title: "Open source, forever",
      text: "No license keys, no per-scan fees, no telemetry. Fork it, ship it, sell it.",
      href: "/pricing/",
      cta: "See pricing",
    },
  },
];

export const FOOTER: NavColumn[] = [
  {
    title: "Products",
    links: [
      { label: "Barcode Scanning", href: "/products/barcode-scanning/" },
      { label: "Batch Scanning", href: "/products/batch-scanning/" },
      { label: "ID Scanning", href: "/products/id-scanning/" },
      { label: "Barcode Generator", href: "/products/barcode-generator/" },
      { label: "Scanner UI", href: "/docs/web-components/" },
      { label: "REST API", href: "/docs/rest-api/" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Live demo", href: "/demo/" },
      { label: "Quick start", href: "/docs/quick-start/" },
      { label: "Agent Skills", href: "/agent-skills/" },
      { label: "Pricing", href: "/pricing/" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Retail", href: "/solutions/#retail" },
      { label: "Logistics & Post", href: "/solutions/#logistics" },
      { label: "Healthcare", href: "/solutions/#healthcare" },
      { label: "Manufacturing", href: "/solutions/#manufacturing" },
      { label: "Events & Ticketing", href: "/solutions/#events" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Documentation", href: "/docs/" },
      { label: "SDK & Frameworks", href: "/sdk/" },
      { label: "API reference", href: "/docs/api/" },
      { label: "CLI", href: "/docs/cli/" },
      { label: "Symbologies", href: "/docs/symbologies/" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Troubleshooting", href: "/docs/troubleshooting/" },
      { label: "FAQ", href: "/docs/faq/" },
      { label: "Migration guides", href: "/docs/migration/" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB.url, external: true },
      { label: "Discussions", href: GITHUB.discussions, external: true },
      { label: "Issues", href: GITHUB.issues, external: true },
      { label: "About", href: "/about/" },
      { label: "Credit QRGen", href: "/docs/credit/" },
    ],
  },
];
