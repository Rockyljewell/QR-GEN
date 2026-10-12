/** Recent decoded observations for one exact target; never a quantity ledger. */
export const PICKING_RECENT_MS = 500;
export const PICKING_MAX_OBSERVATIONS = 512;

export interface PickingTarget { data: string; name: string }
export interface PickingBarcode { data: string; symbologyName: string }
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
  const { data, symbologyName } = input;
  if (typeof data !== "string" || typeof symbologyName !== "string" || !symbologyName.length) throw new Error("Invalid barcode observation.");
  return { data, symbologyName };
}
function bounded(inputs: readonly unknown[]): void {
  if (!Array.isArray(inputs) || inputs.length > PICKING_MAX_OBSERVATIONS) throw new Error("Up to 512 observations can be reviewed at once.");
}

/** Explicit monotonic observation times; SDK lastSeen is a version, not this clock. */
export class PickingSession {
  private chosen: PickingTarget | null = null;
  private revision = 0;
  private observations = new Map<number, PickingObservation>();
  private updatedAt: number | null = null;

  get target(): PickingTarget | null { return this.chosen ? { ...this.chosen } : null; }
  get generation(): number { return this.revision; }

  setTarget(data: string, name = ""): void {
    if (typeof data !== "string" || !data.length || data.length > 4096) throw new Error("Enter a barcode value from 1 to 4,096 characters.");
    if (typeof name !== "string" || name.length > 120) throw new Error("The local product name can contain up to 120 characters.");
    this.chosen = { data, name };
    this.reset();
  }

  clearTarget(): void { this.chosen = null; this.reset(); }

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
    const next = new Map<number, PickingObservation>();
    for (const input of inputs) {
      const item = barcode(input);
      const { id, lastSeen } = input;
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(lastSeen) || next.has(id)) throw new Error("Invalid or repeated track ID/version.");
      const previous = this.observations.get(id);
      const unchanged = previous && previous.lastSeen === lastSeen && previous.data === item.data && previous.symbologyName === item.symbologyName;
      next.set(id, { ...item, id, lastSeen, observedAt: unchanged ? previous.observedAt : at });
    }
    this.observations = next;
    this.updatedAt = at;
  }

  /** A read expires presentation without forgetting versions still in the SDK's list. */
  snapshot(at: number): PickingSnapshot {
    elapsed(at);
    const matches: PickingObservation[] = [], others: PickingObservation[] = [];
    for (const item of this.observations.values()) {
      if (at - item.observedAt > PICKING_RECENT_MS) continue;
      (this.chosen && item.data === this.chosen.data ? matches : others).push({ ...item });
    }
    return { target: this.target, generation: this.generation, matches, others };
  }
}

/** Still-image results are a separate source, without track IDs or physical quantities. */
export function classifyPickingBarcodes(target: PickingTarget, inputs: readonly PickingBarcode[]): { matches: PickingBarcode[]; others: PickingBarcode[] } {
  bounded(inputs);
  const copied = inputs.map(barcode);
  return { matches: copied.filter(item => item.data === target.data), others: copied.filter(item => item.data !== target.data) };
}
