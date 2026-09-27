/**
 * Parser for the AAMVA PDF417 barcode on the back of North American driver
 * licenses and identification cards (AAMVA DL/ID Card Design Standard, 2000-2020).
 */
export interface AamvaResult {
  issuerId: string;
  aamvaVersion: number;
  jurisdictionVersion: number;
  documentType: "DL" | "ID" | string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  fullName: string;
  dateOfBirth: string;
  issueDate: string;
  expiryDate: string;
  sex: "M" | "F" | "X" | "";
  documentNumber: string;
  documentDiscriminator: string;
  street: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  eyeColor: string;
  hairColor: string;
  height: string;
  weight: string;
  vehicleClass: string;
  restrictions: string;
  endorsements: string;
  /** Age in whole years at the time of parsing, or null when the birth date is unknown. */
  age: number | null;
  isExpired: boolean | null;
  isUnder21: boolean | null;
  isUnder18: boolean | null;
  /** Every element as code → value (e.g. { DAQ: "D1234567" }). */
  fields: Record<string, string>;
}

export interface AamvaOptions {
  /** Reference date for age / expiry checks. Default: now. */
  now?: Date;
}

/** Human readable labels for common AAMVA element ids. */
export const AAMVA_FIELDS: Readonly<Record<string, string>> = {
  DCA: "Jurisdiction-specific vehicle class",
  DCB: "Jurisdiction-specific restriction codes",
  DCD: "Jurisdiction-specific endorsement codes",
  DBA: "Document expiration date",
  DCS: "Customer family name",
  DAC: "Customer first name",
  DAD: "Customer middle name(s)",
  DBD: "Document issue date",
  DBB: "Date of birth",
  DBC: "Physical description – sex",
  DAY: "Physical description – eye color",
  DAU: "Physical description – height",
  DAG: "Address – street 1",
  DAH: "Address – street 2",
  DAI: "Address – city",
  DAJ: "Address – jurisdiction code",
  DAK: "Address – postal code",
  DAQ: "Customer ID number",
  DCF: "Document discriminator",
  DCG: "Country identification",
  DDE: "Family name truncation",
  DDF: "First name truncation",
  DDG: "Middle name truncation",
  DAZ: "Hair color",
  DCI: "Place of birth",
  DCJ: "Audit information",
  DCK: "Inventory control number",
  DBN: "Alias / AKA family name",
  DBG: "Alias / AKA given name",
  DBS: "Alias / AKA suffix name",
  DCU: "Name suffix",
  DCE: "Physical description – weight range",
  DCL: "Race / ethnicity",
  DCM: "Standard vehicle classification",
  DCN: "Standard endorsement code",
  DCO: "Standard restriction code",
  DDA: "Compliance type",
  DDB: "Card revision date",
  DDC: "HAZMAT endorsement expiration date",
  DDD: "Limited duration document indicator",
  DAW: "Weight (pounds)",
  DAX: "Weight (kilograms)",
  DDH: "Under 18 until",
  DDI: "Under 19 until",
  DDJ: "Under 21 until",
  DDK: "Organ donor indicator",
  DDL: "Veteran indicator",
  DAA: "Customer full name (legacy)",
  DAB: "Customer family name (legacy)",
  DCT: "Customer given names (legacy)",
  DAE: "Name suffix (legacy)",
  DBP: "Customer given names (legacy)",
};

