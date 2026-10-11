import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReceivingCommand,
  createReceivingSession,
  exportReceivingSession,
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
