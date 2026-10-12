import { scannedGtin, typedGtin } from "./gtin.ts";

/** Recent decoded observations for one target; never a quantity ledger. */
export const PICKING_RECENT_MS = 500;
export const PICKING_MAX_OBSERVATIONS = 512;

export interface PickingTarget { data: string; name: string }
/** `symbology` (SDK id) and `isGS1` let a retail barcode match by GTIN; without them, only the exact value matches. */
export interface PickingBarcode { data: string; symbologyName: string; symbology?: string; isGS1?: boolean }
export interface PickingTrack extends PickingBarcode { id: number; lastSeen: number }
export interface PickingObservation extends PickingTrack { observedAt: number }
export interface PickingSnapshot {
  target: PickingTarget | null;
  generation: number;
  matches: PickingObservation[];
  others: PickingObservation[];
}

function elapsed(at: number): number {
  if (!Number.isFinite(at) || at < 0) throw new Error("Observation time must be finite and nonnegative.");
  return at;
}
function barcode(input: PickingBarcode): PickingBarcode {
  const { data, symbologyName, symbology, isGS1 } = input;
  if (typeof data !== "string" || typeof symbologyName !== "string" || !symbologyName.length) throw new Error("Invalid barcode observation.");
  if ((symbology !== undefined && typeof symbology !== "string") || (isGS1 !== undefined && typeof isGS1 !== "boolean")) throw new Error("Invalid barcode observation.");
  const copy: PickingBarcode = { data, symbologyName };
  if (symbology !== undefined) copy.symbology = symbology;
  if (isGS1 !== undefined) copy.isGS1 = isGS1;
  return copy;
}
function bounded(inputs: readonly unknown[]): void {
  if (!Array.isArray(inputs) || inputs.length > PICKING_MAX_OBSERVATIONS) throw new Error("Up to 512 observations can be reviewed at once.");
}
function sameBarcode(a: PickingBarcode, b: PickingBarcode): boolean {
  return a.data === b.data && a.symbologyName === b.symbologyName && a.symbology === b.symbology && a.isGS1 === b.isGS1;
}

/**
 * Whether a decoded barcode is the target: exactly the target value, or a retail
 * barcode with the GTIN the target's digits spell (a UPC-A matches its 13-digit
 * EAN form). Values without a GTIN match exactly, including spaces, line breaks,
 * case and leading zeros.
 */
export function matchesPickingTarget(target: PickingTarget, item: PickingBarcode, targetGtin: string | null = typedGtin(target.data)): boolean {
  return item.data === target.data || (targetGtin !== null && scannedGtin(item) === targetGtin);
}

/** Explicit monotonic observation times; SDK lastSeen is a version, not this clock. */
export class PickingSession {
  private chosen: PickingTarget | null = null;
  private chosenGtin: string | null = null;
  private revision = 0;
  // A target change resets observations, so each one's match is fixed for its lifetime.
  private observations = new Map<number, { observation: PickingObservation; match: boolean }>();
  private updatedAt: number | null = null;

  get target(): PickingTarget | null { return this.chosen ? { ...this.chosen } : null; }
  get generation(): number { return this.revision; }

  setTarget(data: string, name = ""): void {
    if (typeof data !== "string" || !data.length || data.length > 4096) throw new Error("Enter a barcode value from 1 to 4,096 characters.");
    if (typeof name !== "string" || name.length > 120) throw new Error("The local product name can contain up to 120 characters.");
    this.chosen = { data, name };
    this.chosenGtin = typedGtin(data);
    this.reset();
  }

  clearTarget(): void { this.chosen = null; this.chosenGtin = null; this.reset(); }

  /** A target/source/reset boundary discards observations, including expired versions. */
  reset(): void {
    this.revision++;
    this.observations.clear();
    this.updatedAt = null;
  }

  /** Replace membership from the complete authoritative track event, atomically. */
  update(inputs: readonly PickingTrack[], at: number): void {
    elapsed(at);
    if (this.updatedAt !== null && at < this.updatedAt) throw new Error("Observation time cannot move backwards.");
    bounded(inputs);
    const next = new Map<number, { observation: PickingObservation; match: boolean }>();
    for (const input of inputs) {
      const item = barcode(input);
      const { id, lastSeen } = input;
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(lastSeen) || next.has(id)) throw new Error("Invalid or repeated track ID/version.");
      const previous = this.observations.get(id);
      const same = previous !== undefined && sameBarcode(previous.observation, item);
      const unchanged = same && previous.observation.lastSeen === lastSeen;
      const match = same ? previous.match : this.chosen !== null && matchesPickingTarget(this.chosen, item, this.chosenGtin);
      next.set(id, { observation: { ...item, id, lastSeen, observedAt: unchanged ? previous.observation.observedAt : at }, match });
    }
    this.observations = next;
    this.updatedAt = at;
  }

  /** A read expires presentation without forgetting versions still in the SDK's list. */
  snapshot(at: number): PickingSnapshot {
    elapsed(at);
    const matches: PickingObservation[] = [], others: PickingObservation[] = [];
    for (const { observation, match } of this.observations.values()) {
      if (at - observation.observedAt > PICKING_RECENT_MS) continue;
      (this.chosen && match ? matches : others).push({ ...observation });
    }
    return { target: this.target, generation: this.generation, matches, others };
  }
}

/** Still-image results are a separate source, without track IDs or physical quantities. */
export function classifyPickingBarcodes(target: PickingTarget, inputs: readonly PickingBarcode[]): { matches: PickingBarcode[]; others: PickingBarcode[] } {
  bounded(inputs);
  const copied = inputs.map(barcode);
  const gtin = typedGtin(target.data);
  const matches: PickingBarcode[] = [], others: PickingBarcode[] = [];
  for (const item of copied) (matchesPickingTarget(target, item, gtin) ? matches : others).push(item);
  return { matches, others };
}
