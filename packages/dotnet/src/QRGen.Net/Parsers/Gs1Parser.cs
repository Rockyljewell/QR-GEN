// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace QRGen
{
    /// <summary>One GS1 element string (AI + value) in a <see cref="Gs1Result"/>.</summary>
    public sealed class Gs1Element
    {
        /// <summary>Application Identifier, for example <c>01</c> or <c>3103</c>.</summary>
        [JsonPropertyName("ai")]
        public string Ai { get; init; } = string.Empty;

        /// <summary>GS1 data title, for example <c>BATCH/LOT</c> (<c>UNKNOWN</c> for AIs not in the table).</summary>
        [JsonPropertyName("title")]
        public string Title { get; init; } = string.Empty;

        /// <summary>The value (GTINs from Digital Link URLs are zero padded to 14 digits).</summary>
        [JsonPropertyName("value")]
        public string Value { get; init; } = string.Empty;

        /// <summary>The value as it appeared in the input when it was normalized, else <c>null</c>.</summary>
        [JsonPropertyName("raw")]
        public string? Raw { get; init; }

        /// <summary>ISO <c>YYYY-MM-DD</c> date for date AIs (11, 12, 13, 15, 16, 17); day 00 means the last day of the month.</summary>
        [JsonPropertyName("date")]
        public string? Date { get; init; }

        /// <summary>Numeric value for decimal AIs (310n-369n, 390n-395n) with the implied decimal point applied.</summary>
        [JsonPropertyName("number")]
        public double? Number { get; init; }
    }

    /// <summary>Result of <see cref="Gs1Parser.Parse(string?, DateTime?)"/> (SPEC section 3.2).</summary>
    public sealed class Gs1Result
    {
        /// <summary>Elements in input order.</summary>
        [JsonPropertyName("elements")]
        public IReadOnlyList<Gs1Element> Elements { get; init; } = Array.Empty<Gs1Element>();

        /// <summary>AI to value (first occurrence wins).</summary>
        [JsonPropertyName("values")]
        public IReadOnlyDictionary<string, string> Values { get; init; } = new Dictionary<string, string>();

        /// <summary>Returns the value of an AI, or <c>null</c>.</summary>
        public string? this[string ai] => Values.TryGetValue(ai, out var value) ? value : null;
    }

    /// <summary>Definition of one GS1 Application Identifier.</summary>
    public sealed class Gs1AiDefinition
    {
        internal Gs1AiDefinition(string ai, string title, IReadOnlyList<(char Kind, int Length, bool Fixed)> components,
            int? decimals = null, bool isDate = false, bool currencyPrefix = false)
        {
            Ai = ai;
            Title = title;
            Components = components;
            Decimals = decimals;
            IsDate = isDate;
            CurrencyPrefix = currencyPrefix;
        }

        /// <summary>The AI digits.</summary>
        public string Ai { get; }

        /// <summary>GS1 data title.</summary>
        public string Title { get; }

        /// <summary>Implied decimal places for measure/amount AIs, else <c>null</c>.</summary>
        public int? Decimals { get; }

        /// <summary><c>true</c> when the value is a <c>YYMMDD</c> date.</summary>
        public bool IsDate { get; }

        internal bool CurrencyPrefix { get; }

        internal IReadOnlyList<(char Kind, int Length, bool Fixed)> Components { get; }

        /// <summary>Total length when every component is fixed, else <c>null</c>.</summary>
        public int? FixedLength => Components.All(c => c.Fixed) ? Components.Sum(c => c.Length) : (int?)null;

        /// <summary>Longest valid value.</summary>
        public int MaxLength => Components.Sum(c => c.Length);

        /// <summary>Checks a value against the AI format (length and numeric components).</summary>
        public bool Validate(string value)
        {
            var pos = 0;
            for (var i = 0; i < Components.Count; i++)
            {
                var (kind, length, isFixed) = Components[i];
                var last = i == Components.Count - 1;
                string part;
                if (isFixed)
                {
                    if (value.Length - pos < length) return false;
                    part = value.Substring(pos, length);
                }
                else
                {
                    var available = value.Length - pos;
                    part = last ? value.Substring(pos) : value.Substring(pos, Math.Min(length, available));
                    if (part.Length > length) return false;
                    if (part.Length == 0 && i == 0) return false;
                }
                if (kind == 'N' && part.Any(c => c < '0' || c > '9')) return false;
                if (kind == 'X' && part.Any(c => c < 0x20 || c == 0x7F)) return false;
                pos += part.Length;
            }
            return pos == value.Length;
        }
    }

    /// <summary>
    /// GS1 element string and GS1 Digital Link parser (SPEC section 3.2). Accepts the HRI form
    /// <c>(01)09501101530003(17)250101(10)ABC123</c>, raw strings with ASCII 29 (GS) separators and
    /// an optional <c>]C1</c>/<c>]d2</c>/<c>]Q3</c>/<c>]e0</c> prefix, and Digital Link URLs such as
    /// <c>https://id.gs1.org/01/09501101530003/10/ABC123?17=250101</c>. Never throws.
    /// </summary>
    public static class Gs1Parser
    {
        /// <summary>ASCII 29, the FNC1 / group separator.</summary>
        public const char GroupSeparator = '\u001d';

        private static readonly Regex HriAi = new Regex(@"\((\d{2,4})\)", RegexOptions.CultureInvariant);
        private static readonly Regex SymbologyIdentifier = new Regex(@"^\][A-Za-z][0-9A-Za-z]", RegexOptions.CultureInvariant);

        private static readonly HashSet<string> DlPrimaryKeys = new HashSet<string>
        {
            "00", "01", "253", "255", "401", "402", "414", "417", "8003", "8004", "8006", "8010", "8013", "8017", "8018",
        };

        private static readonly Dictionary<string, string> DlShortNames = new Dictionary<string, string>
        {
            ["gtin"] = "01", ["itip"] = "8006", ["cpid"] = "8010", ["gln"] = "414", ["party"] = "417",
            ["gsrnp"] = "8017", ["gsrn"] = "8018", ["gcn"] = "255", ["sscc"] = "00", ["gdti"] = "253",
            ["ginc"] = "401", ["gsin"] = "402", ["grai"] = "8003", ["giai"] = "8004", ["gmn"] = "8013",
            ["cpv"] = "22", ["lot"] = "10", ["ser"] = "21", ["glnx"] = "254", ["srin"] = "8019",
            ["tpx"] = "235", ["exp"] = "17",
        };

        /// <summary>Every known AI keyed by its digits.</summary>
        public static IReadOnlyDictionary<string, Gs1AiDefinition> AiTable { get; } = Gs1AiTable.Build();

        /// <summary>Returns the definition of an AI, or <c>null</c>.</summary>
        public static Gs1AiDefinition? Lookup(string ai) => AiTable.TryGetValue(ai, out var d) ? d : null;

        /// <summary>Parses GS1 data. Returns <c>null</c> when the input is not valid GS1 data.</summary>
        /// <param name="data">HRI text, raw text with GS separators, or a Digital Link URL.</param>
        /// <param name="today">Reference date for the two-digit-year century window (default: today).</param>
        public static Gs1Result? Parse(string? data, DateTime? today = null)
        {
            try
            {
                if (data is null) return null;
                var reference = (today ?? DateTime.Today).Date;
                var text = data.Trim(' ', '\t', '\r', '\n');
                if (text.Length == 0) return null;
                if (text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                    text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    return ParseDigitalLink(text, reference);
                }
                if (SymbologyIdentifier.IsMatch(text)) text = text.Substring(3);
                text = text.Replace("<GS>", GroupSeparator.ToString()).Replace("\\x1d", GroupSeparator.ToString());
                text = text.Trim(GroupSeparator);
                if (text.Length == 0) return null;
                return text[0] == '(' ? ParseHri(text, reference) : ParseRaw(text, reference);
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Returns <c>true</c> when the URL is a GS1 Digital Link with a valid primary key.</summary>
        public static bool IsDigitalLink(string? url)
        {
            if (url is null) return false;
            var text = url.Trim();
            return (text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                    text.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) && Parse(text) is not null;
        }

        /// <summary>Renders a result as HRI text: <c>(01)...(10)...</c>.</summary>
        public static string ToHri(Gs1Result result) =>
            string.Concat(result.Elements.Select(e => "(" + e.Ai + ")" + e.Value));

        /// <summary>Renders a result as a raw element string with a separator after every variable-length field except the last.</summary>
        public static string ToElementString(Gs1Result result, char separator = GroupSeparator)
        {
            var builder = new StringBuilder();
            for (var i = 0; i < result.Elements.Count; i++)
            {
                var element = result.Elements[i];
                builder.Append(element.Ai).Append(element.Value);
                var definition = Lookup(element.Ai);
                if (i < result.Elements.Count - 1 && (definition is null || definition.FixedLength is null))
                    builder.Append(separator);
            }
            return builder.ToString();
        }

        private static int CenturyYear(int yy, DateTime today)
        {
            var current = today.Year;
            var baseYear = current - current % 100;
            var diff = yy - current % 100;
            if (diff >= 51) return baseYear - 100 + yy;
            if (diff <= -50) return baseYear + 100 + yy;
            return baseYear + yy;
        }

        private static string? IsoDate(string value, DateTime today)
        {
            if (value.Length < 6 || !value.Take(6).All(Ascii.IsDigit)) return null;
            var yy = int.Parse(value.Substring(0, 2), CultureInfo.InvariantCulture);
            var mm = int.Parse(value.Substring(2, 2), CultureInfo.InvariantCulture);
            var dd = int.Parse(value.Substring(4, 2), CultureInfo.InvariantCulture);
            if (mm < 1 || mm > 12) return null;
            var year = CenturyYear(yy, today);
            var last = DateTime.DaysInMonth(year, mm);
            if (dd == 0) dd = last;
            if (dd > last) return null;
            return string.Format(CultureInfo.InvariantCulture, "{0:D4}-{1:D2}-{2:D2}", year, mm, dd);
        }

        private static double? ToNumber(Gs1AiDefinition definition, string value)
        {
            var digits = definition.CurrencyPrefix && value.Length > 3 ? value.Substring(3) : value;
            if (digits.Length == 0 || !digits.All(Ascii.IsDigit) || definition.Decimals is null) return null;
            if (!decimal.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var number)) return null;
            for (var i = 0; i < definition.Decimals.Value; i++) number /= 10m;
            return (double)number;
        }

        private static (Gs1Element Element, bool Ok) MakeElement(string ai, string value, DateTime today, string? raw = null)
        {
            var definition = Lookup(ai);
            if (definition is null)
            {
                return (new Gs1Element { Ai = ai, Title = "UNKNOWN", Value = value, Raw = raw != value ? raw : null }, value.Length > 0);
            }
            if (!definition.Validate(value))
                return (new Gs1Element { Ai = ai, Title = definition.Title, Value = value }, false);
            return (new Gs1Element
            {
                Ai = ai,
                Title = definition.Title,
                Value = value,
                Raw = raw is not null && raw != value ? raw : null,
                Date = definition.IsDate ? IsoDate(value, today) : null,
                Number = definition.Decimals is not null ? ToNumber(definition, value) : null,
            }, true);
        }

        private static Gs1Result? MakeResult(List<Gs1Element> elements)
        {
            if (elements.Count == 0 || !elements.Any(e => AiTable.ContainsKey(e.Ai))) return null;
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var element in elements)
            {
                if (!values.ContainsKey(element.Ai)) values[element.Ai] = element.Value;
            }
            return new Gs1Result { Elements = elements, Values = values };
        }

        private static Gs1Result? ParseHri(string text, DateTime today)
        {
            var matches = HriAi.Matches(text).Cast<Match>().ToList();
            if (matches.Count == 0 || matches[0].Index != 0) return null;
            var elements = new List<Gs1Element>();
            for (var i = 0; i < matches.Count; i++)
            {
                var start = matches[i].Index + matches[i].Length;
                var end = i + 1 < matches.Count ? matches[i + 1].Index : text.Length;
                var value = text.Substring(start, end - start).Replace(GroupSeparator.ToString(), string.Empty);
                var (element, ok) = MakeElement(matches[i].Groups[1].Value, value, today);
                if (!ok) return null;
                elements.Add(element);
            }
            return MakeResult(elements);
        }

        private static Gs1Result? ParseRaw(string text, DateTime today)
        {
            var elements = new List<Gs1Element>();
            var pos = 0;
            while (pos < text.Length)
            {
                if (text[pos] == GroupSeparator)
                {
                    pos++;
                    continue;
                }
                string? ai = null;
                for (var size = 2; size <= 4; size++)
                {
                    if (pos + size > text.Length) break;
                    var candidate = text.Substring(pos, size);
                    if (candidate.All(Ascii.IsDigit) && AiTable.ContainsKey(candidate))
                    {
                        ai = candidate;
                        break;
                    }
                }
                if (ai is null) return null;
                var definition = AiTable[ai];
                pos += ai.Length;
                string value;
                var fixedLength = definition.FixedLength;
                if (fixedLength is int length)
                {
                    if (pos + length > text.Length) return null;
                    value = text.Substring(pos, length);
                    pos += length;
                }
                else
                {
                    var end = text.IndexOf(GroupSeparator, pos);
                    if (end < 0) end = text.Length;
                    value = text.Substring(pos, end - pos);
                    pos = end;
                }
                var (element, ok) = MakeElement(ai, value, today);
                if (!ok) return null;
                elements.Add(element);
            }
            return MakeResult(elements);
        }

        private static string? DlAi(string segment)
        {
            if (segment.Length > 0 && segment.All(Ascii.IsDigit) && AiTable.ContainsKey(segment)) return segment;
            return DlShortNames.TryGetValue(segment, out var ai) ? ai : null;
        }

        private static Gs1Result? ParseDigitalLink(string url, DateTime today)
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || string.IsNullOrEmpty(uri.Host)) return null;
            var segments = uri.AbsolutePath.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(Uri.UnescapeDataString).ToList();
            var start = -1;
            for (var i = 0; i < segments.Count - 1; i++)
            {
                var ai = DlAi(segments[i]);
                if (ai is not null && DlPrimaryKeys.Contains(ai))
                {
                    start = i;
                    break;
                }
            }
            if (start < 0) return null;
            var pairs = segments.Skip(start).ToList();
            if (pairs.Count % 2 != 0) return null;
            var elements = new List<Gs1Element>();
            for (var i = 0; i < pairs.Count; i += 2)
            {
                var ai = DlAi(pairs[i]);
                if (ai is null) return null;
                var raw = pairs[i + 1];
                var value = raw;
                if ((ai == "01" || ai == "02" || ai == "03") && value.All(Ascii.IsDigit) &&
                    (value.Length == 8 || value.Length == 12 || value.Length == 13))
                {
                    value = value.PadLeft(14, '0');
                }
                var (element, ok) = MakeElement(ai, value, today, raw);
                if (!ok) return null;
                elements.Add(element);
            }
            var query = uri.Query.TrimStart('?');
            foreach (var part in query.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var index = part.IndexOf('=');
                if (index <= 0) continue;
                var key = Uri.UnescapeDataString(part.Substring(0, index).Replace('+', ' '));
                var rawValue = Uri.UnescapeDataString(part.Substring(index + 1).Replace('+', ' '));
                if (rawValue.Length == 0) continue;
                var ai = key.All(Ascii.IsDigit) && AiTable.ContainsKey(key) ? key : (DlShortNames.TryGetValue(key, out var s) ? s : null);
                if (ai is null) continue;
                var (element, ok) = MakeElement(ai, rawValue, today);
                if (!ok) return null;
                elements.Add(element);
            }
            return MakeResult(elements);
        }
    }

    internal static class Gs1AiTable
    {
        private static readonly string[] Base =
        {
            "00|SSCC|N18", "01|GTIN|N14", "02|CONTENT|N14", "03|MTO GTIN|N14", "10|BATCH/LOT|X..20",
            "11|PROD DATE|N6", "12|DUE DATE|N6", "13|PACK DATE|N6", "15|BEST BEFORE or BEST BY|N6", "16|SELL BY|N6",
            "17|USE BY or EXPIRY|N6", "20|VARIANT|N2", "21|SERIAL|X..20", "22|CPV|X..20", "235|TPX|X..28",
            "240|ADDITIONAL ID|X..30", "241|CUST. PART No.|X..30", "242|MTO VARIANT|N..6", "243|PCN|X..20",
            "250|SECONDARY SERIAL|X..30", "251|REF. TO SOURCE|X..30", "253|GDTI|N13 X..17",
            "254|GLN EXTENSION COMPONENT|X..20", "255|GCN|N13 N..12", "30|VAR. COUNT|N..8", "37|COUNT|N..8",
            "400|ORDER NUMBER|X..30", "401|GINC|X..30", "402|GSIN|N17", "403|ROUTE|X..30", "410|SHIP TO LOC|N13",
            "411|BILL TO|N13", "412|PURCHASE FROM|N13", "413|SHIP FOR LOC|N13", "414|LOC No.|N13", "415|PAY TO|N13",
            "416|PROD/SERV LOC|N13", "417|PARTY|N13", "420|SHIP TO POST|X..20", "421|SHIP TO POST|N3 X..9",
            "422|ORIGIN|N3", "423|COUNTRY - INITIAL PROCESS.|N3 N..12", "424|COUNTRY - PROCESS.|N3",
            "425|COUNTRY - DISASSEMBLY|N3 N..12", "426|COUNTRY - FULL PROCESS|N3", "427|ORIGIN SUBDIVISION|X..3",
            "4300|SHIP TO COMP|X..35", "4301|SHIP TO NAME|X..35", "4302|SHIP TO ADD1|X..70", "4303|SHIP TO ADD2|X..70",
            "4304|SHIP TO SUB|X..70", "4305|SHIP TO LOC|X..70", "4306|SHIP TO REG|X..70", "4307|SHIP TO COUNTRY|X2",
            "4308|SHIP TO PHONE|X..30", "4309|SHIP TO GEO|N20", "4310|RTN TO COMP|X..35", "4311|RTN TO NAME|X..35",
            "4312|RTN TO ADD1|X..70", "4313|RTN TO ADD2|X..70", "4314|RTN TO SUB|X..70", "4315|RTN TO LOC|X..70",
            "4316|RTN TO REG|X..70", "4317|RTN TO COUNTRY|X2", "4318|RTN TO POST|X..20", "4319|RTN TO PHONE|X..30",
            "4320|SRV DESCRIPTION|X..35", "4321|DANGEROUS GOODS|N1", "4322|AUTH LEAVE|N1", "4323|SIG REQUIRED|N1",
            "4324|NBEF DEL DT|N10", "4325|NAFT DEL DT|N10", "4326|REL DATE|N6", "4330|MAX TEMP F|N6 X..1",
            "4331|MAX TEMP C|N6 X..1", "4332|MIN TEMP F|N6 X..1", "4333|MIN TEMP C|N6 X..1", "7001|NSN|N13",
            "7002|MEAT CUT|X..30", "7003|EXPIRY TIME|N10", "7004|ACTIVE POTENCY|N..4", "7005|CATCH AREA|X..12",
            "7006|FIRST FREEZE DATE|N6", "7007|HARVEST DATE|N6 N..6", "7008|AQUATIC SPECIES|X..3",
            "7009|FISHING GEAR TYPE|X..10", "7010|PROD METHOD|X..2", "7011|TEST BY DATE|N6 N..4",
            "7020|REFURB LOT|X..20", "7021|FUNC STAT|X..20", "7022|REV STAT|X..20", "7023|GIAI - ASSEMBLY|X..30",
            "7040|UIC+EXT|N1 X3", "710|NHRN PZN|X..20", "711|NHRN CIP|X..20", "712|NHRN CN|X..20",
            "713|NHRN DRN|X..20", "714|NHRN AIM|X..20", "715|NHRN NDC|X..20", "716|NHRN AIC|X..20",
            "7240|PROTOCOL|X..20", "7241|AIDC MEDIA TYPE|N2", "7242|VCN|X..25", "7250|DOB|N8", "7251|DOB TIME|N12",
            "7252|BIO SEX|N1", "7253|FAMILY NAME|X..40", "7254|GIVEN NAME|X..40", "7255|SUFFIX|X..10",
            "7256|FULL NAME|X..90", "7257|PERSON ADDR|X..70", "7258|BIRTH SEQUENCE|N1 X1 N1", "7259|BABY|X..40",
            "8001|DIMENSIONS|N14", "8002|CMT No.|X..20", "8003|GRAI|N14 X..16", "8004|GIAI|X..30",
            "8005|PRICE PER UNIT|N6", "8006|ITIP|N14 N2 N2", "8007|IBAN|X..34", "8008|PROD TIME|N8 N..4",
            "8009|OPTSEN|X..50", "8010|CPID|X..30", "8011|CPID SERIAL|N..12", "8012|VERSION|X..20", "8013|GMN|X..25",
            "8014|MUDI|X..25", "8017|GSRN - PROVIDER|N18", "8018|GSRN - RECIPIENT|N18", "8019|SRIN|N..10",
            "8020|REF No.|X..25", "8026|ITIP CONTENT|N14 N2 N2", "8030|DIGSIG|X..90", "8110|COUPON|X..70",
            "8111|POINTS|N4", "8112|PAPERLESS COUPON|X..70", "8200|PRODUCT URL|X..70", "90|INTERNAL|X..30",
        };

        private static readonly string[] Measures =
        {
            "310|NET WEIGHT (kg)", "311|LENGTH (m)", "312|WIDTH (m)", "313|HEIGHT (m)", "314|AREA (m2)",
            "315|NET VOLUME (l)", "316|NET VOLUME (m3)", "320|NET WEIGHT (lb)", "321|LENGTH (in)", "322|LENGTH (ft)",
            "323|LENGTH (yd)", "324|WIDTH (in)", "325|WIDTH (ft)", "326|WIDTH (yd)", "327|HEIGHT (in)",
            "328|HEIGHT (ft)", "329|HEIGHT (yd)", "330|GROSS WEIGHT (kg)", "331|LENGTH (m), log", "332|WIDTH (m), log",
            "333|HEIGHT (m), log", "334|AREA (m2), log", "335|VOLUME (l), log", "336|VOLUME (m3), log",
            "337|KG PER m2", "340|GROSS WEIGHT (lb)", "341|LENGTH (in), log", "342|LENGTH (ft), log",
            "343|LENGTH (yd), log", "344|WIDTH (in), log", "345|WIDTH (ft), log", "346|WIDTH (yd), log",
            "347|HEIGHT (in), log", "348|HEIGHT (ft), log", "349|HEIGHT (yd), log", "350|AREA (in2)",
            "351|AREA (ft2)", "352|AREA (yd2)", "353|AREA (in2), log", "354|AREA (ft2), log", "355|AREA (yd2), log",
            "356|NET WEIGHT (troy oz)", "357|NET VOLUME (oz)", "360|NET VOLUME (qt)", "361|NET VOLUME (gal.)",
            "362|VOLUME (qt), log", "363|VOLUME (gal.), log", "364|VOLUME (in3)", "365|VOLUME (ft3)",
            "366|VOLUME (yd3)", "367|VOLUME (in3), log", "368|VOLUME (ft3), log", "369|VOLUME (yd3), log",
        };

        private static readonly string[] Amounts =
        {
            "390|AMOUNT|N..15|0", "391|AMOUNT|N3 N..15|1", "392|PRICE|N..15|0", "393|PRICE|N3 N..15|1",
            "394|PRCNT OFF|N4|0", "395|PRICE/UoM|N6|0",
        };

        private static readonly HashSet<string> DateAis = new HashSet<string> { "11", "12", "13", "15", "16", "17" };

        internal static IReadOnlyList<(char, int, bool)> Format(string spec)
        {
            var parts = new List<(char, int, bool)>();
            foreach (var token in spec.Split(' '))
            {
                var kind = token[0];
                var variable = token.Length > 2 && token[1] == '.' && token[2] == '.';
                var length = int.Parse(variable ? token.Substring(3) : token.Substring(1), CultureInfo.InvariantCulture);
                parts.Add((kind, length, !variable));
            }
            return parts;
        }

        internal static IReadOnlyDictionary<string, Gs1AiDefinition> Build()
        {
            var table = new Dictionary<string, Gs1AiDefinition>(StringComparer.Ordinal);
            void Add(Gs1AiDefinition definition) => table[definition.Ai] = definition;

            foreach (var entry in Base)
            {
                var parts = entry.Split('|');
                Add(new Gs1AiDefinition(parts[0], parts[1], Format(parts[2]), isDate: DateAis.Contains(parts[0])));
            }
            for (var s = 0; s < 10; s++)
            {
                Add(new Gs1AiDefinition("703" + s, "PROCESSOR # " + s, Format("N3 X..27")));
                Add(new Gs1AiDefinition("723" + s, "CERT # " + (s + 1), Format("X2 X..28")));
            }
            for (var d = 1; d < 10; d++) Add(new Gs1AiDefinition("9" + d, "INTERNAL", Format("X..90")));
            foreach (var entry in Measures)
            {
                var parts = entry.Split('|');
                for (var n = 0; n < 10; n++) Add(new Gs1AiDefinition(parts[0] + n, parts[1], Format("N6"), decimals: n));
            }
            foreach (var entry in Amounts)
            {
                var parts = entry.Split('|');
                for (var n = 0; n < 10; n++)
                    Add(new Gs1AiDefinition(parts[0] + n, parts[1], Format(parts[2]), decimals: n, currencyPrefix: parts[3] == "1"));
            }
            return table;
        }
    }
}
