import { scanImage, type Barcode } from "qrgen-sdk";
import "qrgen-sdk/elements";
import type { QRGenScannerElement } from "qrgen-sdk/elements";
import { scannedGtin } from "../lib/gtin";
import { applyReceivingCommand, createReceivingSession, exportReceivingSession, findReceivingItem, receivingStatus, type ReceivingCommand, type ReceivingItem, type ReceivingSession } from "../lib/receiving";
import { receivingStore } from "../lib/receiving-store";

/** A chosen barcode: a delivery row's value (no symbology), or a scanned value with the GTIN it carries. */
interface Choice { code: string; gtin: string | null; symbologyName: string | null }
type Observed = Pick<Barcode, "data" | "symbology" | "symbologyName" | "isGS1">;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const app = $("#receiving-app");
const message = $("#receiving-message");
const scanner = $<QRGenScannerElement>("#scanner");
const deliverySelect = $<HTMLSelectElement>("#delivery-select");
let session: ReceivingSession | null = null;
let selected: Choice | null = null;
let busy = true;
let refreshPending = false;
let generation = 0;
let refreshToken = 0;
let imageToken = 0;
let correctionRevision = 0;
let correctionDirty = false;
const observations = new Map<string, Choice>();
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("qrgen-receiving-v1") : null;
const id = () => crypto.randomUUID();
const value = (selector: string) => $<HTMLInputElement>(selector).value;

