import { generate, type GenerateOptions } from "../generator.js";

const Base = (typeof HTMLElement !== "undefined" ? HTMLElement : class {}) as typeof HTMLElement;

const BARCODE_CSS =
  ":host{display:inline-block;line-height:0}:host([hidden]){display:none}.w{width:100%;height:100%}svg{width:100%;height:100%;display:block;shape-rendering:crispEdges}.e{font:12px/1.4 ui-sans-serif,system-ui,sans-serif;color:#b42318;line-height:1.4}";

let sharedSheet: CSSStyleSheet | null | undefined;
function barcodeSheet(): CSSStyleSheet | null {
  if (sharedSheet !== undefined) return sharedSheet;
  try {
    if (typeof CSSStyleSheet === "undefined" || !("replaceSync" in CSSStyleSheet.prototype) || !("adoptedStyleSheets" in Document.prototype)) return (sharedSheet = null);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(BARCODE_CSS);
    return (sharedSheet = sheet);
  } catch {
    return (sharedSheet = null);
  }
}

const ATTRS = ["value", "symbology", "scale", "ec-level", "foreground", "background", "hrt", "margin", "gs1", "rotate", "alt"] as const;

/**
 * `<qrgen-barcode>`: renders any supported barcode as crisp, scalable SVG.
 *
 * ```html
 * <qrgen-barcode value="https://example.com" symbology="qr" ec-level="M"></qrgen-barcode>
 * <qrgen-barcode value="5901234123457" symbology="ean13" hrt></qrgen-barcode>
 * ```
 *
 * Size it with CSS (`width`/`height`); the SVG scales without blurring. Fires `render` and `error`.
 */
export class QRGenBarcodeElement extends Base {
  static get observedAttributes(): string[] {
    return [...ATTRS];
  }

  private root!: ShadowRoot;
  private seq = 0;
  private _svg = "";

  /** The last rendered SVG markup. */
  get svg(): string {
    return this._svg;
  }

  get value(): string {
    return this.getAttribute("value") ?? "";
  }
  set value(v: string) {
    this.setAttribute("value", v);
  }

  connectedCallback(): void {
    if (!this.root) {
      this.root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      const sheet = barcodeSheet();
      if (sheet) (this.root as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
      this.root.innerHTML = `${sheet ? "" : `<style>${BARCODE_CSS}</style>`}<div class="w" part="barcode"></div>`;
    }
    void this.update();
  }

  attributeChangedCallback(): void {
    if (this.root) void this.update();
  }

  private options(): GenerateOptions {
    const n = (a: string) => {
      const v = this.getAttribute(a);
      return v === null || v === "" ? undefined : Number(v);
    };
    const b = (a: string) => this.hasAttribute(a) && this.getAttribute(a) !== "false";
    return {
      symbology: this.getAttribute("symbology") ?? "qr",
      scale: n("scale") ?? 4,
      ecLevel: this.getAttribute("ec-level") ?? undefined,
      foreground: this.getAttribute("foreground") ?? undefined,
      background: this.getAttribute("background") ?? undefined,
      hrt: b("hrt"),
      margin: this.getAttribute("margin") !== "false",
      gs1: b("gs1"),
      rotate: (n("rotate") as GenerateOptions["rotate"]) ?? 0,
    };
  }

  private async update(): Promise<void> {
    const seq = ++this.seq;
    const box = this.root.querySelector(".w") as HTMLDivElement;
    const value = this.value;
    if (!value) {
      box.innerHTML = "";
      return;
    }
    try {
      const out = await generate(value, this.options());
      if (seq !== this.seq) return;
      this._svg = out.svg;
      box.innerHTML = out.svg;
      const svg = box.querySelector("svg");
      svg?.setAttribute("role", "img");
      svg?.setAttribute("aria-label", this.getAttribute("alt") ?? `${out.symbology} barcode: ${value}`);
      this.dispatchEvent(new CustomEvent("render", { detail: { svg: out.svg, symbology: out.symbology }, bubbles: true, composed: true }));
    } catch (err) {
      if (seq !== this.seq) return;
      const message = err instanceof Error ? err.message : String(err);
      box.innerHTML = `<span class="e" role="alert"></span>`;
      (box.firstChild as HTMLElement).textContent = message;
      this.dispatchEvent(new CustomEvent("error", { detail: { message }, bubbles: true, composed: true }));
    }
  }
}
