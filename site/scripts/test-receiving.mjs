import assert from "node:assert/strict";
import test from "node:test";
import { scannedGtin, typedGtin } from "../src/lib/gtin.ts";
import {
  applyReceivingCommand,
  createReceivingSession,
  exportReceivingSession,
  findReceivingItem,
  receivingStatus,
  validateReceivingSession,
} from "../src/lib/receiving.ts";

const MAX_QUANTITY = 1_000_000;
const MAX_ACTIONS = 10_000;
const copy = value => structuredClone(value);
const add = (id = "add-1", code = "SKU-1", expected = 5) => ({ id, kind: "add", code, name: "First product", expected });
const receive = (id, quantity, code = "SKU-1") => ({ id, kind: "receive", code, quantity });
const correct = (id, quantity, expectedRevision, code = "SKU-1") => ({ id, kind: "correct", code, quantity, expectedRevision, reason: "Counted the delivery again" });
function delivery() {
  return applyReceivingCommand(createReceivingSession("delivery-1", "Morning delivery", 100), add(), 101);
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function rejectsWithoutMutation(session, command, message, at = 200) {
  const before = copy(session);
  assert.throws(() => applyReceivingCommand(session, command, at), message);
  assert.deepEqual(session, before);
}

test("new deliveries are bounded, empty, and independent of scanner observations", () => {
  const empty = createReceivingSession("delivery-1", "  Morning delivery  ", 100);
  assert.deepEqual(empty, { schema: 1, id: "delivery-1", name: "Morning delivery", createdAt: 100, updatedAt: 100, revision: 0, items: [], actions: [] });
  assert.deepEqual(validateReceivingSession(copy(empty)), empty);
  const session = applyReceivingCommand(deepFreeze(empty), add(), 101);
  assert.equal(session.items[0].received, 0);
  assert.equal(session.revision, 1);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.actions.length, 0);
});

test("retrying a normalized action ID applies its count once and keeps export bytes", () => {
  const session = applyReceivingCommand(delivery(), receive("receive-1", 3), 102);
  const before = exportReceivingSession(session);
  const retried = applyReceivingCommand(deepFreeze(session), { quantity: 3, code: "SKU-1", kind: "receive", id: "receive-1" }, 999);
  assert.equal(retried, session);
  assert.equal(retried.items[0].received, 3);
  assert.equal(retried.revision, 2);
  assert.equal(retried.updatedAt, 102);
  assert.equal(exportReceivingSession(retried), before);
  const trimmed = applyReceivingCommand(createReceivingSession("trimmed", "Delivery", 1), { ...add(), name: "  First product  " }, 2);
  assert.equal(applyReceivingCommand(trimmed, add(), 3), trimmed);
});

test("an action ID cannot be reused for a different quantity, barcode, or action", () => {
  const session = deepFreeze(applyReceivingCommand(delivery(), receive("receive-1", 3), 102));
  for (const command of [receive("receive-1", 4), receive("receive-1", 3, "OTHER"), correct("receive-1", 3, session.revision)]) {
    rejectsWithoutMutation(session, command, /already used for a different change/);
  }
  rejectsWithoutMutation(session, { ...add(), expected: 6 }, /already used for a different change/);
});