function report(text: string, error = false): void {
  message.textContent = text;
  message.dataset.error = String(error);
}
function controls(): void {
  app.setAttribute("aria-busy", String(busy));
  for (const fieldset of app.querySelectorAll<HTMLFieldSetElement>("[data-editor]")) fieldset.disabled = busy || !session;
  $("#new-delivery").querySelector<HTMLButtonElement>("button")!.disabled = busy;
  $<HTMLButtonElement>("#sample-delivery").disabled = busy;
  deliverySelect.disabled = busy || !deliverySelect.options.length || !deliverySelect.value;
  $<HTMLInputElement>("#image-file").disabled = busy || !session;
  $<HTMLButtonElement>("#export-delivery").disabled = busy || !session;
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-select], #observations button")) button.disabled = busy || !session;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
/** The delivery row for the chosen barcode: its exact value, otherwise the row with the same GTIN. */
function selectedItem(): ReceivingItem | undefined {
  return session && selected ? findReceivingItem(session, selected.code, selected.gtin) : undefined;
}
function choose(choice: Choice): void {
  if (busy || !session) return;
  selected = choice;
  correctionDirty = false;
  $<HTMLInputElement>("#correction-reason").value = "";
  renderSelection();
  // On narrow screens, and from the totals table, the confirmation form can be off screen.
  const form = document.querySelector<HTMLElement>("#confirm-quantity:not([hidden]), #unknown-item:not([hidden])");
  form?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function renderSelection(): void {
  const item = selectedItem();
  // A scan that found its row by product number shows both values.
  const scanned = selected && item && item.code !== selected.code ? ` (scanned as ${selected.symbologyName} ${selected.code}, same product number)` : "";
  $("#selected-code").textContent = !selected ? "Choose a barcode to confirm a quantity." : item ? `${item.name} · ${item.code}${scanned}` : `Unknown product · ${selected.code}`;
  $("#unknown-item").hidden = !selected || !!item || !session;
  $("#confirm-quantity").hidden = !item;
  $("#correct-quantity").hidden = !item;
  if (item && !correctionDirty) {
    $<HTMLInputElement>("#correction-quantity").value = String(item.received);
    correctionRevision = session!.revision;
  }
  controls();
}
function render(): void {
  $("#delivery-title").textContent = session?.name ?? "Your delivery";
  $("#delivery-revision").textContent = session ? `Saved revision ${session.revision}` : "No delivery selected";
  const items = session?.items ?? [];
  const completed = items.filter(item => item.expected !== null && item.received === item.expected).length;
  const unexpected = items.filter(item => item.expected === null).length;
  $("#delivery-summary").textContent = session ? `${items.length} products · ${completed} complete · ${unexpected} unexpected` : "Create a delivery to begin.";
  const rows = $("#product-rows");
  rows.replaceChildren(...items.map(item => {
    const row = node("tr"); row.dataset.code = item.code;
    const name = node("td"); name.dataset.col = "name";
    const code = node("code", item.code); code.dataset.col = "code";
    name.append(node("strong", item.name), code);
    row.append(name);
    for (const [key, text] of [["expected", item.expected === null ? "—" : String(item.expected)], ["received", String(item.received)], ["status", receivingStatus(item)]]) {
      const cell = node("td", text); cell.dataset.col = key; row.append(cell);
    }
    const button = node("button", "Choose"); button.type = "button"; button.className = "btn btn-light btn-sm"; button.dataset.select = item.code;
    button.setAttribute("aria-label", `Choose ${item.name}`); button.onclick = () => choose({ code: item.code, gtin: null, symbologyName: null });
    const cell = node("td"); cell.append(button); row.append(cell);
    return row;
  }));
  const actions = session?.actions ?? [];
  // Keep the complete history in storage/export; bound the visible list for long deliveries.
  $("#receiving-history").replaceChildren(...actions.slice(-100).map(({ command }) => {
    const name = items.find(item => item.code === command.code)?.name ?? command.code;
    const text = command.kind === "add" ? `Added ${name}: ${command.expected === null ? "unexpected product" : `expected ${command.expected}`}.` : command.kind === "receive" ? `Confirmed ${command.quantity} × ${name}.` : `Corrected ${name} to ${command.quantity}: ${command.reason}`;
    return node("li", text);
  }));
  if (actions.length > 100) $("#receiving-history").prepend(node("li", "Showing the latest 100 changes. Export includes the complete history."));
  renderSelection();
}
async function refreshList(): Promise<void> {
  const result = await receivingStore.list();
  const active = session?.id;
  const options = result.sessions.sort((a, b) => b.createdAt - a.createdAt).map(saved => {
    const option = node("option", saved.name); option.value = saved.id; return option;
  });
  if (active && !result.sessions.some(saved => saved.id === active)) {
    const unavailable = node("option", `${session!.name} (unavailable)`); unavailable.value = active; options.unshift(unavailable);
  }
  if (!options.length) { const option = node("option", "No saved deliveries"); option.value = ""; options.push(option); }
  deliverySelect.replaceChildren(...options);
  deliverySelect.value = active ?? [result.active].find(id => result.sessions.some(saved => saved.id === id)) ?? result.sessions[0]?.id ?? "";
  $("#storage-warning").hidden = result.unreadable === 0;
  $("#storage-warning").textContent = `${result.unreadable} saved ${result.unreadable === 1 ? "delivery could" : "deliveries could"} not be read and ${result.unreadable === 1 ? "was" : "were"} left unchanged. Other deliveries remain available.`;
  controls();
}
async function refresh(): Promise<void> {
  const token = ++refreshToken;
  const currentId = session?.id;
  const currentGeneration = generation;
  if (!currentId) {
    const result = await receivingStore.list();
    if (token !== refreshToken || generation !== currentGeneration || session) return;
    const saved = result.sessions.find(saved => saved.id === result.active) ?? result.sessions[0];
    if (saved) changedSession(saved);
    await refreshList();
    return;
  }
  let latest: ReceivingSession;
  try { latest = await receivingStore.read(currentId); }
  catch (error) {
    if (token !== refreshToken || generation !== currentGeneration || session?.id !== currentId) return;
    await refreshList(); // Keep other valid deliveries accessible without trusting this total.
    throw error;
  }
  if (token !== refreshToken || generation !== currentGeneration || session?.id !== currentId) return;
  if (latest.revision >= session.revision) { session = latest; render(); }
  await refreshList();
}
function requestRefresh(): void {
  if (busy) { refreshPending = true; return; }
  refreshPending = false;
  void refresh().catch(error => report(error instanceof Error ? error.message : String(error), true));
}
function changedSession(next: ReceivingSession): void {
  generation++;
  imageToken++;
  scanner.stop();
  scanner.clearSelection();
  observations.clear();
  $("#observations").replaceChildren();
  $("#observation-empty").hidden = false;
  $("#image-status").textContent = "";
  $<HTMLInputElement>("#image-file").value = "";
  session = next; selected = null; correctionDirty = false;
  render();
}
/** Disabling controls while saving drops focus to the body; return it for keyboard users. */
function restoreFocus(element: Element | null): void {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.matches(":disabled") || element.closest("[hidden]")) return;
  if (!document.activeElement || document.activeElement === document.body) element.focus();
}
async function perform(work: () => Promise<ReceivingSession>, success: string, newSession = false, retainCorrection = false): Promise<void> {
  if (busy) return;
  const focused = document.activeElement;
  busy = true; controls();
  try {
    const saved = await work();
    if (newSession) changedSession(saved);
    else { session = saved; render(); }
    await refreshList();
    channel?.postMessage({ id: saved.id });
    report(success);
  } catch (error) {
    // A rejected correction keeps the entered total. Refreshing rebases it on the
    // revision now displayed, so retrying cannot record the old total under its reason.
    const draft = retainCorrection ? { code: selectedItem()?.code, quantity: value("#correction-quantity") } : null;
    correctionDirty = false;
    try { await refresh(); } catch { /* Keep the last successfully read totals visible. */ }
    if (draft?.code !== undefined && draft.code === selectedItem()?.code) {
      $<HTMLInputElement>("#correction-quantity").value = draft.quantity;
      correctionDirty = true;
    }
    report(error instanceof Error ? error.message : String(error), true);
  } finally {
    busy = false; controls(); restoreFocus(focused);
    if (refreshPending) requestRefresh();
  }
}
function submit(selector: string, callback: () => void): void {
  $(selector).addEventListener("submit", event => { event.preventDefault(); callback(); });
}
function apply(command: ReceivingCommand, success: string): void {
  if (!session) return;
  const sessionId = session.id;
  void perform(async () => {
    const saved = await receivingStore.apply(sessionId, command);
    if (command.kind === "correct") correctionDirty = false;
    return saved;
  }, success, false, command.kind === "correct");
}
submit("#new-delivery", () => {
  void perform(() => receivingStore.create(createReceivingSession(id(), value("#delivery-name"))), "Delivery created and saved.", true);
});
$("#sample-delivery").addEventListener("click", () => {
  let next = createReceivingSession(id(), "Sample delivery");
  for (const item of [{ code: "QRGEN-COFFEE", name: "Coffee", expected: 6 }, { code: "QRGEN-TEA", name: "Tea", expected: 4 }, { code: "QRGEN-COCOA", name: "Cocoa", expected: 2 }]) next = applyReceivingCommand(next, { id: id(), kind: "add", ...item });
  void perform(() => receivingStore.create(next), "Sample delivery saved. Try the sample labels below.", true);
});
deliverySelect.addEventListener("change", () => {
  const nextId = deliverySelect.value;
  void perform(async () => { await receivingStore.activate(nextId); return receivingStore.read(nextId); }, "Saved delivery opened.", true);
});
submit("#expected-item", () => apply({ id: id(), kind: "add", code: value("#item-code"), name: value("#item-name"), expected: Number(value("#item-expected")) }, "Expected product saved."));
submit("#unknown-item", () => {
  if (!selected) return;
  // A scanned value records the GTIN it carries (or null), so later scans of the same product find this row.
  const scanned = selected.symbologyName === null ? {} : { gtin: selected.gtin };
  apply({ id: id(), kind: "add", code: selected.code, name: value("#unknown-name"), expected: null, ...scanned }, "Unexpected product saved. Confirm a quantity when ready.");
});
// Quantities go to the matched row's own value, never to a different scanned form of it.
submit("#confirm-quantity", () => { const item = selectedItem(); if (item) apply({ id: id(), kind: "receive", code: item.code, quantity: Number(value("#receive-quantity")) }, "Received quantity confirmed and saved."); });
submit("#correct-quantity", () => { const item = selectedItem(); if (item) apply({ id: id(), kind: "correct", code: item.code, quantity: Number(value("#correction-quantity")), reason: value("#correction-reason"), expectedRevision: correctionRevision }, "Correction saved with its reason."); });
$("#correct-quantity").addEventListener("input", () => { correctionDirty = true; });

