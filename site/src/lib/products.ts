// Product page content for /products/[slug]/.
export interface Product {
  slug: string;
  tag: string;
  title: string;
  lead: string;
  demo: string;
  docs: string;
  visual: "scanner" | "batch" | "id" | "generator";
  features: { icon: string; title: string; text: string }[];
  code: { label: string; lang: string; code: string; icon?: string }[];
  uses: string[];
  specTitle: string;
  specs: [string, string][];
}

export const PRODUCTS: Product[] = [
  {
    slug: "barcode-scanning",
    tag: "Barcode Scanning",
    title: "Read any barcode, fast, on any device",
    lead: "26 symbologies with one API and a pre-built scanning UI. Decoding runs in a Web Worker on the web and on Apple Vision or ML Kit natively, and nothing leaves the device.",
    demo: "/demo/",
    docs: "/docs/barcode-scanning/",
    visual: "scanner",
    features: [
      { icon: "scan", title: "Pre-built UI", text: "Viewfinder, highlights, success toast, torch, zoom and camera switching in one element." },
      { icon: "bolt", title: "Off the main thread", text: "Frames are decoded in a Web Worker with WebAssembly, so your UI stays at 60 fps." },
      { icon: "layers", title: "Smart duplicate filter", text: "Report every frame, once per second, or once per session, with no custom debounce code." },
      { icon: "grid", title: "Region of interest", text: "Decode only what's inside the viewfinder, which is faster and avoids stray reads." },
      { icon: "shield", title: "Private by default", text: "Camera frames never leave the device, and there is no telemetry." },
      { icon: "code", title: "Typed results", text: "The same Barcode object on every platform, with GS1 in human-readable form." },
    ],
    code: [
      { label: "HTML", icon: "js", lang: "html", code: `<qrgen-scanner symbologies="qr,ean13,code128" mode="continuous"></qrgen-scanner>\n<script type="module">\n  import "qrgen-sdk/elements";\n  document.querySelector("qrgen-scanner").addEventListener("scan", (e) => {\n    for (const b of e.detail.barcodes) console.log(b.symbologyName, b.data);\n  });\n</script>` },
      { label: "Custom UI", icon: "code", lang: "ts", code: `import { BarcodeScanner } from "qrgen-sdk";\n\nconst scanner = new BarcodeScanner({ video, symbologies: ["retail"], duplicateFilter: 1500 });\nscanner.on("frame", ({ barcodes }) => drawBoxes(barcodes));\nscanner.on("scan", ({ barcodes }) => addToCart(barcodes[0].data));\nawait scanner.start();` },
    ],
    uses: ["Point-of-sale and self-checkout", "Price checks and product lookup", "Ticket and boarding pass validation", "Asset and equipment tracking", "Healthcare medication checks", "Warehouse receiving"],
    specTitle: "Supported symbologies",
    specs: [
      ["2D", "QR, Micro QR, rMQR, Data Matrix, Aztec, PDF417, MicroPDF417, MaxiCode"],
      ["Retail", "EAN-13, EAN-8, UPC-A, UPC-E, ISBN, GS1 DataBar (Omni, Limited, Expanded)"],
      ["Industrial", "Code 128 / GS1-128, Code 39, Code 93, Codabar, ITF, ITF-14"],
      ["Specialty", "Code 32, PZN, Telepen, DX Film Edge"],
    ],
  },
  {
    slug: "batch-scanning",
    tag: "Batch Scanning",
    title: "Scan a whole shelf in one sweep",
    lead: "Track dozens of barcodes in a single camera frame, with AR highlights on each one. Count inventory, receive pallets, find items and let users tap to select.",
    demo: "/demo/",
    docs: "/docs/batch-scanning/",
    visual: "batch",
    features: [
      { icon: "grid", title: "Up to 20 codes per frame", text: "Configurable with maxResults, and every code gets its own highlight." },
      { icon: "layers", title: "Stable tracking", text: "Each code keeps its id across frames. Identical products in different spots are counted separately." },
      { icon: "check", title: "Tap to select", text: "Built-in selection with a select event and a selection list, for picking and verification flows." },
      { icon: "bolt", title: "Tuned for many codes", text: "Full-frame decoding and try-harder mode find codes anywhere in the image." },
      { icon: "code", title: "Bring your own UI", text: "BarcodeTracker and the track event give you coordinates to draw your own AR overlay." },
      { icon: "box", title: "Everywhere", text: "Batch mode works the same on the web, iOS, Android, React Native, Flutter and Python." },
    ],
    code: [
      { label: "Count items", icon: "js", lang: "html", code: `<qrgen-scanner mode="batch" symbologies="retail"></qrgen-scanner>\n<script type="module">\n  import "qrgen-sdk/elements";\n  const el = document.querySelector("qrgen-scanner");\n  el.addEventListener("track", (e) => {\n    counter.textContent = \`\${e.detail.tracked.length} items in view\`;\n  });\n  el.addEventListener("select", (e) => console.log(e.detail.selection));\n</script>` },
      { label: "React", icon: "react", lang: "tsx", code: `<QRGenScanner\n  mode="batch"\n  symbologies={["retail", "code128"]}\n  onTrack={({ tracked }) => setInView(tracked.length)}\n  onSelect={({ selection }) => setPicked(selection)}\n/>` },
    ],
    uses: ["Shelf audits and cycle counts", "Receiving mixed pallets", "Order picking with verification", "Finding a specific parcel in a stack", "Library and archive inventory", "Lab sample racks"],
    specTitle: "How tracking works",
    specs: [
      ["Matching", "Same symbology and data, nearest position (so duplicates stay separate)"],
      ["Lifetime", "Tracks are dropped 500 ms after they leave the view"],
      ["Events", "track: { tracked, added, removed } · scan: new unique codes · select: tap"],
      ["Fields", "TrackedBarcode = Barcode + id, firstSeen, lastSeen, count"],
    ],
  },
  {
    slug: "id-scanning",
    tag: "ID Scanning",
    title: "Verify age and identity from a driver license",
    lead: "Read the PDF417 barcode on the back of North American driver licenses and ID cards, and get names, dates, address and an age check, all on the device.",
    demo: "/demo/",
    docs: "/docs/id-scanning/",
    visual: "id",
    features: [
      { icon: "id", title: "AAMVA versions 1–10", text: "Handles current and legacy name fields, US and Canadian date formats and ZIP+4." },
      { icon: "check", title: "Age checks built in", text: "age, isUnder21, isUnder18 and isExpired are computed for you, with an injectable clock for tests." },
      { icon: "lock", title: "Never leaves the phone", text: "Parsing is pure code on the device, with no network calls and no image uploads." },
      { icon: "scan", title: "Tuned viewfinder", text: "A wide, line-style viewfinder fits the long PDF417 on the back of the card." },
      { icon: "layers", title: "Every raw field", text: "Jurisdiction-specific elements are kept in fields, for example fields.ZCA." },
      { icon: "box", title: "Same parser everywhere", text: "parseAAMVA in JS, Swift, Kotlin, Python and C#." },
    ],
    code: [
      { label: "Age check", icon: "js", lang: "ts", code: `import "qrgen-sdk/elements";\nimport { parseAAMVA } from "qrgen-sdk/parsers";\n\nscanner.addEventListener("scan", (e) => {\n  const id = parseAAMVA(e.detail.barcode.data);\n  if (!id) return show("Not a driver license");\n  if (id.isExpired) return show("License expired");\n  show(id.isUnder21 ? "Under 21" : \`21+ verified (age \${id.age})\`);\n});` },
      { label: "Swift", icon: "apple", lang: "swift", code: `QRGenScannerView(options: .init(symbologies: ["pdf417"], mode: .single)) { barcodes in\n    if let id = QRGen.parseAAMVA(barcodes[0].data) {\n        print(id.fullName, id.isUnder21 ?? true)\n    }\n}` },
    ],
    uses: ["Age verification for alcohol, tobacco and cannabis", "Hotel and car rental check-in", "Visitor management", "KYC form prefill", "Event entry with ID checks", "Pharmacy pickups"],
    specTitle: "Parsed fields",
    specs: [
      ["Identity", "firstName, middleName, lastName, suffix, fullName, sex, documentNumber"],
      ["Dates", "dateOfBirth, issueDate, expiryDate (ISO), age, isExpired, isUnder21, isUnder18"],
      ["Address", "street, street2, city, state, postalCode, country"],
      ["Physical & license", "eyeColor, hairColor, height, weight, vehicleClass, restrictions, endorsements"],
    ],
  },
  {
    slug: "barcode-generator",
    tag: "Barcode Generator",
    title: "Create print-ready barcodes anywhere",
    lead: "Generate QR codes, Data Matrix, GS1-128, EAN/UPC and 20 more formats as crisp SVG or PNG, in the browser, in Node.js, from the command line, or over REST.",
    demo: "/demo/#generate",
    docs: "/docs/barcode-generation/",
    visual: "generator",
    features: [
      { icon: "wand", title: "26 formats", text: "From QR and Data Matrix to MaxiCode, DataBar Expanded and Telepen." },
      { icon: "layers", title: "GS1 encoding", text: "Pass (01)…(17)… element strings and get correct FNC1 encoding for GS1-128, Data Matrix and QR." },
      { icon: "image", title: "SVG, PNG, matrix", text: "Vector output for print, PNG for images, and the raw module matrix for custom rendering." },
      { icon: "sparkle", title: "Styling", text: "Colors, transparent backgrounds, human-readable text, quiet zones and rotation." },
      { icon: "check", title: "Validated", text: "Readable errors for bad input, such as letters in an EAN or the wrong length for a UPC." },
      { icon: "server", title: "Server-side too", text: "qrgen generate on the CLI, GET /v1/generate over REST, and Python and Swift APIs." },
    ],
    code: [
      { label: "JavaScript", icon: "js", lang: "ts", code: `import { generate } from "qrgen-sdk";\n\nconst { svg } = await generate("(01)09501101530003(17)271231(10)LOT4815", {\n  symbology: "data-matrix",\n  gs1: true,\n  scale: 6,\n});` },
      { label: "HTML", icon: "code", lang: "html", code: `<qrgen-barcode value="https://example.com" symbology="qr" ec-level="M" style="width:180px"></qrgen-barcode>\n<qrgen-barcode value="5901234123457" symbology="ean13" hrt></qrgen-barcode>` },
      { label: "CLI", icon: "terminal", lang: "bash", code: `npx qrgen generate "5901234123457" --symbology ean13 --hrt -o ean.svg\nnpx qrgen generate "WIFI:T:WPA;S:Cafe;P:espresso;;" -o wifi.png` },
    ],
    uses: ["Shipping and GS1 logistics labels", "Product packaging (EAN/UPC)", "Event tickets and boarding passes", "Wi-Fi, vCard and payment QR codes", "Asset tags and inventory labels", "Healthcare UDI labels"],
    specTitle: "Output options",
    specs: [
      ["Formats", "SVG (with viewBox), PNG, module matrix, terminal text"],
      ["QR options", "Error correction L/M/Q/H, version, quiet zone"],
      ["Linear options", "Human-readable text, module size, rotation"],
      ["Colors", "Any foreground/background, or a transparent background"],
    ],
  },
];

