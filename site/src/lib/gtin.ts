import { isValidCheckDigit, parseContent, parseDigitalLink, parseGS1 } from "qrgen-sdk/parsers";

/**
 * GTIN (retail product number) equivalence for the receiving and finder pages.
 *
 * Retail barcodes print one product number in several forms: a UPC-A is the
 * 13-digit EAN with its leading 0 removed, a UPC-E is a compressed UPC-A, and an
 * ITF-14, GS1-128, DataBar or GS1 Digital Link can carry the same number. Each
 * resolves to the 14-digit GTIN here. Every other value has no GTIN and is
 * compared as an exact string.
 */

/** What the pages know about a decoded barcode. `symbology` is the SDK symbology id. */
export interface ScannedValue {
  data: string;
  symbology?: string;
  isGS1?: boolean;
}

/**
 * Symbologies whose payload is a GTIN, with the payload lengths that carry one.
 * ISBN is an EAN-13. The SDK reports a 14-digit Interleaved 2 of 5, which is how
 * an ITF-14 is encoded, as `itf`.
 */
const GTIN_LENGTHS: ReadonlyMap<string, readonly number[]> = new Map([
  ["ean13", [13]], ["isbn", [13]], ["ean8", [8]], ["upca", [12]], ["upce", [8]], ["itf14", [14]], ["itf", [14]],
]);

/** A 14-digit GTIN with a valid check digit. An all-zero number identifies no product. */
function gtin14(value: string | undefined): string | null {
  return value !== undefined && /^\d{14}$/.test(value) && !/^0+$/.test(value) && isValidCheckDigit(value) ? value : null;
}

/**
 * The GTIN-14 a typed or saved barcode value spells: exactly 8, 12, 13 or 14
 * digits with a valid check digit. Nothing is trimmed, so a value with spaces or
 * any other character is not a GTIN and only matches exactly.
 */
export function typedGtin(value: string): string | null {
  if (typeof value !== "string" || !/^(?:\d{8}|\d{12,14})$/.test(value)) return null;
  return gtin14(value.padStart(14, "0"));
}

/**
 * The GTIN-14 a decoded barcode carries, or null. Only GTIN symbologies (EAN-13,
 * EAN-8, UPC-A, UPC-E expanded to its UPC-A, ITF-14) with a valid check digit,
 * GS1 element strings with AI (01), and GS1 Digital Link URLs with AI (01)
 * resolve. The same digits in any other symbology stay exact values.
 */
export function scannedGtin(barcode: ScannedValue): string | null {
  const { data, symbology } = barcode;
  if (typeof data !== "string") return null;
  const lengths = typeof symbology === "string" ? GTIN_LENGTHS.get(symbology) : undefined;
  if (lengths) {
    if (!lengths.includes(data.length) || !/^\d+$/.test(data)) return null;
    // parseContent expands UPC-E with the SDK's own UPC-A conversion.
    const product = parseContent(data, { symbology });
    return product.type === "product" && product.checksumValid ? gtin14(product.gtin) : null;
  }
  const gs1 = barcode.isGS1 === true ? parseGS1(data) : /^https?:\/\//i.test(data) ? parseDigitalLink(data) : null;
  const element = gs1?.elements.find(element => element.ai === "01");
  return element?.checkDigitValid ? gtin14(element.value) : null;
}