function observed(barcode: Observed): Choice {
  return { code: barcode.data, gtin: scannedGtin(barcode), symbologyName: barcode.symbologyName };
}
function observe(barcodes: Observed[]): void {
  let changed = false;
  for (const barcode of barcodes) {
    // The same digits in another symbology can carry a different GTIN (or none), so list both.
    const key = JSON.stringify([barcode.symbology, barcode.isGS1, barcode.data]);
    if (!barcode.data.trim() || barcode.data.length > 4096 || observations.has(key) || observations.size >= 100) continue;
    const choice = observed(barcode);
    observations.set(key, choice); changed = true;
    const button = node("button", `${barcode.symbologyName} · ${barcode.data}`);
    button.type = "button"; button.className = "btn btn-light btn-sm"; button.dataset.code = barcode.data;
    button.onclick = () => choose(choice);
    const row = node("li"); row.append(button); $("#observations").append(row);
  }
  if (changed) { $("#observation-empty").hidden = false; $("#observation-empty").textContent = "Choose an observed barcode to confirm its quantity. Up to 100 different values are shown per opened delivery."; controls(); }
}
scanner.addEventListener("scan", event => observe((event as CustomEvent<{ barcodes: Barcode[] }>).detail.barcodes));
scanner.addEventListener("track", event => observe((event as CustomEvent<{ tracked: Barcode[] }>).detail.tracked));
scanner.addEventListener("select", event => {
  const { barcode, selected: isSelected } = (event as CustomEvent<{ barcode: Barcode | null; selected: boolean }>).detail;
  if (barcode && isSelected) { observe([barcode]); choose(observed(barcode)); }
});
scanner.addEventListener("error", event => { report((event as unknown as CustomEvent<{ message: string }>).detail.message, true); });
$<HTMLInputElement>("#image-file").addEventListener("change", async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !session) return;
  const token = ++imageToken;
  const sourceGeneration = generation;
  $("#image-status").textContent = "Reading image on this device…";
  try {
    const barcodes = await scanImage(file, { symbologies: "all" });
    if (token !== imageToken || sourceGeneration !== generation) return;
    observe(barcodes);
    $("#image-status").textContent = barcodes.length ? `${barcodes.length} decoded barcode${barcodes.length === 1 ? "" : "s"}. Choose a value below.` : "No barcode found. Try a clearer image.";
  } catch (error) { if (token === imageToken && sourceGeneration === generation) $("#image-status").textContent = `Image could not be read: ${error instanceof Error ? error.message : String(error)}`; }
  finally { if (token === imageToken) input.value = ""; }
});
$("#export-delivery").addEventListener("click", async () => {
  if (!session || busy) return;
  const sessionId = session.id;
  const focused = document.activeElement;
  busy = true; controls();
  try {
    // Export a committed snapshot, including confirmations from other tabs.
    const saved = await receivingStore.read(sessionId);
    session = saved; render();
    const blob = new Blob([exportReceivingSession(saved)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = node("a"); link.href = url; link.download = `qrgen-receiving-${saved.id}-${saved.revision}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    report(`Exported saved revision ${saved.revision}. Repeating this export uses the same record ID.`);
  } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
  finally { busy = false; controls(); restoreFocus(focused); if (refreshPending) requestRefresh(); }
});
channel?.addEventListener("message", requestRefresh);
window.addEventListener("focus", requestRefresh);
window.addEventListener("pagehide", () => { imageToken++; scanner.stop(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) scanner.stop(); });

async function initialize(): Promise<void> {
  try {
    const result = await receivingStore.list();
    const saved = result.sessions.find(saved => saved.id === result.active) ?? result.sessions[0];
    if (saved) changedSession(saved);
    await refreshList();
    report(saved ? "Saved delivery restored. Quantities change only after confirmation." : "Create a delivery or try the sample to begin.");
  } catch (error) { report(error instanceof Error ? error.message : String(error), true); }
  finally { busy = false; render(); if (refreshPending) requestRefresh(); }
}
void initialize();