test("receive requires positive bounded integer quantities and never mutates on failure", () => {
  const session = deepFreeze(delivery());
  for (const quantity of [0, -1, 0.5, MAX_QUANTITY + 1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1", null, true]) {
    rejectsWithoutMutation(session, receive("bad-receive", quantity), /Received quantity must be a whole number/);
  }
  const maximum = applyReceivingCommand(session, receive("maximum", MAX_QUANTITY), 102);
  assert.equal(maximum.items[0].received, MAX_QUANTITY);
  rejectsWithoutMutation(deepFreeze(maximum), receive("overflow", 1), /Total received quantity/);
  assert.equal(session.items[0].received, 0);
});

test("expected quantities, command text, identifiers, and timestamps reject malformed input", () => {
  for (const expected of [0, -1, 0.5, MAX_QUANTITY + 1, NaN, "5", undefined]) {
    rejectsWithoutMutation(deepFreeze(createReceivingSession("empty", "Delivery", 1)), { ...add(), expected }, /Expected quantity/);
  }
  for (const [patch, error] of [
    [{ id: "bad id" }, /Invalid action/],
    [{ id: "" }, /Action or delivery ID/],
    [{ code: " " }, /Barcode value/],
    [{ code: "x".repeat(4097) }, /Barcode value/],
    [{ name: " " }, /Product name/],
    [{ name: "x".repeat(121) }, /Product name/],
  ]) rejectsWithoutMutation(deepFreeze(createReceivingSession("empty", "Delivery", 1)), { ...add(), ...patch }, error);
  for (const at of [-1, 0.5, NaN, Infinity, "200"]) rejectsWithoutMutation(deepFreeze(delivery()), receive("time", 1), /Timestamp/, at);
  assert.throws(() => createReceivingSession("delivery", " ", 1), /Delivery name/);
  assert.throws(() => createReceivingSession("delivery", "Delivery", -1), /Timestamp/);
  const maximum = applyReceivingCommand(createReceivingSession("max", "Delivery", 1), { ...add(), code: "x".repeat(4096), name: "x".repeat(120), expected: MAX_QUANTITY }, 2);
  assert.equal(maximum.items[0].expected, MAX_QUANTITY);
});

test("unknown barcodes and action kinds cannot silently change inventory", () => {
  const session = deepFreeze(delivery());
  rejectsWithoutMutation(session, receive("unknown", 1, "UNKNOWN"), /Add this barcode/);
  rejectsWithoutMutation(session, correct("unknown", 0, session.revision, "UNKNOWN"), /Add this barcode/);
  rejectsWithoutMutation(session, { id: "unknown-kind", kind: "scan", code: "SKU-1", quantity: 1 }, /Unknown receiving action/);
  rejectsWithoutMutation(session, { ...add("duplicate-product"), name: "Another name" }, /already in the delivery/);
});

test("unexpected products must be explicitly added and remain distinguishable", () => {
  const session = applyReceivingCommand(delivery(), add("unexpected", "EXTRA", null), 102);
  const counted = applyReceivingCommand(session, receive("extra-count", 2, "EXTRA"), 103);
  assert.equal(receivingStatus(counted.items[1]), "Unexpected product");
  const exported = JSON.parse(exportReceivingSession(counted));
  assert.equal(exported.items[1].difference, null);
  assert.equal(exported.items[1].received, 2);
});

test("sequential confirmations accumulate and a stale correction cannot overwrite a later count", () => {
  const initial = deepFreeze(delivery());
  const afterFirst = applyReceivingCommand(initial, receive("tab-a", 2), 102);
  const afterBoth = applyReceivingCommand(afterFirst, receive("tab-b", 3), 103);
  assert.equal(afterBoth.items[0].received, 5);
  assert.equal(afterBoth.revision, 3);
  rejectsWithoutMutation(deepFreeze(afterBoth), correct("stale", 1, afterFirst.revision), /changed in another tab/);
  const corrected = applyReceivingCommand(afterBoth, correct("fresh", 1, afterBoth.revision), 104);
  assert.equal(corrected.items[0].received, 1);
  assert.equal(corrected.revision, 4);
  assert.equal(initial.items[0].received, 0);
});

test("correction retries remain repeat-safe even after a newer confirmation", () => {
  const first = applyReceivingCommand(delivery(), receive("first", 4), 102);
  const command = correct("recount", 0, first.revision);
  const corrected = applyReceivingCommand(first, command, 103);
  const latest = deepFreeze(applyReceivingCommand(corrected, receive("later", 2), 104));
  assert.equal(applyReceivingCommand(latest, command, 999), latest);
  assert.equal(latest.items[0].received, 2);
  for (const quantity of [-1, 0.5, MAX_QUANTITY + 1, NaN]) rejectsWithoutMutation(latest, correct("invalid-correction", quantity, latest.revision), /Corrected quantity/);
  rejectsWithoutMutation(latest, { ...correct("missing-reason", 0, latest.revision), reason: " " }, /Correction reason/);
  rejectsWithoutMutation(latest, correct("invalid-revision", 0, -1), /Revision must be/);
  const maximum = applyReceivingCommand(latest, correct("maximum-correction", MAX_QUANTITY, latest.revision), 105);
  assert.equal(maximum.items[0].received, MAX_QUANTITY);
});

test("status and exported differences reflect confirmed, over, and corrected quantities", () => {
  let session = delivery();
  assert.equal(receivingStatus(session.items[0]), "5 remaining");
  session = applyReceivingCommand(session, receive("complete", 5), 102);
  assert.equal(receivingStatus(session.items[0]), "Complete");
  session = applyReceivingCommand(session, receive("over", 2), 103);
  assert.equal(receivingStatus(session.items[0]), "Over by 2");
  assert.equal(JSON.parse(exportReceivingSession(session)).items[0].difference, 2);
  session = applyReceivingCommand(session, correct("recount", 4, session.revision), 104);
  assert.equal(JSON.parse(exportReceivingSession(session)).items[0].difference, -1);
});

test("replay and export are deterministic and retain every command, reason, and raw barcode value", () => {
  const code = "00123\u001dLOT,\"A\"\n";
  let session = applyReceivingCommand(createReceivingSession("audit", "Audit delivery", 100), add("raw-product", code, 3), 101);
  session = applyReceivingCommand(session, receive("raw-receipt", 4, code), 102);
  session = applyReceivingCommand(session, correct("raw-correction", 2, session.revision, code), 103);
  const frozen = deepFreeze(session);
  const replayed = validateReceivingSession(copy(frozen));
  assert.notEqual(replayed, frozen);
  assert.deepEqual(replayed, frozen);
  const bytes = exportReceivingSession(frozen);
  assert.equal(bytes, exportReceivingSession(replayed));
  assert.equal(bytes, exportReceivingSession(frozen));
  assert.ok(bytes.endsWith("\n"));
  const exported = JSON.parse(bytes);
  assert.equal(exported.exportId, "audit:3");
  assert.equal(exported.sessionId, "audit");
  assert.equal(exported.schema, "qrgen-receiving-v1");
  assert.equal(exported.items[0].code, code);
  assert.deepEqual(exported.history, session.actions);
  assert.equal(exported.history[2].command.reason, "Counted the delivery again");
  assert.equal(exported.history.length, 3);
});

test("saved totals, history, schema, revision, and timestamps fail closed when inconsistent", () => {
  let original = applyReceivingCommand(delivery(), receive("receipt", 4), 102);
  original = applyReceivingCommand(original, correct("correction", 2, original.revision), 103);
  const corruptions = [
    saved => { saved.items[0].received = 99; },
    saved => { saved.items[0].expected = 99; },
    saved => { saved.items[0].name = "Changed outside history"; },
    saved => { saved.items = []; },
    saved => { saved.revision--; },
    saved => { saved.updatedAt++; },
    saved => { saved.schema = 2; },
    saved => { saved.actions.pop(); },
    saved => { saved.actions[1].command.id = saved.actions[0].command.id; },
    saved => { saved.actions[1].command.quantity = MAX_QUANTITY + 1; },
    saved => { saved.actions[2].command.expectedRevision = 0; },
    saved => { saved.actions[1].command.kind = "scan"; },
    saved => { saved.actions[1].at = NaN; },
    saved => { [saved.actions[0], saved.actions[1]] = [saved.actions[1], saved.actions[0]]; },
    saved => { saved.actions[0] = null; },
  ];
  for (const corrupt of corruptions) {
    const saved = copy(original);
    corrupt(saved);
    const before = copy(saved);
    assert.throws(() => validateReceivingSession(saved));
    assert.deepEqual(saved, before);
    assert.throws(() => exportReceivingSession(saved));
  }
  for (const unreadable of [null, "saved", 1, {}, { ...original, actions: {} }, { ...original, items: {} }]) assert.throws(() => validateReceivingSession(unreadable));
});

test("saved history cannot exceed total or storage limits even when cached totals look valid", () => {
  const overflow = delivery();
  overflow.actions.push({ command: receive("maximum", MAX_QUANTITY), at: 102 }, { command: receive("overflow", 1), at: 103 });
  overflow.revision = 3;
  overflow.updatedAt = 103;
  overflow.items[0].received = MAX_QUANTITY;
  assert.throws(() => validateReceivingSession(overflow), /Total received quantity/);
  const oversizedActions = createReceivingSession("oversized", "Delivery", 1);
  oversizedActions.actions = Array.from({ length: MAX_ACTIONS + 1 }, () => ({ command: add(), at: 2 }));
  assert.throws(() => validateReceivingSession(oversizedActions), /oversized saved delivery/);
  const oversizedItems = createReceivingSession("oversized", "Delivery", 1);
  oversizedItems.items = Array.from({ length: 501 }, (_, index) => ({ code: `SKU-${index}`, name: "Product", expected: 1, received: 0 }));
  assert.throws(() => validateReceivingSession(oversizedItems), /oversized saved delivery/);
});

test("500 distinct products are retained and the next product fails without removing any", () => {
  let session = createReceivingSession("products", "Many products", 1);
  for (let index = 0; index < 500; index++) session = applyReceivingCommand(session, add(`add-${index}`, `SKU-${index}`, index + 1), index + 2);
  assert.equal(session.items.length, 500);
  assert.equal(validateReceivingSession(copy(session)).items.length, 500);
  rejectsWithoutMutation(deepFreeze(session), add("one-too-many", "SKU-500"), /up to 500 different products/);
  assert.equal(session.actions.length, 500);
});

test("a full 10,000-action ledger replays and exports without truncation; retries still succeed", () => {
  let session = delivery();
  for (let index = 1; index < MAX_ACTIONS; index++) session = applyReceivingCommand(session, receive(`receive-${index}`, 1), 101 + index);
  assert.equal(session.revision, MAX_ACTIONS);
  assert.equal(session.actions.length, MAX_ACTIONS);
  assert.equal(session.items[0].received, MAX_ACTIONS - 1);
  const replayed = validateReceivingSession(copy(session));
  assert.deepEqual(replayed, session);
  const bytes = exportReceivingSession(session);
  const exported = JSON.parse(bytes);
  assert.equal(exported.history.length, MAX_ACTIONS);
  assert.equal(exported.history.at(-1).command.id, "receive-9999");
  assert.equal(exported.exportId, "delivery-1:10000");
  assert.equal(exportReceivingSession(replayed), bytes);
  const frozen = deepFreeze(session);
  assert.equal(applyReceivingCommand(frozen, receive("receive-9999", 1), 999_999), frozen);
  rejectsWithoutMutation(frozen, receive("one-too-many", 1), /reached 10,000 changes/);
  rejectsWithoutMutation(frozen, correct("one-too-many", 0, frozen.revision), /reached 10,000 changes/);
});

// GTIN equivalence. ZXing reports an EAN-13 printed "0012345678905" as UPC-A "012345678905".
const EAN13 = "0012345678905";
const UPCA = "012345678905";
const GTIN = "00012345678905";
const NEIGHBOR = "012345678912"; // A different product with a valid check digit.
const scan = (data, symbology, isGS1 = false) => ({ data, gtin: scannedGtin({ data, symbology, isGS1 }) });
const find = (session, observed) => findReceivingItem(session, observed.data, observed.gtin)?.code;
const scannedAdd = (id, code, gtin) => ({ ...add(id, code, null), gtin });
function rows(...codes) {
  let session = createReceivingSession("gtin", "GTIN delivery", 1);
  codes.forEach((code, index) => { session = applyReceivingCommand(session, add(`add-${index}`, code, 4), index + 2); });
  return session;
}

test("typed values are GTINs only as unaltered 8, 12, 13 or 14 digits with a valid check digit", () => {
  assert.equal(typedGtin(EAN13), GTIN);
  assert.equal(typedGtin(UPCA), GTIN);
  assert.equal(typedGtin(GTIN), GTIN);
  assert.equal(typedGtin("96385074"), "00000096385074");
  assert.equal(typedGtin("15400141288763"), "15400141288763");
  for (const value of [` ${UPCA}`, `${EAN13} `, `${UPCA}\n`, "0012345678906", "12345678905", "123456789012345", "0123456789", "00000000000000", "QRGEN-COFFEE", "0012-345678905", ""]) {
    assert.equal(typedGtin(value), null, JSON.stringify(value));
  }
});

test("scans carry a GTIN only from retail symbologies, GS1 AI (01) or a GS1 Digital Link", () => {
  for (const [data, symbology, isGS1] of [
    [UPCA, "upca"], [EAN13, "ean13"], ["00012345678905", "itf"], ["00012345678905", "itf14"],
    ["(01)00012345678905(10)LOT1", "code128", true], ["(01)00012345678905", "databar", true],
    ["(01)00012345678905(17)271231", "data-matrix", true], ["https://id.gs1.org/01/00012345678905/10/ABC", "qr"],
    ["https://example.com/01/012345678905", "qr"],
  ]) assert.equal(scan(data, symbology, isGS1).gtin, GTIN, `${symbology} ${data}`);
  assert.equal(scan("01234565", "upce").gtin, typedGtin("012345000065"), "UPC-E expands to its UPC-A, not to an EAN-8.");
  assert.equal(scan("96385074", "ean8").gtin, "00000096385074");
  assert.equal(scan("10012345678902", "itf").gtin, "10012345678902", "An ITF-14 case indicator is a different GTIN.");
  for (const [data, symbology, isGS1] of [
    [UPCA, "code128"], [EAN13, "qr"], [UPCA, "data-matrix"], [UPCA, "itf"], ["(01)00012345678905", "code128", false],
    ["012345678906", "upca"], ["(01)00012345678906", "code128", true], ["(02)00012345678905(37)10", "code128", true],
    ["https://id.gs1.org/01/00012345678906", "qr"], ["https://id.gs1.org/414/0012345678905", "qr"], ["https://example.com/", "qr"],
    ["21234565", "upce"], [UPCA, undefined], [UPCA, "toString"],
  ]) assert.equal(scan(data, symbology, isGS1).gtin, null, `${symbology} ${data}`);
});

test("a scanned UPC-A finds the row typed as its 13-digit EAN and confirms into that row", () => {
  const session = deepFreeze(rows(EAN13));
  assert.equal(find(session, scan(UPCA, "upca")), EAN13);
  assert.equal(findReceivingItem(session, UPCA)?.code, EAN13, "Typed lookups use the GTIN the digits spell.");
  assert.equal(find(rows(UPCA), scan(EAN13, "ean13")), UPCA);
  const counted = applyReceivingCommand(session, receive("count", 2, find(session, scan(UPCA, "upca"))), 10);
  assert.deepEqual(counted.items.map(({ code, received }) => ({ code, received })), [{ code: EAN13, received: 2 }]);
  // The ledger still records the row's own value: other forms are resolved before a command.
  rejectsWithoutMutation(session, receive("other-form", 1, UPCA), /Add this barcode/);
});

test("UPC-E, ITF-14, GS1 element strings and Digital Links find the row with the same GTIN", () => {
  const session = rows(EAN13, "012345000065", NEIGHBOR);
  assert.equal(find(session, scan("01234565", "upce")), "012345000065");
  for (const observed of [scan("00012345678905", "itf"), scan("(01)00012345678905(10)LOT1", "code128", true), scan("(01)00012345678905", "databar", true), scan("https://id.gs1.org/01/00012345678905/10/ABC", "qr")]) {
    assert.equal(find(session, observed), EAN13, observed.data);
  }
  assert.equal(find(session, scan("10012345678902", "itf")), undefined, "A case GTIN is not its unit's row.");
  assert.equal(find(session, scan(NEIGHBOR, "upca")), NEIGHBOR);
});

test("values without a GTIN stay exact and neighbouring values never find a row", () => {
  const session = rows(EAN13, " 00123 ", "SKU-a", "0012345678906");
  for (const observed of [scan(UPCA, "code128"), scan(UPCA, "qr"), scan("(01)00012345678905", "data-matrix"), scan("012345678906", "upca"), scan(NEIGHBOR, "upca"), { data: UPCA, gtin: null }]) {
    assert.equal(find(session, observed), undefined, observed.data);
  }
  for (const typed of [` ${UPCA}`, "012345678906", "00123", " 00123", "SKU-A", "sku-a"]) assert.equal(findReceivingItem(session, typed), undefined, typed);
  assert.equal(findReceivingItem(session, " 00123 ")?.code, " 00123 ");
  assert.equal(findReceivingItem(session, "0012345678906")?.code, "0012345678906", "An invalid check digit still matches its exact value.");
  assert.equal(find(session, scan(EAN13, "qr")), EAN13, "Exact values match in any symbology.");
});

test("a second row with an existing row's GTIN is rejected as the same product", () => {
  const session = deepFreeze(rows(EAN13));
  for (const command of [add("upc-form", UPCA), add("gtin-14", GTIN), scannedAdd("gs1-scan", "(01)00012345678905(10)LOT1", GTIN), scannedAdd("itf-scan", "00012345678905", GTIN)]) {
    rejectsWithoutMutation(session, command, /already in the delivery as 0012345678905 \(same product number\)/);
  }
  rejectsWithoutMutation(session, add("same-value", EAN13), /This barcode is already in the delivery\./);
  // Values that are not this GTIN remain separate products.
  let distinct = session;
  for (const [index, code] of [` ${UPCA}`, "0012345678906", NEIGHBOR, "QRGEN-COFFEE"].entries()) distinct = applyReceivingCommand(distinct, add(`distinct-${index}`, code), 10 + index);
  distinct = applyReceivingCommand(distinct, scannedAdd("no-gtin-scan", "QRGEN-TEA", null), 20);
  assert.equal(distinct.items.length, 6);
});

test("deliveries saved with GTIN-equivalent rows before this rule still open, export and count", () => {
  const legacy = {
    schema: 1, id: "legacy", name: "Older delivery", createdAt: 1, updatedAt: 4, revision: 3,
    items: [{ code: EAN13, name: "First product", expected: 5, received: 2 }, { code: UPCA, name: "First product", expected: 5, received: 0 }],
    actions: [{ command: add("legacy-ean", EAN13), at: 2 }, { command: add("legacy-upc", UPCA), at: 3 }, { command: receive("legacy-count", 2, EAN13), at: 4 }],
  };
  const saved = deepFreeze(copy(legacy));
  const opened = validateReceivingSession(saved);
  assert.deepEqual(opened, legacy);
  const bytes = exportReceivingSession(saved);
  assert.equal(bytes, exportReceivingSession(opened));
  assert.equal(JSON.parse(bytes).exportId, "legacy:3");
  assert.ok(JSON.parse(bytes).history.every(({ command }) => !("gtin" in command)), "Typed history keeps its saved shape.");
  assert.equal(find(opened, scan(UPCA, "upca")), UPCA, "The exact row wins.");
  assert.equal(find(opened, scan("00012345678905", "itf")), EAN13, "Otherwise the first row with the GTIN.");
  const counted = applyReceivingCommand(opened, receive("later", 1, UPCA), 5);
  assert.deepEqual(counted.items.map(({ received }) => received), [2, 1]);
  assert.deepEqual(validateReceivingSession(copy(counted)), counted);
});

test("products added from a scan keep the scanned GTIN through retries, replay and export", () => {
  let session = createReceivingSession("scanned", "Scanned delivery", 1);
  const upce = scannedAdd("upce", "01234565", scan("01234565", "upce").gtin);
  session = applyReceivingCommand(session, upce, 2);
  assert.equal(applyReceivingCommand(session, copy(upce), 3), session);
  rejectsWithoutMutation(deepFreeze(session), { ...upce, gtin: null }, /already used for a different change/);
  // The 8 printed digits typed alone read as an EAN-8; the recorded scan keeps UPC-E's own GTIN.
  assert.equal(find(session, scan("012345000065", "upca")), "01234565");
  rejectsWithoutMutation(deepFreeze(session), add("typed-upca", "012345000065"), /already in the delivery as 01234565/);
  session = applyReceivingCommand(session, scannedAdd("gs1", "(01)00012345678905(10)LOT1", GTIN), 4);
  assert.equal(find(session, scan(UPCA, "upca")), "(01)00012345678905(10)LOT1");
  // Same digits from a non-retail symbology record no GTIN and stay exact.
  session = applyReceivingCommand(session, scannedAdd("code128", NEIGHBOR, scan(NEIGHBOR, "code128").gtin), 5);
  assert.equal(findReceivingItem(session, `0${NEIGHBOR}`), undefined);
  session = applyReceivingCommand(session, add("typed-ean", `0${NEIGHBOR}`), 6);
  assert.equal(session.items.length, 4);
  const replayed = validateReceivingSession(copy(session));
  assert.deepEqual(replayed, session);
  const history = JSON.parse(exportReceivingSession(session)).history.map(({ command }) => command.gtin);
  assert.deepEqual(history, ["00012345000065", GTIN, null, undefined]);
  assert.equal(exportReceivingSession(replayed), exportReceivingSession(session));
  for (const gtin of ["00012345678906", "0012345678905", "00000000000000", 12345678905, "", false]) {
    rejectsWithoutMutation(deepFreeze(session), scannedAdd("bad-gtin", "EXTRA", gtin), /scanned product number/);
  }
  const corrupt = copy(session);
  corrupt.actions[0].command.gtin = "00012345000066";
  assert.throws(() => validateReceivingSession(corrupt), /scanned product number/);
});
