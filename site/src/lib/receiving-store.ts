import { applyReceivingCommand, validateReceivingSession, type ReceivingCommand, type ReceivingSession } from "./receiving";

const DB_NAME = "qrgen-receiving-v1";
let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let failed = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("settings");
    };
    request.onerror = () => { failed = true; opening = undefined; reject(new Error("Browser storage is unavailable. Enable site storage to save receiving quantities.")); };
    request.onblocked = () => { failed = true; opening = undefined; reject(new Error("Close older receiving tabs and retry to open saved deliveries.")); };
    request.onsuccess = () => {
      const db = request.result;
      if (failed) { db.close(); return; }
      db.onversionchange = () => { db.close(); opening = undefined; };
      // The browser can close the connection itself (site data cleared, storage pressure).
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
  });
  return opening;
}

/** Read and write inside one IndexedDB transaction, so parallel tabs cannot lose confirmations. */
async function transact<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction, setResult: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["sessions", "settings"], mode, { durability: "strict" });
    let result: T;
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? new Error("The delivery could not be saved. Your previous saved quantities are unchanged."));
    tx.onerror = () => { /* onabort reports transaction failure */ };
    const fail = (error: Error) => { failure = error; tx.abort(); };
    try { work(tx, value => { result = value; }, fail); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}

export const receivingStore = {
  list(): Promise<{ sessions: ReceivingSession[]; active?: string; unreadable: number }> {
    return transact("readonly", (tx, done, fail) => {
      const rows = tx.objectStore("sessions").getAll();
      const active = tx.objectStore("settings").get("active");
      active.onsuccess = () => {
        try {
          const sessions: ReceivingSession[] = [];
          let unreadable = 0;
          for (const row of rows.result) {
            try { sessions.push(validateReceivingSession(row)); }
            catch { unreadable++; } // Preserve the record; allow other deliveries to open.
          }
          done({ sessions, active: typeof active.result === "string" ? active.result : undefined, unreadable });
        }
        catch (error) { fail(error as Error); }
      };
    });
  },
  read(id: string): Promise<ReceivingSession> {
    return transact("readonly", (tx, done, fail) => {
      const request = tx.objectStore("sessions").get(id);
      request.onsuccess = () => { try { done(validateReceivingSession(request.result)); } catch (error) { fail(error as Error); } };
    });
  },
  create(session: ReceivingSession): Promise<ReceivingSession> {
    const checked = validateReceivingSession(session);
    return transact("readwrite", (tx, done) => {
      tx.objectStore("sessions").add(checked);
      tx.objectStore("settings").put(checked.id, "active");
      done(checked);
    });
  },
  activate(id: string): Promise<void> {
    return transact("readwrite", (tx, done, fail) => {
      const request = tx.objectStore("sessions").get(id);
      request.onsuccess = () => {
        try { validateReceivingSession(request.result); tx.objectStore("settings").put(id, "active"); done(); }
        catch (error) { fail(error as Error); }
      };
    });
  },
  apply(id: string, command: ReceivingCommand): Promise<ReceivingSession> {
    return transact("readwrite", (tx, done, fail) => {
      const request = tx.objectStore("sessions").get(id);
      request.onsuccess = () => {
        try {
          const current = validateReceivingSession(request.result);
          const next = applyReceivingCommand(current, command);
          if (next !== current) tx.objectStore("sessions").put(next);
          done(next);
        } catch (error) { fail(error as Error); }
      };
    });
  },
};
