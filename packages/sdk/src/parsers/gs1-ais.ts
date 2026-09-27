/**
 * GS1 Application Identifier table (subset of the GS1 General Specifications
 * covering the identifiers seen on real products, logistics labels and
 * healthcare packs).
 *
 * `fixed`: exact value length. `max`: maximum value length for variable AIs.
 * `decimal`: the last AI digit is the implied decimal point position.
 * `date`: value is YYMMDD. `check`: last digit is a mod-10 check digit.
 */
export interface AIDefinition {
  title: string;
  description: string;
  fixed?: number;
  max?: number;
  numeric?: boolean;
  decimal?: boolean;
  date?: boolean;
  check?: boolean;
  /** For 391n/393n/421/423/425: first 3 digits are an ISO 3166/4217 code. */
  isoPrefix?: boolean;
}

type Def = Omit<AIDefinition, "description"> & { description?: string };

const T: Record<string, Def> = {
  "00": { title: "SSCC", description: "Serial Shipping Container Code", fixed: 18, numeric: true, check: true },
  "01": { title: "GTIN", description: "Global Trade Item Number", fixed: 14, numeric: true, check: true },
  "02": { title: "CONTENT", description: "GTIN of contained trade items", fixed: 14, numeric: true, check: true },
  "03": { title: "MTO GTIN", description: "GTIN of made-to-order trade item", fixed: 14, numeric: true, check: true },
  "10": { title: "BATCH/LOT", description: "Batch or lot number", max: 20 },
  "11": { title: "PROD DATE", description: "Production date", fixed: 6, numeric: true, date: true },
  "12": { title: "DUE DATE", description: "Due date for amount on payment slip", fixed: 6, numeric: true, date: true },
  "13": { title: "PACK DATE", description: "Packaging date", fixed: 6, numeric: true, date: true },
  "15": { title: "BEST BEFORE or BEST BY", description: "Best before date", fixed: 6, numeric: true, date: true },
  "16": { title: "SELL BY", description: "Sell by date", fixed: 6, numeric: true, date: true },
  "17": { title: "USE BY or EXPIRY", description: "Expiration date", fixed: 6, numeric: true, date: true },
  "20": { title: "VARIANT", description: "Internal product variant", fixed: 2, numeric: true },
  "21": { title: "SERIAL", description: "Serial number", max: 20 },
  "22": { title: "CPV", description: "Consumer product variant", max: 20 },
  "235": { title: "TPX", description: "Third Party Controlled, Serialised Extension of GTIN", max: 28 },
  "240": { title: "ADDITIONAL ID", description: "Additional product identification", max: 30 },
  "241": { title: "CUST. PART No.", description: "Customer part number", max: 30 },
  "242": { title: "MTO VARIANT", description: "Made-to-order variation number", max: 6, numeric: true },
  "243": { title: "PCN", description: "Packaging component number", max: 20 },
  "250": { title: "SECONDARY SERIAL", description: "Secondary serial number", max: 30 },
  "251": { title: "REF. TO SOURCE", description: "Reference to source entity", max: 30 },
  "253": { title: "GDTI", description: "Global Document Type Identifier", max: 30 },
  "254": { title: "GLN EXTENSION COMPONENT", description: "GLN extension component", max: 20 },
  "255": { title: "GCN", description: "Global Coupon Number", max: 25, numeric: true },
  "30": { title: "VAR. COUNT", description: "Variable count of items", max: 8, numeric: true },
  "37": { title: "COUNT", description: "Count of trade items contained", max: 8, numeric: true },
  "400": { title: "ORDER NUMBER", description: "Customer's purchase order number", max: 30 },
  "401": { title: "GINC", description: "Global Identification Number for Consignment", max: 30 },
  "402": { title: "GSIN", description: "Global Shipment Identification Number", fixed: 17, numeric: true, check: true },
  "403": { title: "ROUTE", description: "Routing code", max: 30 },
  "410": { title: "SHIP TO LOC", description: "Ship to / deliver to GLN", fixed: 13, numeric: true, check: true },
  "411": { title: "BILL TO", description: "Bill to / invoice to GLN", fixed: 13, numeric: true, check: true },
  "412": { title: "PURCHASE FROM", description: "Purchased from GLN", fixed: 13, numeric: true, check: true },
  "413": { title: "SHIP FOR LOC", description: "Ship for / deliver for / forward to GLN", fixed: 13, numeric: true, check: true },
  "414": { title: "LOC No.", description: "Identification of a physical location GLN", fixed: 13, numeric: true, check: true },
  "415": { title: "PAY TO", description: "GLN of the invoicing party", fixed: 13, numeric: true, check: true },
  "416": { title: "PROD/SERV LOC", description: "GLN of the production or service location", fixed: 13, numeric: true, check: true },
  "417": { title: "PARTY", description: "Party GLN", fixed: 13, numeric: true, check: true },
  "420": { title: "SHIP TO POST", description: "Ship to / deliver to postal code (single authority)", max: 20 },
  "421": { title: "SHIP TO POST", description: "Ship to / deliver to postal code with ISO country code", max: 12, isoPrefix: true },
  "422": { title: "ORIGIN", description: "Country of origin of a trade item", fixed: 3, numeric: true },
  "423": { title: "COUNTRY - INITIAL PROCESS", description: "Country of initial processing", max: 15, numeric: true },
  "424": { title: "COUNTRY - PROCESS", description: "Country of processing", fixed: 3, numeric: true },
  "425": { title: "COUNTRY - DISASSEMBLY", description: "Country of disassembly", max: 15, numeric: true },
  "426": { title: "COUNTRY - FULL PROCESS", description: "Country covering full process chain", fixed: 3, numeric: true },
  "427": { title: "ORIGIN SUBDIVISION", description: "Country subdivision of origin", max: 3 },
  "4300": { title: "SHIP TO COMP", description: "Ship-to / deliver-to company name", max: 35 },
  "4301": { title: "SHIP TO NAME", description: "Ship-to / deliver-to contact", max: 35 },
  "4302": { title: "SHIP TO ADD1", description: "Ship-to / deliver-to address line 1", max: 70 },
  "4303": { title: "SHIP TO ADD2", description: "Ship-to / deliver-to address line 2", max: 70 },
  "4304": { title: "SHIP TO SUB", description: "Ship-to / deliver-to suburb", max: 70 },
  "4305": { title: "SHIP TO LOC", description: "Ship-to / deliver-to locality", max: 70 },
  "4306": { title: "SHIP TO REG", description: "Ship-to / deliver-to region", max: 70 },
  "4307": { title: "SHIP TO COUNTRY", description: "Ship-to / deliver-to country code", fixed: 2 },
  "4308": { title: "SHIP TO PHONE", description: "Ship-to / deliver-to telephone number", max: 30 },
  "4309": { title: "SHIP TO GEO", description: "Ship-to / deliver-to GEO location", fixed: 20, numeric: true },
  "4310": { title: "RTN TO COMP", description: "Return-to company name", max: 35 },
  "4311": { title: "RTN TO NAME", description: "Return-to contact", max: 35 },
  "4312": { title: "RTN TO ADD1", description: "Return-to address line 1", max: 70 },
  "4313": { title: "RTN TO ADD2", description: "Return-to address line 2", max: 70 },
  "4314": { title: "RTN TO SUB", description: "Return-to suburb", max: 70 },
  "4315": { title: "RTN TO LOC", description: "Return-to locality", max: 70 },
  "4316": { title: "RTN TO REG", description: "Return-to region", max: 70 },
  "4317": { title: "RTN TO COUNTRY", description: "Return-to country code", fixed: 2 },
  "4318": { title: "RTN TO POST", description: "Return-to postal code", max: 20 },
  "4319": { title: "RTN TO PHONE", description: "Return-to telephone number", max: 30 },
  "4320": { title: "SRV DESCRIPTION", description: "Service code description", max: 35 },
  "4321": { title: "DANGEROUS GOODS", description: "Dangerous goods flag", fixed: 1, numeric: true },
  "4322": { title: "AUTH LEAVE", description: "Authority to leave", fixed: 1, numeric: true },
  "4323": { title: "SIG REQUIRED", description: "Signature required flag", fixed: 1, numeric: true },
  "4324": { title: "NBEF DEL DT", description: "Not before delivery date time", fixed: 10, numeric: true },
  "4325": { title: "NAFT DEL DT", description: "Not after delivery date time", fixed: 10, numeric: true },
  "4326": { title: "REL DATE", description: "Release date", fixed: 6, numeric: true, date: true },
  "7001": { title: "NSN", description: "NATO Stock Number", fixed: 13, numeric: true },
  "7002": { title: "MEAT CUT", description: "UN/ECE meat carcasses and cuts classification", max: 30 },
  "7003": { title: "EXPIRY TIME", description: "Expiration date and time (YYMMDDHHMM)", fixed: 10, numeric: true },
  "7004": { title: "ACTIVE POTENCY", description: "Active potency", max: 4, numeric: true },
  "7005": { title: "CATCH AREA", description: "Catch area", max: 12 },
  "7006": { title: "FIRST FREEZE DATE", description: "First freeze date", fixed: 6, numeric: true, date: true },
  "7007": { title: "HARVEST DATE", description: "Harvest date", max: 12, numeric: true },
  "7008": { title: "AQUATIC SPECIES", description: "Species for fishery purposes", max: 3 },
  "7009": { title: "FISHING GEAR TYPE", description: "Fishing gear type", max: 10 },
  "7010": { title: "PROD METHOD", description: "Production method", max: 2 },
  "7011": { title: "TEST BY DATE", description: "Test by date", max: 10, numeric: true },
  "7020": { title: "REFURB LOT", description: "Refurbishment lot ID", max: 20 },
  "7021": { title: "FUNC STAT", description: "Functional status", max: 20 },
  "7022": { title: "REV STAT", description: "Revision status", max: 20 },
  "7023": { title: "GIAI - ASSEMBLY", description: "GIAI of an assembly", max: 30 },
  "7040": { title: "UIC+EXT", description: "GS1 UIC with extension 1 and importer index", fixed: 4 },
  "7240": { title: "PROTOCOL", description: "Protocol ID", max: 20 },
  "7241": { title: "AIDC MEDIA TYPE", description: "AIDC media type", fixed: 2, numeric: true },
  "7242": { title: "VCN", description: "Version control number", max: 25 },
  "7250": { title: "DOB", description: "Date of birth (YYYYMMDD)", fixed: 8, numeric: true },
  "7251": { title: "DOB TIME", description: "Date and time of birth", fixed: 12, numeric: true },
  "7252": { title: "BIO SEX", description: "Biological sex", fixed: 1, numeric: true },
  "7253": { title: "FAMILY NAME", description: "Family name of person", max: 40 },
  "7254": { title: "GIVEN NAME", description: "Given name of person", max: 40 },
  "7255": { title: "SUFFIX", description: "Name suffix of person", max: 10 },
  "7256": { title: "FULL NAME", description: "Full name of person", max: 90 },
  "7257": { title: "PERSON ADDR", description: "Address of person", max: 70 },
  "7258": { title: "BIRTH SEQUENCE", description: "Baby birth sequence indicator", fixed: 3 },
  "7259": { title: "BABY", description: "Baby of family name", max: 40 },
  "8001": { title: "DIMENSIONS", description: "Roll products: width, length, core diameter, direction, splices", fixed: 14, numeric: true },
  "8002": { title: "CMT No.", description: "Cellular mobile telephone identifier", max: 20 },
  "8003": { title: "GRAI", description: "Global Returnable Asset Identifier", max: 30 },
  "8004": { title: "GIAI", description: "Global Individual Asset Identifier", max: 30 },
  "8005": { title: "PRICE PER UNIT", description: "Price per unit of measure", fixed: 6, numeric: true },
  "8006": { title: "ITIP", description: "Identification of an individual trade item piece", fixed: 18, numeric: true },
  "8007": { title: "IBAN", description: "International Bank Account Number", max: 34 },
  "8008": { title: "PROD TIME", description: "Date and time of production", max: 12, numeric: true },
  "8009": { title: "OPTSEN", description: "Optically readable sensor indicator", max: 50 },
  "8010": { title: "CPID", description: "Component / Part Identifier", max: 30 },
  "8011": { title: "CPID SERIAL", description: "Component / Part Identifier serial number", max: 12, numeric: true },
  "8012": { title: "VERSION", description: "Software version", max: 20 },
  "8013": { title: "GMN", description: "Global Model Number", max: 25 },
  "8014": { title: "MUDI", description: "Highly Individualised Device Registration Identifier", max: 25 },
  "8017": { title: "GSRN - PROVIDER", description: "Global Service Relation Number of the provider", fixed: 18, numeric: true, check: true },
  "8018": { title: "GSRN - RECIPIENT", description: "Global Service Relation Number of the recipient", fixed: 18, numeric: true, check: true },
  "8019": { title: "SRIN", description: "Service Relation Instance Number", max: 10, numeric: true },
  "8020": { title: "REF No.", description: "Payment slip reference number", max: 25 },
  "8026": { title: "ITIP CONTENT", description: "ITIP of contained trade item pieces", fixed: 18, numeric: true },
  "8030": { title: "DIGSIG", description: "Digital signature", max: 90 },
  "8110": { title: "COUPON CODE", description: "Coupon code identification (North America)", max: 70 },
  "8111": { title: "POINTS", description: "Loyalty points of a coupon", fixed: 4, numeric: true },
  "8112": { title: "PAPERLESS COUPON", description: "Paperless coupon code identification (North America)", max: 70 },
  "8200": { title: "PRODUCT URL", description: "Extended packaging URL", max: 70 },
  "90": { title: "INTERNAL", description: "Information mutually agreed between trading partners", max: 30 },
};