const CANADIAN_ISSUERS = new Set([
  "604427", "604428", "604429", "604430", "604431", "604432", "604433", "604434", "604435", "604436",
  "636012", "636013", "636016", "636017", "636028", "636044", "636048", "990876",
]);

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function validDate(y: number, m: number, d: number): boolean {
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Parse an 8-digit AAMVA date. USA uses MMDDCCYY, Canada CCYYMMDD. */
export function parseAamvaDate(value: string | undefined, canadian: boolean): string {
  if (!value) return "";
  const v = value.replace(/\D/g, "");
  if (v.length !== 8) return "";
  const asUS: [number, number, number] = [Number(v.slice(4, 8)), Number(v.slice(0, 2)), Number(v.slice(2, 4))];
  const asCA: [number, number, number] = [Number(v.slice(0, 4)), Number(v.slice(4, 6)), Number(v.slice(6, 8))];
  const [first, second] = canadian ? [asCA, asUS] : [asUS, asCA];
  if (validDate(...first)) return iso(...first);
  if (validDate(...second)) return iso(...second);
  return "";
}

function ageOn(dob: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

function clean(v: string | undefined): string {
  if (!v) return "";
  const t = v.trim();
  return /^(NONE|UNAVL|UNAVAIL|N\/A)$/i.test(t) ? "" : t;
}

/**
 * Parse AAMVA driver license / ID card data. Returns null if the input does not look
 * like AAMVA data. Unknown or jurisdiction-specific (Z*) elements are kept in `fields`.
 */
export function parseAAMVA(input: string, options: AamvaOptions = {}): AamvaResult | null {
  if (typeof input !== "string") return null;
  const headerIdx = input.search(/ANSI ?\d{6}|AAMVA\d{6}/);
  if (headerIdx === -1) return null;
  const now = options.now ?? new Date();

  const header = /(?:ANSI ?|AAMVA)(\d{6})(\d{2})(\d{2})?(\d{2})?/.exec(input.slice(headerIdx));
  const issuerId = header?.[1] ?? "";
  const aamvaVersion = Number(header?.[2] ?? 0);
  const jurisdictionVersion = aamvaVersion >= 2 ? Number(header?.[3] ?? 0) : 0;

  // Subfile designators follow the header: type(2) offset(4) length(4).
  const afterHeader = input.slice(headerIdx).replace(/^(?:ANSI ?|AAMVA)\d{6}\d{2}(?:\d{2})?\d{2}/, "");
  const designators = [...afterHeader.matchAll(/(DL|ID|Z[A-Z])(\d{4})(\d{4})/g)].map((m) => m[1]!);
  const documentType = designators.find((d) => d === "DL" || d === "ID") ?? (/\nDL|DLDAQ|DLDCA/.test(input) ? "DL" : /\nID|IDDAQ/.test(input) ? "ID" : "DL");

  const fields: Record<string, string> = {};
  const lines = input.slice(headerIdx).split(/[\n\r\u001e]+/);
  for (let rawLine of lines) {
    let line = rawLine.replace(/^\s+/, "");
    // The first line holds the header + designators and then the first element.
    const hdr = /(?:ANSI ?|AAMVA)\d{6}\d{2}(?:\d{2})?\d{2}(?:(?:DL|ID|Z[A-Z])\d{8})*/.exec(line);
    if (hdr && hdr.index === 0) line = line.slice(hdr[0].length);
    // Subfile type prefix directly before the first element.
    line = line.replace(/^(DL|ID|Z[A-Z])(?=[DZ][A-Z]{2})/, "");
    const m = /^([DZ][A-Z]{2})(.*)$/.exec(line);
    if (!m) continue;
    const code = m[1]!;
    if (!(code in fields)) fields[code] = m[2]!.trim();
  }
  if (!fields.DAQ && !fields.DCS && !fields.DAA && !fields.DBB) return null;

  const country = clean(fields.DCG) || (CANADIAN_ISSUERS.has(issuerId) ? "CAN" : "USA");
  const canadian = country === "CAN";

  let lastName = clean(fields.DCS) || clean(fields.DAB);
  let firstName = clean(fields.DAC) || clean(fields.DCT)?.split(/[,$ ]/)[0] || "";
  let middleName = clean(fields.DAD) || (clean(fields.DCT)?.split(/[,$ ]/).slice(1).join(" ") ?? "");
  if (!lastName && fields.DAA) {
    const parts = fields.DAA.split(/[,$]/).map((p) => p.trim());
    if (parts.length >= 2) {
      [lastName = "", firstName = "", middleName = ""] = parts;
    } else {
      const words = fields.DAA.trim().split(/\s+/);
      firstName = words[0] ?? "";
      lastName = words[words.length - 1] ?? "";
      middleName = words.slice(1, -1).join(" ");
    }
  }
  const suffix = clean(fields.DCU) || clean(fields.DAE);
  const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(" ");

  const sexRaw = clean(fields.DBC).toUpperCase();
  const sex = sexRaw === "1" || sexRaw === "M" ? "M" : sexRaw === "2" || sexRaw === "F" ? "F" : sexRaw === "9" || sexRaw === "X" ? "X" : "";

  const dateOfBirth = parseAamvaDate(fields.DBB, canadian);
  const issueDate = parseAamvaDate(fields.DBD, canadian);
  const expiryDate = parseAamvaDate(fields.DBA, canadian);
  const age = ageOn(dateOfBirth, now);
  const today = iso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());

  const zip = clean(fields.DAK).replace(/\s+/g, "");
  const postalCode = canadian ? zip : /^\d{9}$/.test(zip) && zip.endsWith("0000") ? zip.slice(0, 5) : /^\d{9}$/.test(zip) ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip;

  return {
    issuerId,
    aamvaVersion,
    jurisdictionVersion,
    documentType,
    firstName,
    middleName,
    lastName,
    suffix,
    fullName,
    dateOfBirth,
    issueDate,
    expiryDate,
    sex,
    documentNumber: clean(fields.DAQ),
    documentDiscriminator: clean(fields.DCF),
    street: clean(fields.DAG),
    street2: clean(fields.DAH),
    city: clean(fields.DAI),
    state: clean(fields.DAJ),
    postalCode,
    country,
    eyeColor: clean(fields.DAY),
    hairColor: clean(fields.DAZ),
    height: clean(fields.DAU),
    weight: clean(fields.DAW) || clean(fields.DAX),
    vehicleClass: clean(fields.DCA),
    restrictions: clean(fields.DCB),
    endorsements: clean(fields.DCD),
    age,
    isExpired: expiryDate ? expiryDate < today : null,
    isUnder21: age == null ? null : age < 21,
    isUnder18: age == null ? null : age < 18,
    fields,
  };
}
