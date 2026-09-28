// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace QRGen
{
    /// <summary>
    /// Classifies decoded barcode text (SPEC section 3.1): URLs, GS1 Digital Link, e-mail, phone, SMS,
    /// Wi-Fi, geo, contacts (vCard, MECARD), events (VEVENT), payments (EPC, bitcoin, ethereum, UPI),
    /// products (GTIN), GS1 element strings, AAMVA licenses and plain text. Never throws.
    /// </summary>
    public static class ContentParser
    {
        private static readonly Regex UrlPattern = new Regex(@"^[a-z][a-z0-9+.\-]*://\S+$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex EmailPattern = new Regex(@"^[^@\s:;,/]+@[^@\s:;,/]+\.[a-z]{2,}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        private static readonly Regex Gs1Prefix = new Regex(@"^\](C1|e0|e1|e2|d2|Q3|J1)", RegexOptions.CultureInvariant);
        private static readonly HashSet<string> Gs1Symbologies = new HashSet<string> { "databar", "databar-expanded", "databar-limited" };
        private static readonly HashSet<string> ProductSymbologies = new HashSet<string> { "ean13", "ean8", "upca", "upce", "isbn", "itf14" };
        private static readonly string[] OtherCoins = { "litecoin:", "bitcoincash:", "dogecoin:", "monero:", "dash:", "zcash:", "lightning:" };

        /// <summary>Classifies and parses decoded text.</summary>
        /// <param name="data">The decoded text (<see cref="Barcode.Data"/>).</param>
        /// <param name="symbology">Optional symbology id that produced the text (helps with UPC-E vs EAN-8, DataBar).</param>
        /// <param name="today">Reference date for GS1 century and AAMVA age calculations.</param>
        /// <returns>The parsed content; unrecognized input returns <c>{ type: "text", text }</c>.</returns>
        public static ParsedContent Parse(string? data, string? symbology = null, DateTime? today = null)
        {
            ParsedContent? result = null;
            try
            {
                result = Classify(data, symbology, today);
            }
            catch (Exception)
            {
                result = null;
            }
            return result ?? new ParsedContent { Type = ParsedContentType.Text, Text = data ?? string.Empty };
        }

        /// <summary>Returns <c>true</c> when the last digit is a valid GS1 mod-10 check digit.</summary>
        public static bool GtinChecksumValid(string digits)
        {
            if (digits is null || digits.Length < 2 || !AllDigits(digits)) return false;
            var total = 0;
            var weight = 3;
            for (var i = digits.Length - 2; i >= 0; i--)
            {
                total += (digits[i] - '0') * weight;
                weight = weight == 3 ? 1 : 3;
            }
            return (10 - total % 10) % 10 == digits[digits.Length - 1] - '0';
        }

        /// <summary>Expands an 8 digit UPC-E code to its 12 digit UPC-A equivalent, or returns <c>null</c>.</summary>
        public static string? ExpandUpcE(string upce)
        {
            if (upce is null || upce.Length != 8 || !AllDigits(upce) || (upce[0] != '0' && upce[0] != '1')) return null;
            var d = upce.Substring(1, 6);
            var last = d[5];
            string body;
            if (last <= '2') body = d.Substring(0, 2) + last + "0000" + d.Substring(2, 3);
            else if (last == '3') body = d.Substring(0, 3) + "00000" + d.Substring(3, 2);
            else if (last == '4') body = d.Substring(0, 4) + "00000" + d[4];
            else body = d.Substring(0, 5) + "0000" + last;
            return upce[0] + body + upce[7];
        }

        private static bool AllDigits(string value) => value.Length > 0 && value.All(c => c >= '0' && c <= '9');

        private static bool StartsWith(string text, string prefix) => text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);

        private static ParsedContent? Classify(string? data, string? symbology, DateTime? today)
        {
            if (data is null) return null;
            var text = data.Trim();
            if (text.Length == 0) return null;
            var head40 = text.Length > 40 ? text.Substring(0, 40) : text;

            if (text.StartsWith("@", StringComparison.Ordinal) || head40.Contains("ANSI ") || head40.Contains("AAMVA"))
            {
                var aamva = AamvaParser.Parse(data, today);
                if (aamva is not null) return new ParsedContent { Type = ParsedContentType.Aamva, Aamva = aamva };
            }

            if (StartsWith(text, "WIFI:")) return Wifi(text);
            if (StartsWith(text, "mailto:")) return Mailto(text);
            if (StartsWith(text, "MATMSG:")) return MatMsg(text);
            if (StartsWith(text, "SMTP:")) return Smtp(text);
            if (StartsWith(text, "tel:")) return Phone(text);
            if (StartsWith(text, "smsto:") || StartsWith(text, "mmsto:") || StartsWith(text, "sms:") || StartsWith(text, "mms:")) return Sms(text);
            if (StartsWith(text, "geo:"))
            {
                var geo = Geo(text);
                if (geo is not null) return geo;
            }
            if (StartsWith(text, "BEGIN:VCARD")) return VCard(text);
            if (StartsWith(text, "MECARD:")) return MeCard(text);
            if (StartsWith(text, "BEGIN:VCALENDAR") || StartsWith(text, "BEGIN:VEVENT")) return Event(text);
            if (text.StartsWith("BCD", StringComparison.Ordinal) && text.Contains("\n"))
            {
                var epc = Epc(text);
                if (epc is not null) return epc;
            }
            if (StartsWith(text, "bitcoin:")) return Bitcoin(text);
            if (StartsWith(text, "ethereum:")) return Ethereum(text);
            if (StartsWith(text, "upi://pay")) return Upi(text);
            if (StartsWith(text, "payto://")) return PayTo(text);
            if (OtherCoins.Any(p => StartsWith(text, p))) return OtherCoin(text);
            if (StartsWith(text, "MEBKM:"))
            {
                var fields = FirstValues(KeyValues(text.Substring(6)));
                if (fields.TryGetValue("URL", out var url) && url.Trim().Length > 0)
                    return new ParsedContent { Type = ParsedContentType.Url, Url = url.Trim() };
            }
            if (StartsWith(text, "URLTO:")) return new ParsedContent { Type = ParsedContentType.Url, Url = text.Substring(6).Trim() };

            if (UrlPattern.IsMatch(text))
            {
                if (StartsWith(text, "http://") || StartsWith(text, "https://"))
                {
                    var link = Gs1Parser.Parse(text, today);
                    if (link is not null) return new ParsedContent { Type = ParsedContentType.Gs1DigitalLink, Url = text, Gs1 = link };
                }
                return new ParsedContent { Type = ParsedContentType.Url, Url = text };
            }

            var looksGs1 = Gs1Prefix.IsMatch(text) || data.IndexOf(Gs1Parser.GroupSeparator) >= 0 || text.StartsWith("(", StringComparison.Ordinal) ||
                           (symbology is not null && Gs1Symbologies.Contains(symbology));
            if (looksGs1)
            {
                var gs1 = Gs1Parser.Parse(data, today);
                if (gs1 is not null) return new ParsedContent { Type = ParsedContentType.Gs1, Gs1 = gs1 };
            }

            if (AllDigits(text) && (text.Length == 8 || text.Length == 12 || text.Length == 13 || text.Length == 14 ||
                                    (symbology is not null && ProductSymbologies.Contains(symbology))))
            {
                var product = Product(text, symbology);
                if (product is not null) return product;
            }

            if (EmailPattern.IsMatch(text)) return new ParsedContent { Type = ParsedContentType.Email, To = text };
            return null;
        }

        // ------------------------------------------------------------------ helpers

        private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;

        internal static List<string> SplitEscaped(string text, char separator)
        {
            var parts = new List<string>();
            var current = new StringBuilder();
            for (var i = 0; i < text.Length; i++)
            {
                var ch = text[i];
                if (ch == '\\' && i + 1 < text.Length)
                {
                    current.Append(text[i + 1]);
                    i++;
                    continue;
                }
                if (ch == separator)
                {
                    parts.Add(current.ToString());
                    current.Clear();
                }
                else
                {
                    current.Append(ch);
                }
            }
            parts.Add(current.ToString());
            return parts;
        }

        private static List<KeyValuePair<string, string>> KeyValues(string body)
        {
            var pairs = new List<KeyValuePair<string, string>>();
            foreach (var part in SplitEscaped(body, ';'))
            {
                var index = part.IndexOf(':');
                if (index < 0) continue;
                pairs.Add(new KeyValuePair<string, string>(part.Substring(0, index).Trim().ToUpperInvariant(), part.Substring(index + 1)));
            }
            return pairs;
        }

        private static Dictionary<string, string> FirstValues(IEnumerable<KeyValuePair<string, string>> pairs)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in pairs)
            {
                if (!result.ContainsKey(pair.Key)) result[pair.Key] = pair.Value;
            }
            return result;
        }

        private static string Unescape(string value) => Uri.UnescapeDataString(value.Replace('+', ' '));

        private static string UnescapePath(string value) => Uri.UnescapeDataString(value);

        private static Dictionary<string, string> Query(string query)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var part in query.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var index = part.IndexOf('=');
                if (index <= 0) continue;
                var key = Unescape(part.Substring(0, index)).ToLowerInvariant();
                var value = Unescape(part.Substring(index + 1));
                if (value.Length > 0 && !result.ContainsKey(key)) result[key] = value;
            }
            return result;
        }

        private static (string Before, string After) Partition(string text, char separator)
        {
            var index = text.IndexOf(separator);
            return index < 0 ? (text, string.Empty) : (text.Substring(0, index), text.Substring(index + 1));
        }

        private static string? Get(Dictionary<string, string> map, string key) => map.TryGetValue(key, out var value) ? value : null;

        private static string UnquoteWifi(string value) =>
            value.Length >= 2 && value[0] == '"' && value[value.Length - 1] == '"' ? value.Substring(1, value.Length - 2) : value;

        private static string IcalDateTime(string value)
        {
            value = value.Trim();
            var match = Regex.Match(value, @"^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$");
            if (!match.Success) return value;
            var date = $"{match.Groups[1].Value}-{match.Groups[2].Value}-{match.Groups[3].Value}";
            if (!match.Groups[4].Success) return date;
            var seconds = match.Groups[6].Success ? match.Groups[6].Value : "00";
            return $"{date}T{match.Groups[4].Value}:{match.Groups[5].Value}:{seconds}{(match.Groups[7].Success ? "Z" : string.Empty)}";
        }

        private static string VCardUnescape(string value) =>
            Regex.Replace(value, @"\\([nN,;:\\])", m => m.Groups[1].Value == "n" || m.Groups[1].Value == "N" ? "\n" : m.Groups[1].Value);

        private static List<string> SplitSemicolons(string value) => Regex.Split(value, @"(?<!\\);").ToList();

        private static List<(string Name, Dictionary<string, string> Params, string Value)> ContentLines(string text)
        {
            var raw = Regex.Split(text, "\r\n|\r|\n");
            var lines = new List<string>();
            foreach (var line in raw)
            {
                if (line.Length > 0 && (line[0] == ' ' || line[0] == '\t') && lines.Count > 0)
                    lines[lines.Count - 1] += line.Substring(1);
                else if (lines.Count > 0 && lines[lines.Count - 1].EndsWith("=", StringComparison.Ordinal) &&
                         lines[lines.Count - 1].IndexOf("QUOTED-PRINTABLE", StringComparison.OrdinalIgnoreCase) >= 0)
                    lines[lines.Count - 1] = lines[lines.Count - 1].Substring(0, lines[lines.Count - 1].Length - 1) + line;
                else
                    lines.Add(line);
            }
            var result = new List<(string, Dictionary<string, string>, string)>();
            foreach (var line in lines)
            {
                var colon = line.IndexOf(':');
                if (colon < 0) continue;
                var head = line.Substring(0, colon);
                var value = line.Substring(colon + 1);
                var pieces = head.Split(';');
                var name = pieces[0].Trim().ToUpperInvariant();
                var dot = name.IndexOf('.');
                if (dot >= 0) name = name.Substring(dot + 1);
                var parameters = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (var piece in pieces.Skip(1))
                {
                    var eq = piece.IndexOf('=');
                    if (eq >= 0) parameters[piece.Substring(0, eq).Trim().ToUpperInvariant()] = piece.Substring(eq + 1).Trim();
                    else if (!parameters.ContainsKey("TYPE")) parameters["TYPE"] = piece.Trim();
                }
                if (parameters.TryGetValue("ENCODING", out var encoding) &&
                    (encoding.Equals("QUOTED-PRINTABLE", StringComparison.OrdinalIgnoreCase) || encoding.Equals("QP", StringComparison.OrdinalIgnoreCase)))
                {
                    value = DecodeQuotedPrintable(value, parameters.TryGetValue("CHARSET", out var charset) ? charset : "utf-8");
                }
                result.Add((name, parameters, value));
            }
            return result;
        }

        private static string DecodeQuotedPrintable(string value, string charset)
        {
            try
            {
                using var stream = new MemoryStream();
                for (var i = 0; i < value.Length; i++)
                {
                    if (value[i] == '=' && i + 2 < value.Length &&
                        int.TryParse(value.Substring(i + 1, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var b))
                    {
                        stream.WriteByte((byte)b);
                        i += 2;
                    }
                    else
                    {
                        stream.WriteByte((byte)value[i]);
                    }
                }
                return Encoding.GetEncoding(charset).GetString(stream.ToArray());
            }
            catch (Exception)
            {
                return value;
            }
        }

        // ------------------------------------------------------------------ types

        private static ParsedContent Wifi(string text)
        {
            var fields = FirstValues(KeyValues(text.Substring(5)));
            var ssid = UnquoteWifi(Get(fields, "S") ?? string.Empty);
            var password = UnquoteWifi(Get(fields, "P") ?? string.Empty);
            var security = (Get(fields, "T") ?? string.Empty).Trim();
            var upper = security.ToUpperInvariant();
            if (upper == "NOPASS" || upper == "NONE" || upper == "OPEN" || (security.Length == 0 && password.Length == 0)) security = "nopass";
            else if (security.Length == 0) security = "WPA";
            else security = upper;
            var hidden = (Get(fields, "H") ?? string.Empty).Trim().ToLowerInvariant();
            return new ParsedContent
            {
                Type = ParsedContentType.Wifi,
                Ssid = ssid,
                Password = NullIfEmpty(password),
                Security = security,
                Hidden = hidden == "true" || hidden == "1" || hidden == "yes",
            };
        }

        private static ParsedContent Email(string to, string? subject, string? body) => new ParsedContent
        {
            Type = ParsedContentType.Email,
            To = to.Trim(),
            Subject = NullIfEmpty(subject),
            Body = NullIfEmpty(body),
        };

        private static ParsedContent Mailto(string text)
        {
            var (address, query) = Partition(text.Substring(7), '?');
            var parameters = Query(query);
            return Email(UnescapePath(address), Get(parameters, "subject"), Get(parameters, "body"));
        }

        private static ParsedContent MatMsg(string text)
        {
            var fields = FirstValues(KeyValues(text.Substring(7)));
            return Email(Get(fields, "TO") ?? string.Empty, Get(fields, "SUB"), Get(fields, "BODY"));
        }

        private static ParsedContent Smtp(string text)
        {
            var parts = text.Substring(5).Split(new[] { ':' }, 3).ToList();
            while (parts.Count < 3) parts.Add(string.Empty);
            return Email(parts[0], parts[1], parts[2]);
        }

        private static ParsedContent Phone(string text)
        {
            var number = text.Substring(text.IndexOf(':') + 1).Split(';')[0];
            return new ParsedContent { Type = ParsedContentType.Phone, Number = UnescapePath(number).Trim() };
        }

        private static ParsedContent Sms(string text)
        {
            if (StartsWith(text, "smsto:") || StartsWith(text, "mmsto:"))
            {
                var (number, body) = Partition(text.Substring(6), ':');
                return new ParsedContent { Type = ParsedContentType.Sms, Number = number.Trim(), Body = NullIfEmpty(body) };
            }
            var rest = text.Substring(text.IndexOf(':') + 1);
            var (target, query) = Partition(rest, '?');
            target = target.Split(';')[0];
            var parameters = Query(query);
            return new ParsedContent { Type = ParsedContentType.Sms, Number = UnescapePath(target).Trim(), Body = Get(parameters, "body") };
        }

        private static ParsedContent? Geo(string text)
        {
            var (coords, query) = Partition(text.Substring(4), '?');
            coords = coords.Split(';')[0];
            var parts = coords.Split(',');
            if (parts.Length < 2) return null;
            if (!double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) ||
                !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var lon))
                return null;
            double? alt = null;
            if (parts.Length > 2 && parts[2].Trim().Length > 0)
            {
                if (!double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var a)) return null;
                alt = a;
            }
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
            var parameters = Query(query);
            return new ParsedContent { Type = ParsedContentType.Geo, Latitude = lat, Longitude = lon, Altitude = alt, Query = Get(parameters, "q") };
        }

        private static ParsedContent VCard(string text)
        {
            string? name = null, structuredName = null, organization = null, title = null, address = null, note = null;
            var phones = new List<string>();
            var emails = new List<string>();
            var urls = new List<string>();
            foreach (var (key, _, value) in ContentLines(text))
            {
                switch (key)
                {
                    case "FN":
                        var fn = VCardUnescape(value).Trim();
                        if (fn.Length > 0) name = fn;
                        break;
                    case "N":
                        var parts = SplitSemicolons(value).Select(p => VCardUnescape(p).Trim()).ToList();
                        while (parts.Count < 5) parts.Add(string.Empty);
                        structuredName = string.Join(" ", new[] { parts[3], parts[1], parts[2], parts[0], parts[4] }.Where(p => p.Length > 0));
                        break;
                    case "ORG":
                        organization = string.Join(" ", SplitSemicolons(value).Select(p => VCardUnescape(p).Trim()).Where(p => p.Length > 0));
                        break;
                    case "TITLE":
                        title = VCardUnescape(value).Trim();
                        break;
                    case "TEL":
                        var phone = value.Trim();
                        if (StartsWith(phone, "tel:")) phone = phone.Substring(4);
                        if (phone.Length > 0) phones.Add(phone);
                        break;
                    case "EMAIL":
                        if (value.Trim().Length > 0) emails.Add(value.Trim());
                        break;
                    case "URL":
                        if (value.Trim().Length > 0) urls.Add(VCardUnescape(value).Trim());
                        break;
                    case "ADR":
                        if (address is null)
                        {
                            var joined = string.Join(", ", SplitSemicolons(value).Select(p => VCardUnescape(p).Trim()).Where(p => p.Length > 0));
                            address = NullIfEmpty(joined);
                        }
                        break;
                    case "NOTE":
                        note = VCardUnescape(value).Trim();
                        break;
                }
            }
            return new ParsedContent
            {
                Type = ParsedContentType.Contact,
                Name = NullIfEmpty(name ?? structuredName),
                Organization = NullIfEmpty(organization),
                Title = NullIfEmpty(title),
                Phones = phones,
                Emails = emails,
                Urls = urls,
                Address = address,
                Note = NullIfEmpty(note),
                Format = "vcard",
            };
        }

        private static ParsedContent MeCard(string text)
        {
            string? name = null, organization = null, title = null, address = null, note = null;
            var phones = new List<string>();
            var emails = new List<string>();
            var urls = new List<string>();
            foreach (var pair in KeyValues(text.Substring(7)))
            {
                var value = pair.Value.Trim();
                if (value.Length == 0) continue;
                switch (pair.Key)
                {
                    case "N":
                        var comma = value.IndexOf(',');
                        name = comma >= 0
                            ? string.Join(" ", new[] { value.Substring(comma + 1).Trim(), value.Substring(0, comma).Trim() }.Where(p => p.Length > 0))
                            : value;
                        break;
                    case "TEL":
                    case "TEL-AV":
                        phones.Add(value);
                        break;
                    case "EMAIL":
                        emails.Add(value);
                        break;
                    case "URL":
                        urls.Add(value);
                        break;
                    case "ADR":
                        address ??= value;
                        break;
                    case "NOTE":
                    case "MEMO":
                        note = value;
                        break;
                    case "ORG":
                        organization = value;
                        break;
                    case "TITLE":
                        title = value;
                        break;
                }
            }
            return new ParsedContent
            {
                Type = ParsedContentType.Contact,
                Name = NullIfEmpty(name),
                Organization = NullIfEmpty(organization),
                Title = NullIfEmpty(title),
                Phones = phones,
                Emails = emails,
                Urls = urls,
                Address = NullIfEmpty(address),
                Note = NullIfEmpty(note),
                Format = "mecard",
            };
        }

        private static ParsedContent Event(string text)
        {
            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            var inEvent = text.IndexOf("BEGIN:VEVENT", StringComparison.OrdinalIgnoreCase) < 0;
            foreach (var (key, _, value) in ContentLines(text))
            {
                if (key == "BEGIN" && value.Trim().Equals("VEVENT", StringComparison.OrdinalIgnoreCase))
                {
                    inEvent = true;
                    continue;
                }
                if (key == "END" && value.Trim().Equals("VEVENT", StringComparison.OrdinalIgnoreCase)) break;
                if (inEvent && !fields.ContainsKey(key)) fields[key] = value;
            }
            string? Field(string key) => fields.TryGetValue(key, out var v) ? NullIfEmpty(VCardUnescape(v).Trim()) : null;
            return new ParsedContent
            {
                Type = ParsedContentType.Event,
                Summary = Field("SUMMARY"),
                Start = fields.TryGetValue("DTSTART", out var start) && start.Length > 0 ? IcalDateTime(start) : null,
                End = fields.TryGetValue("DTEND", out var end) && end.Length > 0 ? IcalDateTime(end) : null,
                Location = Field("LOCATION"),
                Description = Field("DESCRIPTION"),
            };
        }

        private static ParsedContent? Epc(string text)
        {
            var lines = Regex.Split(text, "\r\n|\n|\r").Select(l => l.Trim()).ToList();
            if (lines.Count < 7 || lines[0] != "BCD") return null;
            while (lines.Count < 12) lines.Add(string.Empty);
            string? currency = null, amount = null;
            var match = Regex.Match(lines[7], @"^([A-Z]{3})?(\d+(?:\.\d{1,2})?)$");
            if (match.Success)
            {
                currency = match.Groups[1].Success ? match.Groups[1].Value : "EUR";
                amount = match.Groups[2].Value;
            }
            return new ParsedContent
            {
                Type = ParsedContentType.Payment,
                Scheme = "epc",
                Name = NullIfEmpty(lines[5]),
                Iban = NullIfEmpty(lines[6].Replace(" ", string.Empty)),
                Bic = NullIfEmpty(lines[4]),
                Amount = amount,
                Currency = currency ?? "EUR",
                Reference = NullIfEmpty(lines[9].Length > 0 ? lines[9] : lines[10]),
            };
        }

        private static ParsedContent Bitcoin(string text)
        {
            var rest = text.Substring(text.IndexOf(':') + 1).TrimStart('/');
            var (address, query) = Partition(rest, '?');
            var parameters = Query(query);
            return new ParsedContent
            {
                Type = ParsedContentType.Payment,
                Scheme = "bitcoin",
                Address = NullIfEmpty(address),
                Name = Get(parameters, "label"),
                Amount = Get(parameters, "amount"),
                Currency = "BTC",
                Reference = Get(parameters, "message"),
            };
        }

        private static ParsedContent Ethereum(string text)
        {
            var rest = text.Substring(text.IndexOf(':') + 1);
            if (StartsWith(rest, "pay-")) rest = rest.Substring(4);
            var (target, query) = Partition(rest, '?');
            var address = Regex.Split(target, "[@/]")[0];
            var parameters = Query(query);
            string? amount;
            if (target.Contains("/transfer") && parameters.ContainsKey("address"))
            {
                address = parameters["address"];
                amount = Get(parameters, "uint256");
            }
            else
            {
                amount = Get(parameters, "value") ?? Get(parameters, "amount");
            }
            return new ParsedContent { Type = ParsedContentType.Payment, Scheme = "ethereum", Address = NullIfEmpty(address), Amount = amount, Currency = "ETH" };
        }

        private static ParsedContent Upi(string text)
        {
            var (_, query) = Partition(text, '?');
            var parameters = Query(query);
            return new ParsedContent
            {
                Type = ParsedContentType.Payment,
                Scheme = "upi",
                Address = Get(parameters, "pa"),
                Name = Get(parameters, "pn"),
                Amount = Get(parameters, "am"),
                Currency = Get(parameters, "cu") ?? "INR",
                Reference = Get(parameters, "tr") ?? Get(parameters, "tn"),
            };
        }

        private static ParsedContent PayTo(string text)
        {
            var (location, query) = Partition(text.Substring("payto://".Length), '?');
            var segments = location.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries).Select(UnescapePath).ToList();
            var parameters = Query(query);
            string? iban = null, bic = null, address = null;
            if (segments.Count > 0 && segments[0].Equals("iban", StringComparison.OrdinalIgnoreCase))
            {
                if (segments.Count >= 3)
                {
                    bic = segments[1];
                    iban = segments[2];
                }
                else if (segments.Count == 2)
                {
                    iban = segments[1];
                }
            }
            else
            {
                address = NullIfEmpty(string.Join("/", segments.Skip(1)));
            }
            string? currency = null, amount = null;
            var rawAmount = Get(parameters, "amount");
            if (rawAmount is not null && rawAmount.Contains(":"))
            {
                (currency, amount) = Partition(rawAmount, ':');
            }
            return new ParsedContent
            {
                Type = ParsedContentType.Payment,
                Scheme = "other",
                Address = address,
                Name = Get(parameters, "receiver-name"),
                Iban = iban,
                Bic = bic,
                Amount = amount,
                Currency = currency,
                Reference = Get(parameters, "message"),
            };
        }

        private static ParsedContent OtherCoin(string text)
        {
            var colon = text.IndexOf(':');
            var scheme = text.Substring(0, colon).ToLowerInvariant();
            var (address, query) = Partition(text.Substring(colon + 1).TrimStart('/'), '?');
            var parameters = Query(query);
            var currencies = new Dictionary<string, string>
            {
                ["litecoin"] = "LTC", ["bitcoincash"] = "BCH", ["dogecoin"] = "DOGE", ["monero"] = "XMR", ["dash"] = "DASH",
            };
            return new ParsedContent
            {
                Type = ParsedContentType.Payment,
                Scheme = "other",
                Address = NullIfEmpty(address),
                Name = Get(parameters, "label"),
                Amount = Get(parameters, "amount"),
                Currency = currencies.TryGetValue(scheme, out var c) ? c : null,
                Reference = Get(parameters, "message") ?? Get(parameters, "tx_description"),
            };
        }

        private static ParsedContent? Product(string digits, string? symbology)
        {
            ParsedContent Make(string gtin, string kind, bool valid) =>
                new ParsedContent { Type = ParsedContentType.Product, Gtin = gtin, Kind = kind, ChecksumValid = valid };

            switch (digits.Length)
            {
                case 8:
                    if (symbology == "upce" || (symbology != "ean8" && !GtinChecksumValid(digits) && ExpandUpcE(digits) is not null))
                    {
                        var upca = ExpandUpcE(digits);
                        if (upca is not null) return Make(upca.PadLeft(14, '0'), "upce", GtinChecksumValid(upca));
                    }
                    return Make(digits.PadLeft(14, '0'), "ean8", GtinChecksumValid(digits));
                case 12:
                    return Make(digits.PadLeft(14, '0'), "upca", GtinChecksumValid(digits));
                case 13:
                    var kind = digits.StartsWith("978", StringComparison.Ordinal) || digits.StartsWith("979", StringComparison.Ordinal) ? "isbn" : "ean13";
                    if (symbology == "upca" && digits[0] == '0') kind = "upca";
                    return Make(digits.PadLeft(14, '0'), kind, GtinChecksumValid(digits));
                case 14:
                    return Make(digits, "gtin14", GtinChecksumValid(digits));
                default:
                    return null;
            }
        }
    }
}
