import { defineComponent, h, onBeforeUnmount, onMounted, ref, type App, type PropType } from "vue";
import { defineElements } from "../elements/define.js";
import type { QRGenScannerElement } from "../elements/scanner-element.js";
import type { ScanArea, ScanMode, ViewfinderStyle } from "../types.js";

defineElements();

const scannerProps = {
  symbologies: { type: [Array, String] as PropType<string[] | string>, default: undefined },
  mode: { type: String as PropType<ScanMode>, default: undefined },
  duplicateFilter: { type: Number, default: undefined },
  beep: { type: Boolean, default: undefined },
  vibrate: { type: Boolean, default: undefined },
  camera: { type: String, default: undefined },
  torch: { type: Boolean, default: undefined },
  viewfinder: { type: String as PropType<ViewfinderStyle>, default: undefined },
  scanArea: { type: Object as PropType<ScanArea>, default: undefined },
  maxResults: { type: Number, default: undefined },
  autostart: { type: Boolean, default: undefined },
  controls: { type: String as PropType<"default" | "none">, default: undefined },
  accent: { type: String, default: undefined },
  hint: { type: String, default: undefined },
  toast: { type: Boolean, default: undefined },
  tryHarder: { type: Boolean, default: undefined },
  resolution: { type: String as PropType<"sd" | "hd" | "fhd" | "4k">, default: undefined },
  worker: { type: Boolean, default: undefined },
};

const EVENTS = ["scan", "track", "select", "error", "ready", "statechange"] as const;

/**
 * Vue 3 camera scanner component (wraps `<qrgen-scanner>`).
 *
 * ```vue
 * <QRGenScanner :symbologies="['qr', 'ean13']" mode="single" @scan="({ barcode }) => (code = barcode.data)" />
 * ```
 *
 * Events receive the same `detail` objects as the custom element.
 */
export const QRGenScanner = defineComponent({
  name: "QRGenScanner",
  props: scannerProps,
  emits: [...EVENTS],
  setup(props, { emit, expose }) {
    const el = ref<QRGenScannerElement | null>(null);
    const offs: (() => void)[] = [];
    onMounted(() => {
      const node = el.value;
      if (!node) return;
      for (const name of EVENTS) {
        const handler = (e: Event) => emit(name, (e as CustomEvent).detail);
        node.addEventListener(name, handler);
        offs.push(() => node.removeEventListener(name, handler));
      }
    });
    onBeforeUnmount(() => offs.splice(0).forEach((off) => off()));
    expose({
      element: el,
      start: () => el.value?.start(),
      stop: () => el.value?.stop(),
      pause: () => el.value?.pause(),
      resume: () => el.value?.resume(),
      setTorch: (on: boolean) => el.value?.setTorch(on),
      toggleTorch: () => el.value?.toggleTorch(),
      switchCamera: () => el.value?.switchCamera(),
      setZoom: (z: number) => el.value?.setZoom(z),
      clearSelection: () => el.value?.clearSelection(),
    });
    return () => {
      const b = (v: boolean | undefined) => (v === undefined ? undefined : String(v));
      const a: Record<string, unknown> = {
        ref: el,
        symbologies: Array.isArray(props.symbologies) ? props.symbologies.join(",") : props.symbologies,
        mode: props.mode,
        "duplicate-filter": props.duplicateFilter === undefined ? undefined : String(props.duplicateFilter),
        beep: b(props.beep),
        vibrate: b(props.vibrate),
        camera: props.camera,
        torch: b(props.torch),
        viewfinder: props.viewfinder,
        "scan-area": props.scanArea ? `${props.scanArea.x},${props.scanArea.y},${props.scanArea.width},${props.scanArea.height}` : undefined,
        "max-results": props.maxResults === undefined ? undefined : String(props.maxResults),
        autostart: b(props.autostart),
        controls: props.controls,
        accent: props.accent,
        hint: props.hint,
        toast: b(props.toast),
        "try-harder": b(props.tryHarder),
        resolution: props.resolution,
        worker: b(props.worker),
      };
      for (const k of Object.keys(a)) if (a[k] === undefined) delete a[k];
      return h("qrgen-scanner", a);
    };
  },
});

/** Vue 3 barcode renderer (wraps `<qrgen-barcode>`). */
export const QRGenBarcode = defineComponent({
  name: "QRGenBarcode",
  props: {
    value: { type: String, required: true },
    symbology: { type: String, default: "qr" },
    scale: { type: Number, default: undefined },
    ecLevel: { type: String, default: undefined },
    foreground: { type: String, default: undefined },
    background: { type: String, default: undefined },
    hrt: { type: Boolean, default: false },
    margin: { type: Boolean, default: true },
    gs1: { type: Boolean, default: false },
    rotate: { type: Number, default: undefined },
    alt: { type: String, default: undefined },
  },
  setup(props) {
    return () => {
      const a: Record<string, unknown> = { value: props.value, symbology: props.symbology };
      if (props.scale !== undefined) a.scale = String(props.scale);
      if (props.ecLevel) a["ec-level"] = props.ecLevel;
      if (props.foreground) a.foreground = props.foreground;
      if (props.background) a.background = props.background;
      if (props.hrt) a.hrt = "true";
      if (!props.margin) a.margin = "false";
      if (props.gs1) a.gs1 = "true";
      if (props.rotate) a.rotate = String(props.rotate);
      if (props.alt) a.alt = props.alt;
      return h("qrgen-barcode", a);
    };
  },
});

/** `app.use(QRGenPlugin)` registers both components globally. */
export const QRGenPlugin = {
  install(app: App): void {
    app.component("QRGenScanner", QRGenScanner);
    app.component("QRGenBarcode", QRGenBarcode);
  },
};
