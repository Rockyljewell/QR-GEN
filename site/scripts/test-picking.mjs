import assert from "node:assert/strict";
import test from "node:test";
import {
  PickingSession,
  PICKING_MAX_OBSERVATIONS,
  PICKING_RECENT_MS,
  classifyPickingBarcodes,
} from "../src/lib/picking.ts";

const track = (id, data = "00123", lastSeen = 100) => ({ id, data, symbologyName: "QR Code", lastSeen });
const values = (observations) => observations.map(({ data }) => data);
const copy = (value) => structuredClone(value);
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function active(data = "00123") {
  const session = new PickingSession();
  session.setTarget(data, "Target product");
  return session;
}

test("a new task has no target, observations or implied quantities", () => {
  const session = new PickingSession();
  const state = session.snapshot(0);
  assert.equal(state.target, null);
  assert.deepEqual(state.matches, []);
  assert.deepEqual(state.others, []);
  assert.equal("quantity" in state, false);
  assert.equal("received" in state, false);
});

test("target values preserve whitespace, leading zeros, case and control characters exactly", () => {
  for (const data of [" 00123 ", "00123", "sku-A", "SKU-a", " ", "00\u001dLOT\nA"]) {
    const session = active(data);
    assert.equal(session.target.data, data);
    session.update([track(1, data), track(2, `${data}x`)], 10);
    assert.deepEqual(values(session.snapshot(10).matches), [data]);
    assert.deepEqual(values(session.snapshot(10).others), [`${data}x`]);
  }
});

test("numeric, trimmed and case-folded neighbors never match an exact target", () => {
  const session = active(" 00123a ");
  const wrong = ["00123a", " 00123A ", " 123a ", "00123", "123", " 00123a  "];
  session.update(wrong.map((data, i) => track(i + 1, data)), 20);
  assert.deepEqual(session.snapshot(20).matches, []);
  assert.deepEqual(values(session.snapshot(20).others), wrong);
});

test("equal-payload IDs are observations and repeated frames do not create quantities", () => {
  const session = active();
  session.update([track(1), track(2), track(3, "OTHER")], 100);
  const initial = session.snapshot(100);
  assert.deepEqual(initial.matches.map(({ id }) => id), [1, 2]);
  for (let frame = 1; frame <= 20; frame++) session.update([track(1, "00123", 100 + frame), track(2, "00123", 100 + frame)], 100 + frame);
  const latest = session.snapshot(120);
  assert.equal(latest.matches.length, 2);
  assert.equal(latest.others.length, 0);
  assert.ok(latest.matches.every((item) => !("quantity" in item) && !("received" in item) && !("count" in item)));
  assert.deepEqual(initial.matches.map(({ lastSeen }) => lastSeen), [100, 100]);
});

test("an authoritative current snapshot removes omitted IDs immediately", () => {
  const session = active();
  session.update([track(1), track(2, "OTHER")], 100);
  session.update([track(2, "OTHER", 101)], 101);
  assert.deepEqual(session.snapshot(101).matches, []);
  assert.deepEqual(session.snapshot(101).others.map(({ id }) => id), [2]);
  session.update([], 102);
  assert.deepEqual(session.snapshot(102).others, []);
});

test("recent lifetime includes the exact boundary and expires one millisecond later", () => {
  const session = active();
  session.update([track(1)], 100);
  assert.equal(PICKING_RECENT_MS, 500);
  assert.equal(session.snapshot(100 + PICKING_RECENT_MS).matches.length, 1);
  assert.equal(session.snapshot(101 + PICKING_RECENT_MS).matches.length, 0);
});

test("unchanged lastSeen cannot refresh or revive a stale retained snapshot", () => {
  const session = active();
  session.update([track(1)], 100);
  session.update([track(1)], 500);
  assert.equal(session.snapshot(600).matches.length, 1);
  session.update([track(1)], 601);
  assert.equal(session.snapshot(601).matches.length, 0);
  session.update([track(1)], 5000);
  assert.equal(session.snapshot(5000).matches.length, 0);
});

test("a fresh track version can become recent again after expiry", () => {
  const session = active();
  session.update([track(1)], 100);
  assert.equal(session.snapshot(601).matches.length, 0);
  session.update([track(1, "00123", 102)], 602);
  assert.equal(session.snapshot(602).matches.length, 1);
  assert.equal(session.snapshot(602).matches[0].observedAt, 602);
});

