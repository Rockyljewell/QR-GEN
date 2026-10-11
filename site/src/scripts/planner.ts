import { buildUrlPayload, buildWifiPayload, getRuntimeCapabilities, planQRCode, scanImage, type QRCodeEcLevel, type QRCodePlan } from "qrgen-sdk";

const form = document.querySelector<HTMLFormElement>("[data-plan-form]")!;
const get = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
const status = get<HTMLElement>("[data-plan-status]");
const error = get<HTMLElement>("[data-plan-error]");
const preview = get<HTMLElement>("[data-plan-preview]");
const geometry = get<HTMLElement>("[data-plan-geometry]");
const payloadText = get<HTMLElement>("[data-plan-payload]");
const verification = get<HTMLElement>("[data-plan-verification]");
const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-plan-download], [data-plan-verify]")];
let revision = 0;
let current: { plan: Extract<QRCodePlan, { suitable: true }>; payload: string } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

form.addEventListener("submit", (event) => event.preventDefault());

function syncFields(): void {
  const kind = input("kind").value;
  const wifi = kind === "wifi";
  get<HTMLElement>("[data-content-field]").hidden = wifi;
  input("content").disabled = wifi;
  const wifiFields = get<HTMLFieldSetElement>("[data-wifi-fields]");
  wifiFields.hidden = !wifi;
  wifiFields.disabled = !wifi;
  get<HTMLElement>("[data-content-label]").textContent = kind === "url" ? "Website address" : "Text to share";
  get<HTMLElement>("[data-content-help]").textContent = kind === "url" ? "Use a complete address starting with https:// or http://." : "Text is encoded exactly as entered, including spaces and new lines.";
  const open = input("security").value === "nopass";
  get<HTMLElement>("[data-password-field]").hidden = open;
  input("password").disabled = !wifi || open;
  if (open) input("password").value = "";
}

function payload(): string {
  switch (input("kind").value) {
    case "url": return buildUrlPayload(input("content").value);
    case "wifi": return buildWifiPayload({
      ssid: input("ssid").value,
      authentication: input("security").value as "WPA" | "WEP" | "nopass",
      password: input("password").value,
      hidden: input("hiddenNetwork").checked,
    });
    default: return input("content").value;
  }
}

// Invalidate synchronously, including during the debounce window. A previous
// valid code must never be downloadable under newly entered content or settings.
function invalidate(): number {
  revision++;
  current = null;
  buttons.forEach((button) => (button.disabled = true));
  error.hidden = true;
  preview.replaceChildren();
  geometry.textContent = "";
  payloadText.textContent = "";
  verification.textContent = "";
  status.textContent = "Preparing your code…";
  return revision;
}

async function render(seq: number): Promise<void> {
  try {
    const data = payload();
    const plan = await planQRCode(data, {
      widthMm: Number(input("widthMm").value),
      dpi: Number(input("dpi").value),
      minDotsPerModule: Number(input("minDots").value),
      ecLevel: input("ecLevel").value as QRCodeEcLevel | "auto",
    });
    if (seq !== revision) return;
    payloadText.textContent = data;
    if (!plan.suitable) {
      status.textContent = "This content needs more space for the selected print profile.";
      error.hidden = false;
      error.textContent = plan.diagnostics.find((item) => item.severity === "error")?.message ?? "Try a wider code or less content.";
      return;
    }
    current = { plan, payload: data };
    // SVG comes from the standard QR encoder, never from the payload text.
    preview.innerHTML = plan.barcode.svg;
    const svg = preview.querySelector("svg")!;
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code for the content shown below");
    const g = plan.geometry;
    geometry.textContent = `${g.widthMm.toFixed(2)} mm at ${plan.target.dpi} DPI · ${g.widthDots} × ${g.widthDots} pixels · ${g.dotsPerModule} dots per module · correction ${plan.ecLevel}`;
    status.textContent = "Fits the selected print profile. Check the exported file, then test a printed sample.";
    buttons.forEach((button) => (button.disabled = false));
    if (!plan.barcode.png) {
      get<HTMLButtonElement>('[data-plan-download="png"]').disabled = true;
      get<HTMLButtonElement>("[data-plan-verify]").disabled = true;
      verification.textContent = "This browser could not produce a PNG. The print SVG is available.";
    }
  } catch (cause) {
    if (seq !== revision) return;
    status.textContent = "Update the details to make your code.";
    error.hidden = false;
    error.textContent = cause instanceof Error ? cause.message : String(cause);
  }
}

form.addEventListener("input", () => {
  clearTimeout(timer);
  syncFields();
  const seq = invalidate();
  timer = setTimeout(() => void render(seq), 160);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-plan-download]")) {
  button.addEventListener("click", () => {
    if (!current) return;
    const svg = button.dataset.planDownload === "svg";
    const blob = svg ? new Blob([current.plan.printSvg], { type: "image/svg+xml" }) : current.plan.barcode.png;
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `qrgen-${current.plan.geometry.widthMm.toFixed(2)}mm-${current.plan.target.dpi}dpi.${svg ? "svg" : "png"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  });
}

get<HTMLButtonElement>("[data-plan-verify]").addEventListener("click", async (event) => {
  const saved = current;
  const seq = revision;
  if (!saved?.plan.barcode.png) return;
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  verification.textContent = "Reading the exported PNG…";
  try {
    const found = await scanImage(saved.plan.barcode.png, { symbologies: ["qr"] });
    if (seq !== revision || current !== saved) return;
    verification.textContent = found.length === 1 && found[0]!.data === saved.payload
      ? "Export checked: the PNG reads back to exactly the content above. Printed samples still need testing."
      : "The exported PNG did not read back to exactly the expected content. Try a larger code and check again.";
  } catch (cause) {
    if (seq !== revision || current !== saved) return;
    verification.textContent = `Could not check the export: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    if (seq === revision && current === saved) button.disabled = false;
  }
});

const capabilities = getRuntimeCapabilities();
get<HTMLElement>("[data-plan-capability]").textContent = !capabilities.engine.webAssembly
  ? "This browser does not expose WebAssembly, which QR creation requires. Try a current browser."
  : capabilities.camera.status === "available"
    ? "Camera scanning is available to try in the demo. Creating codes here does not request camera access."
    : "No camera is needed to create codes or check their exported image here.";
syncFields();
void render(invalidate());