for (let i = 91; i <= 99; i++) T[String(i)] = { title: "INTERNAL", description: "Company internal information", max: 90 };
for (let i = 710; i <= 716; i++) T[String(i)] = { title: "NHRN", description: "National Healthcare Reimbursement Number", max: 20 };
for (let i = 0; i <= 9; i++) T[`703${i}`] = { title: `PROCESSOR # ${i}`, description: "Number of processor with ISO country code", max: 30 };
for (let i = 0; i <= 9; i++) T[`723${i}`] = { title: `CERT # ${i + 1}`, description: "Certification reference", max: 30 };

// Measures: 4-digit AIs where the 4th digit is the decimal point position.
const MEASURES: Record<string, [string, string]> = {
  "310": ["NET WEIGHT (kg)", "Net weight, kilograms"],
  "311": ["LENGTH (m)", "Length or first dimension, metres"],
  "312": ["WIDTH (m)", "Width, diameter, or second dimension, metres"],
  "313": ["HEIGHT (m)", "Depth, thickness, height, or third dimension, metres"],
  "314": ["AREA (m²)", "Area, square metres"],
  "315": ["NET VOLUME (l)", "Net volume, litres"],
  "316": ["NET VOLUME (m³)", "Net volume, cubic metres"],
  "320": ["NET WEIGHT (lb)", "Net weight, pounds"],
  "321": ["LENGTH (in)", "Length or first dimension, inches"],
  "322": ["LENGTH (ft)", "Length or first dimension, feet"],
  "323": ["LENGTH (yd)", "Length or first dimension, yards"],
  "324": ["WIDTH (in)", "Width, diameter, or second dimension, inches"],
  "325": ["WIDTH (ft)", "Width, diameter, or second dimension, feet"],
  "326": ["WIDTH (yd)", "Width, diameter, or second dimension, yards"],
  "327": ["HEIGHT (in)", "Depth, thickness, height, or third dimension, inches"],
  "328": ["HEIGHT (ft)", "Depth, thickness, height, or third dimension, feet"],
  "329": ["HEIGHT (yd)", "Depth, thickness, height, or third dimension, yards"],
  "330": ["GROSS WEIGHT (kg)", "Logistic weight, kilograms"],
  "331": ["LENGTH (m), log", "Length or first dimension, metres (logistics)"],
  "332": ["WIDTH (m), log", "Width, diameter, or second dimension, metres (logistics)"],
  "333": ["HEIGHT (m), log", "Depth, thickness, height, or third dimension, metres (logistics)"],
  "334": ["AREA (m²), log", "Area, square metres (logistics)"],
  "335": ["VOLUME (l), log", "Logistic volume, litres"],
  "336": ["VOLUME (m³), log", "Logistic volume, cubic metres"],
  "337": ["KG PER m²", "Kilograms per square metre"],
  "340": ["GROSS WEIGHT (lb)", "Logistic weight, pounds"],
  "341": ["LENGTH (in), log", "Length or first dimension, inches (logistics)"],
  "342": ["LENGTH (ft), log", "Length or first dimension, feet (logistics)"],
  "343": ["LENGTH (yd), log", "Length or first dimension, yards (logistics)"],
  "344": ["WIDTH (in), log", "Width, diameter, or second dimension, inches (logistics)"],
  "345": ["WIDTH (ft), log", "Width, diameter, or second dimension, feet (logistics)"],
  "346": ["WIDTH (yd), log", "Width, diameter, or second dimension, yards (logistics)"],
  "347": ["HEIGHT (in), log", "Depth, thickness, height, or third dimension, inches (logistics)"],
  "348": ["HEIGHT (ft), log", "Depth, thickness, height, or third dimension, feet (logistics)"],
  "349": ["HEIGHT (yd), log", "Depth, thickness, height, or third dimension, yards (logistics)"],
  "350": ["AREA (in²)", "Area, square inches"],
  "351": ["AREA (ft²)", "Area, square feet"],
  "352": ["AREA (yd²)", "Area, square yards"],
  "353": ["AREA (in²), log", "Area, square inches (logistics)"],
  "354": ["AREA (ft²), log", "Area, square feet (logistics)"],
  "355": ["AREA (yd²), log", "Area, square yards (logistics)"],
  "356": ["NET WEIGHT (troy oz)", "Net weight, troy ounces"],
  "357": ["NET VOLUME (oz)", "Net weight or volume, ounces"],
  "360": ["NET VOLUME (qt)", "Net volume, quarts"],
  "361": ["NET VOLUME (gal.)", "Net volume, gallons U.S."],
  "362": ["VOLUME (qt), log", "Logistic volume, quarts"],
  "363": ["VOLUME (gal.), log", "Logistic volume, gallons U.S."],
  "364": ["VOLUME (in³)", "Net volume, cubic inches"],
  "365": ["VOLUME (ft³)", "Net volume, cubic feet"],
  "366": ["VOLUME (yd³)", "Net volume, cubic yards"],
  "367": ["VOLUME (in³), log", "Logistic volume, cubic inches"],
  "368": ["VOLUME (ft³), log", "Logistic volume, cubic feet"],
  "369": ["VOLUME (yd³), log", "Logistic volume, cubic yards"],
};
for (const [prefix, [title, description]] of Object.entries(MEASURES)) {
  for (let d = 0; d <= 9; d++) T[`${prefix}${d}`] = { title, description, fixed: 6, numeric: true, decimal: true };
}
for (let d = 0; d <= 9; d++) {
  T[`390${d}`] = { title: "AMOUNT", description: "Amount payable or coupon value, local currency", max: 15, numeric: true, decimal: true };
  T[`391${d}`] = { title: "AMOUNT", description: "Amount payable with ISO currency code", max: 18, numeric: true, decimal: true, isoPrefix: true };
  T[`392${d}`] = { title: "PRICE", description: "Amount payable for a variable measure trade item, single monetary area", max: 15, numeric: true, decimal: true };
  T[`393${d}`] = { title: "PRICE", description: "Amount payable for a variable measure trade item with ISO currency code", max: 18, numeric: true, decimal: true, isoPrefix: true };
  T[`394${d}`] = { title: "PRCNT OFF", description: "Percentage discount of a coupon", fixed: 4, numeric: true, decimal: true };
  T[`395${d}`] = { title: "PRICE/UoM", description: "Amount payable per unit of measure", fixed: 6, numeric: true, decimal: true };
}

