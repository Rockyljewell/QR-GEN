/** Confirmed receiving quantities. Scanner observations never change quantities. */
export interface ReceivingItem {
  code: string;
  name: string;
  expected: number | null;
  received: number;
}

export type ReceivingCommand =
  | { id: string; kind: "add"; code: string; name: string; expected: number | null }
  | { id: string; kind: "receive"; code: string; quantity: number }
  | { id: string; kind: "correct"; code: string; quantity: number; reason: string; expectedRevision: number };

export interface ReceivingSession {
  schema: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  items: ReceivingItem[];
  actions: { command: ReceivingCommand; at: number }[];
}

const MAX_QUANTITY = 1_000_000;
const MAX_ITEMS = 500;
const MAX_ACTIONS = 10_000;

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} must contain 1–${max} characters.`);
  return value;
}
function integer(value: unknown, label: string, min = 0, max = MAX_QUANTITY): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}
function identifier(value: unknown): string {
  const id = text(value, "Action or delivery ID", 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid action or delivery ID.");
  return id;
}
function timestamp(value: unknown): number {
  return integer(value, "Timestamp", 0, Number.MAX_SAFE_INTEGER);
}

function normalize(command: ReceivingCommand): ReceivingCommand {
  const id = identifier(command.id);
  const code = text(command.code, "Barcode value", 4096);
  if (command.kind === "add") return { id, kind: "add", code, name: text(command.name, "Product name", 120).trim(), expected: command.expected === null ? null : integer(command.expected, "Expected quantity", 1) };
  if (command.kind === "receive") return { id, kind: "receive", code, quantity: integer(command.quantity, "Received quantity", 1) };
  if (command.kind === "correct") return { id, kind: "correct", code, quantity: integer(command.quantity, "Corrected quantity"), reason: text(command.reason, "Correction reason", 240).trim(), expectedRevision: integer(command.expectedRevision, "Revision", 0, MAX_ACTIONS) };
  throw new Error("Unknown receiving action.");
}

export function createReceivingSession(id: string, name: string, at = Date.now()): ReceivingSession {
  return { schema: 1, id: identifier(id), name: text(name, "Delivery name", 120).trim(), createdAt: timestamp(at), updatedAt: at, revision: 0, items: [], actions: [] };
}

function changeItems(items: Map<string, ReceivingItem>, command: ReceivingCommand, revision: number): void {
  const item = items.get(command.code);
  if (command.kind === "add") {
    if (item) throw new Error("This barcode is already in the delivery.");
    if (items.size >= MAX_ITEMS) throw new Error("A delivery can contain up to 500 different products.");
    items.set(command.code, { code: command.code, name: command.name, expected: command.expected, received: 0 });
  } else {
    if (!item) throw new Error("Add this barcode to the delivery before confirming a quantity.");
    if (command.kind === "correct") {
      if (command.expectedRevision !== revision) throw new Error("The delivery changed in another tab. Review the latest quantities and retry the correction.");
      item.received = command.quantity;
    } else item.received = integer(item.received + command.quantity, "Total received quantity");
  }
}

/** Pure, repeat-safe command application. Corrections require the displayed revision. */
export function applyReceivingCommand(session: ReceivingSession, input: ReceivingCommand, at = Date.now()): ReceivingSession {
  const command = normalize(input);
  const signature = JSON.stringify(command);
  const repeated = session.actions.find(action => action.command.id === command.id);
  if (repeated) {
    if (JSON.stringify(repeated.command) !== signature) throw new Error("This action ID was already used for a different change.");
    return session;
  }
  if (session.actions.length >= MAX_ACTIONS) throw new Error("This delivery has reached 10,000 changes. Export it and start another delivery.");
  timestamp(at);
  const items = new Map(session.items.map(item => [item.code, { ...item }]));
  changeItems(items, command, session.revision);
  return { ...session, items: [...items.values()], updatedAt: at, revision: session.revision + 1, actions: [...session.actions, { command, at }] };
}

/** Reject malformed or inconsistent saved state instead of silently trusting its totals. */
export function validateReceivingSession(value: unknown): ReceivingSession {
  if (!value || typeof value !== "object") throw new Error("The saved delivery is unreadable.");
  const saved = value as ReceivingSession;
  if (saved.schema !== 1 || !Array.isArray(saved.actions) || !Array.isArray(saved.items) || saved.actions.length > MAX_ACTIONS || saved.items.length > MAX_ITEMS) throw new Error("Unsupported or oversized saved delivery.");
  let replay = createReceivingSession(saved.id, saved.name, saved.createdAt);
  const ids = new Set<string>();
  const items = new Map<string, ReceivingItem>();
  // Replay only bounded saved actions, including revision guards and total bounds.
  for (const action of saved.actions) {
    if (!action || !action.command || ids.has(action.command.id)) throw new Error("The saved delivery contains duplicate or invalid actions.");
    const command = normalize(action.command);
    ids.add(command.id);
    changeItems(items, command, replay.revision);
    replay.actions.push({ command, at: timestamp(action.at) });
    replay.revision++;
    replay.updatedAt = action.at;
  }
  replay.items = [...items.values()];
  if (saved.revision !== replay.revision || saved.updatedAt !== replay.updatedAt || JSON.stringify(saved.items) !== JSON.stringify(replay.items)) throw new Error("The saved delivery totals do not match its history.");
  return replay;
}

export function receivingStatus(item: ReceivingItem): string {
  if (item.expected === null) return "Unexpected product";
  if (item.received === item.expected) return "Complete";
  if (item.received > item.expected) return `Over by ${item.received - item.expected}`;
  return `${item.expected - item.received} remaining`;
}

/** Identical revision => identical bytes and export ID, including audit history. */
export function exportReceivingSession(session: ReceivingSession): string {
  const checked = validateReceivingSession(session);
  return JSON.stringify({
    schema: "qrgen-receiving-v1",
    exportId: `${checked.id}:${checked.revision}`,
    sessionId: checked.id,
    revision: checked.revision,
    delivery: checked.name,
    createdAt: checked.createdAt,
    updatedAt: checked.updatedAt,
    items: checked.items.map(item => ({ ...item, difference: item.expected === null ? null : item.received - item.expected })),
    history: checked.actions,
  }, null, 2) + "\n";
}