test("omitted then newly observed IDs are fresh, without a historical match cache", () => {
  const session = active();
  session.update([track(1)], 100);
  session.update([], 200);
  session.update([track(1)], 1000);
  assert.equal(session.snapshot(1000).matches.length, 1);
  assert.equal(session.snapshot(1000).matches[0].observedAt, 1000);
});

test("target replacement clears current and stale version history before any new frame", () => {
  const session = active("A");
  session.update([track(1, "A"), track(2, "B")], 100);
  const generation = session.generation;
  session.setTarget("B", "Second product");
  assert.ok(session.generation > generation);
  assert.deepEqual(session.snapshot(101).matches, []);
  assert.deepEqual(session.snapshot(101).others, []);
  assert.deepEqual(session.target, { data: "B", name: "Second product" });
  session.update([track(2, "B")], 102);
  assert.deepEqual(values(session.snapshot(102).matches), ["B"]);
});

test("reset retains the exact target but retires observations and their generation", () => {
  const session = active(" 00123 ");
  session.update([track(1, " 00123 ")], 100);
  const before = session.snapshot(100);
  session.reset();
  const after = session.snapshot(101);
  assert.deepEqual(after.target, before.target);
  assert.ok(after.generation > before.generation);
  assert.deepEqual(after.matches, []);
  assert.deepEqual(after.others, []);
  assert.equal(before.matches.length, 1);
});

test("clearTarget removes the task and observations without changing saved snapshots", () => {
  const session = active();
  session.update([track(1)], 100);
  const before = session.snapshot(100);
  session.clearTarget();
  assert.equal(session.target, null);
  assert.deepEqual(session.snapshot(101).matches, []);
  assert.deepEqual(session.snapshot(101).others, []);
  assert.equal(before.target.data, "00123");
  assert.equal(before.matches[0].data, "00123");
});

test("input records, target getters and output snapshots do not alias internal state", () => {
  const session = active();
  const input = [track(1), track(2, "OTHER")];
  const original = copy(input);
  session.update(deepFreeze(input), 100);
  assert.deepEqual(input, original);
  const target = session.target;
  const snapshot = session.snapshot(100);
  // Either frozen public snapshots or independent mutable copies are safe.
  try { target.data = "WRONG"; } catch (error) { assert.ok(error instanceof TypeError); }
  try { snapshot.matches[0].data = "WRONG"; } catch (error) { assert.ok(error instanceof TypeError); }
  try { snapshot.others.length = 0; } catch (error) { assert.ok(error instanceof TypeError); }
  assert.equal(session.target.data, "00123");
  assert.deepEqual(values(session.snapshot(100).matches), ["00123"]);
  assert.deepEqual(values(session.snapshot(100).others), ["OTHER"]);
});

test("invalid target replacement leaves the accepted target and observations intact", () => {
  const session = active();
  session.update([track(1)], 100);
  const before = session.snapshot(100);
  for (const data of ["", "x".repeat(4097), 123, null, undefined]) {
    assert.throws(() => session.setTarget(data));
    assert.deepEqual(session.snapshot(100), before);
  }
  assert.throws(() => session.setTarget("B", "x".repeat(121)));
  assert.deepEqual(session.snapshot(100), before);
  session.setTarget("x".repeat(4096), "n".repeat(120));
  assert.equal(session.target.data.length, 4096);
});

test("a malformed late record cannot partially replace an accepted frame", () => {
  const session = active();
  session.update([track(1)], 100);
  const before = session.snapshot(100);
  for (const bad of [track(NaN), track(-1), track(2, "A", NaN), { ...track(2), data: 123 }]) {
    assert.throws(() => session.update([track(3, "NEW", 101), bad], 101));
    assert.deepEqual(session.snapshot(100), before);
  }
});