export const GS1_AIS: Readonly<Record<string, AIDefinition>> = Object.fromEntries(
  Object.entries(T).map(([ai, d]) => [ai, { description: d.title, ...d } as AIDefinition]),
);

/** Two-digit prefixes whose AIs have a predefined length (no FNC1 separator needed). */
export const PREDEFINED_LENGTH_PREFIXES = new Set([
  "00", "01", "02", "03", "04", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "31", "32", "33", "34", "35", "36", "41",
]);

/** Find the AI at the start of `s` (AIs are prefix-free, so try 2, 3 then 4 digits). */
export function matchAI(s: string): string | undefined {
  for (const len of [2, 3, 4]) {
    const ai = s.slice(0, len);
    if (ai.length === len && GS1_AIS[ai]) return ai;
  }
  return undefined;
}

/** GS1 Digital Link short names for primary keys and common qualifiers/attributes. */
export const DIGITAL_LINK_NAMES: Readonly<Record<string, string>> = {
  gtin: "01", itip: "8006", cpv: "22", lot: "10", ser: "21", sscc: "00", gln: "414", glnProd: "416",
  party: "417", gsrnp: "8017", gsrn: "8018", srin: "8019", gcn: "255", gdti: "253", ginc: "401",
  gsin: "402", grai: "8003", giai: "8004", cpid: "8010", cpsn: "8011", gmn: "8013", exp: "17",
  expDt: "7003", bestBeforeDate: "15", sellBy: "16", prodDate: "11", packDate: "13", count: "30",
};