test("observation capacity is bounded and an overflowing frame changes nothing", () => {
  assert.equal(PICKING_MAX_OBSERVATIONS, 512);
  const session = active();
  const maximum = Array.from({ length: PICKING_MAX_OBSERVATIONS }, (_, index) => track(index + 1, index % 2 ? "OTHER" : "00123"));
  session.update(maximum, 100);
  assert.equal(session.snapshot(100).matches.length + session.snapshot(100).others.length, PICKING_MAX_OBSERVATIONS);
  const before = session.snapshot(100);
  assert.throws(() => session.update([...maximum, track(10000)], 101));
  assert.deepEqual(session.snapshot(100), before);
});

test("duplicate IDs reject the complete frame without consuming a new version", () => {
  const session = active();
  session.update([track(1)], 100);
  const before = session.snapshot(100);
  assert.throws(() => session.update([track(1, "OTHER", 101), track(1, "00123", 101)], 101));
  assert.deepEqual(session.snapshot(100), before);
  session.update([track(1, "00123", 101)], 101);
  assert.equal(session.snapshot(101).matches[0].observedAt, 101);
});

test("invalid and backwards update clocks are atomic while snapshot reads own no clock", () => {
  const session = active();
  session.update([track(1)], 100);
  const before = session.snapshot(100);
  for (const at of [NaN, Infinity, -1, "101", 99]) {
    assert.throws(() => session.update([track(2, "NEW", 101)], at));
    assert.deepEqual(session.snapshot(100), before);
  }
  assert.equal(session.snapshot(10000).matches.length, 0);
  session.update([track(1, "00123", 101)], 101);
  assert.equal(session.snapshot(101).matches.length, 1);
  for (const at of [NaN, Infinity, -1, "101"]) assert.throws(() => session.snapshot(at));
});

test("static images partition exact values without creating tracked IDs or quantities", () => {
  const target = { data: " 00123 ", name: "Target" };
  const input = deepFreeze([{ data: "00123", symbologyName: "QR Code" }, { data: target.data, symbologyName: "Data Matrix" }, { data: target.data, symbologyName: "QR Code" }]);
  const result = classifyPickingBarcodes(target, input);
  assert.deepEqual(values(result.matches), [target.data, target.data]);
  assert.deepEqual(values(result.others), ["00123"]);
  assert.ok([...result.matches, ...result.others].every((value) => !("id" in value) && !("quantity" in value)));
  assert.deepEqual(classifyPickingBarcodes({ data: "OTHER", name: "" }, input).matches, []);
});

// GTIN equivalence. ZXing reports an EAN-13 printed "0012345678905" as UPC-A "012345678905".
const EAN13 = "0012345678905";
const UPCA = "012345678905";
const NEIGHBOR = "012345678912"; // A different product with a valid check digit.
const NAMES = { upca: "UPC-A", ean13: "EAN-13", ean8: "EAN-8", upce: "UPC-E", itf: "Interleaved 2 of 5", itf14: "ITF-14", code128: "Code 128", databar: "GS1 DataBar", qr: "QR Code", "data-matrix": "Data Matrix" };
const scanned = (id, data, symbology, isGS1 = false) => ({ id, data, symbology, symbologyName: NAMES[symbology], isGS1, lastSeen: 100 });
const ids = (observations) => observations.map(({ id }) => id);

test("a UPC-A scan matches a target typed as its 13-digit EAN and keeps its decoded value", () => {
  const session = active(EAN13);
  session.update([scanned(1, UPCA, "upca"), scanned(2, UPCA, "code128"), scanned(3, EAN13, "qr"), scanned(4, NEIGHBOR, "upca")], 10);
  const state = session.snapshot(10);
  assert.deepEqual(ids(state.matches), [1, 3]);
  assert.deepEqual(state.matches[0], { ...scanned(1, UPCA, "upca"), observedAt: 10 }, "The decoded value and symbology are shown as-is.");
  assert.deepEqual(ids(state.others), [2, 4]);
  const reverse = active(UPCA);
  reverse.update([scanned(1, EAN13, "ean13"), scanned(2, `0${NEIGHBOR}`, "ean13")], 10);
  assert.deepEqual(ids(reverse.snapshot(10).matches), [1]);
});

test("UPC-E, ITF-14, GS1 element strings and Digital Links match the target's GTIN", () => {
  const session = active(EAN13);
  const equivalent = [
    scanned(1, "00012345678905", "itf"), scanned(2, "00012345678905", "itf14"), scanned(3, "(01)00012345678905(10)LOT1", "code128", true),
    scanned(4, "(01)00012345678905", "databar", true), scanned(5, "https://id.gs1.org/01/00012345678905/10/ABC", "qr"),
    scanned(6, "(01)00012345678905(17)271231", "data-matrix", true),
  ];
  session.update([...equivalent, scanned(7, "10012345678902", "itf")], 10);
  assert.deepEqual(ids(session.snapshot(10).matches), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(session.snapshot(10).others), [7], "An ITF-14 case indicator is a different GTIN.");
  const upce = active("012345000065");
  upce.update([scanned(1, "01234565", "upce"), scanned(2, "01234565", "ean8")], 10);
  assert.deepEqual(ids(upce.snapshot(10).matches), [1], "UPC-E expands to its UPC-A; the same digits as EAN-8 are another product.");
  const gtin14 = active("00012345678905");
  gtin14.update([scanned(1, UPCA, "upca")], 10);
  assert.equal(gtin14.snapshot(10).matches.length, 1);
});

test("invalid check digits, other symbologies and non-GTIN targets stay exact-only", () => {
  const session = active(EAN13);
  const unmatched = [
    scanned(1, UPCA, "code128"), scanned(2, UPCA, "qr"), scanned(3, "(01)00012345678905", "data-matrix"),
    scanned(4, "(01)00012345678906", "code128", true), scanned(5, "(02)00012345678905(37)10", "code128", true),
    scanned(6, "https://id.gs1.org/01/00012345678906", "qr"), scanned(7, UPCA, "itf"), track(8, UPCA),
    { id: 9, data: UPCA, symbologyName: "UPC-A", lastSeen: 100 },
  ];
  session.update(unmatched, 10);
  assert.deepEqual(session.snapshot(10).matches, []);
  assert.equal(session.snapshot(10).others.length, unmatched.length);
  const invalid = active("0012345678906");
  invalid.update([scanned(1, "012345678906", "upca"), scanned(2, UPCA, "upca"), scanned(3, "0012345678906", "code128")], 10);
  assert.deepEqual(ids(invalid.snapshot(10).matches), [3], "An invalid check digit matches only its exact value.");
  for (const target of [` ${EAN13}`, `${EAN13}\n`, "12345678905"]) {
    const spaced = active(target);
    spaced.update([scanned(1, UPCA, "upca"), scanned(2, target, "qr")], 10);
    assert.deepEqual(ids(spaced.snapshot(10).matches), [2], JSON.stringify(target));
  }
});

test("a target change re-evaluates GTIN matches and a changed symbology is a fresh observation", () => {
  const session = active(EAN13);
  session.update([scanned(1, UPCA, "upca")], 10);
  assert.equal(session.snapshot(10).matches.length, 1);
  session.update([scanned(1, UPCA, "code128")], 20);
  assert.deepEqual(session.snapshot(20).matches, []);
  assert.equal(session.snapshot(20).others[0].observedAt, 20);
  session.setTarget("QRGEN-COFFEE");
  session.update([scanned(1, UPCA, "upca")], 30);
  assert.deepEqual(session.snapshot(30).matches, []);
  session.setTarget(UPCA);
  session.update([scanned(1, UPCA, "code128")], 40);
  assert.equal(session.snapshot(40).matches.length, 1, "Exact values match in any symbology.");
});

test("still images match GTIN-equivalent results and keep their decoded values", () => {
  const input = deepFreeze([UPCA, NEIGHBOR].flatMap((data) => ["upca", "code128"].map((symbology) => ({ data, symbology, symbologyName: NAMES[symbology], isGS1: false }))));
  const result = classifyPickingBarcodes({ data: EAN13, name: "" }, input);
  assert.deepEqual(result.matches, [input[0]]);
  assert.deepEqual(result.others, input.slice(1));
  assert.throws(() => classifyPickingBarcodes({ data: EAN13, name: "" }, [{ data: UPCA, symbologyName: "UPC-A", symbology: 1 }]), /Invalid barcode/);
  assert.throws(() => classifyPickingBarcodes({ data: EAN13, name: "" }, [{ data: UPCA, symbologyName: "UPC-A", isGS1: "yes" }]), /Invalid barcode/);
});
