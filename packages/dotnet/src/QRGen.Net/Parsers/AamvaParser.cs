using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace QRGen
{
    /// <summary>Parsed AAMVA driver license / ID card (SPEC section 3.3).</summary>
    public sealed class AamvaResult
    {
        /// <summary>Issuer identification number (6 digits), for example <c>636014</c> (California).</summary>
        [JsonPropertyName("issuerId")] public string IssuerId { get; init; } = string.Empty;
        /// <summary>AAMVA standard version (1-10).</summary>
        [JsonPropertyName("aamvaVersion")] public int AamvaVersion { get; init; }
        /// <summary>Jurisdiction version number.</summary>
        [JsonPropertyName("jurisdictionVersion")] public int JurisdictionVersion { get; init; }
        /// <summary><c>DL</c> or <c>ID</c>.</summary>
        [JsonPropertyName("documentType")] public string DocumentType { get; init; } = string.Empty;
        /// <summary>First name.</summary>
        [JsonPropertyName("firstName")] public string FirstName { get; init; } = string.Empty;
        /// <summary>Middle name(s).</summary>
        [JsonPropertyName("middleName")] public string MiddleName { get; init; } = string.Empty;
        /// <summary>Family name.</summary>
        [JsonPropertyName("lastName")] public string LastName { get; init; } = string.Empty;
        /// <summary>Name suffix (JR, SR, III...).</summary>
        [JsonPropertyName("suffix")] public string Suffix { get; init; } = string.Empty;
        /// <summary>First, middle, last and suffix joined with spaces.</summary>
        [JsonPropertyName("fullName")] public string FullName { get; init; } = string.Empty;
        /// <summary>ISO <c>YYYY-MM-DD</c> date of birth, or an empty string.</summary>
        [JsonPropertyName("dateOfBirth")] public string DateOfBirth { get; init; } = string.Empty;
        /// <summary>ISO issue date, or an empty string.</summary>
        [JsonPropertyName("issueDate")] public string IssueDate { get; init; } = string.Empty;
        /// <summary>ISO expiry date, or an empty string.</summary>
        [JsonPropertyName("expiryDate")] public string ExpiryDate { get; init; } = string.Empty;
        /// <summary><c>M</c>, <c>F</c>, <c>X</c> or an empty string.</summary>
        [JsonPropertyName("sex")] public string Sex { get; init; } = string.Empty;
        /// <summary>Customer ID / license number (DAQ).</summary>
        [JsonPropertyName("documentNumber")] public string DocumentNumber { get; init; } = string.Empty;
        /// <summary>Street address (DAG, plus DAH when present).</summary>
        [JsonPropertyName("street")] public string Street { get; init; } = string.Empty;
        /// <summary>City.</summary>
        [JsonPropertyName("city")] public string City { get; init; } = string.Empty;
        /// <summary>State or province code.</summary>
        [JsonPropertyName("state")] public string State { get; init; } = string.Empty;
        /// <summary>ZIP (5 digits or ZIP+4) or Canadian postal code.</summary>
        [JsonPropertyName("postalCode")] public string PostalCode { get; init; } = string.Empty;
        /// <summary><c>USA</c>, <c>CAN</c> or an empty string.</summary>
        [JsonPropertyName("country")] public string Country { get; init; } = string.Empty;
        /// <summary>Eye color code (BRO, BLU...).</summary>
        [JsonPropertyName("eyeColor")] public string EyeColor { get; init; } = string.Empty;
        /// <summary>Height as encoded, for example <c>065 IN</c>.</summary>
        [JsonPropertyName("height")] public string Height { get; init; } = string.Empty;
        /// <summary>Age in whole years on the reference date, or <c>null</c> without a date of birth.</summary>
        [JsonPropertyName("age")] [JsonIgnore(Condition = JsonIgnoreCondition.Never)] public int? Age { get; init; }
        /// <summary>Whether the document expired before the reference date, or <c>null</c> without an expiry date.</summary>
        [JsonPropertyName("isExpired")] [JsonIgnore(Condition = JsonIgnoreCondition.Never)] public bool? IsExpired { get; init; }
        /// <summary>Whether the holder is under 21 on the reference date, or <c>null</c> without a date of birth.</summary>
        [JsonPropertyName("isUnder21")] [JsonIgnore(Condition = JsonIgnoreCondition.Never)] public bool? IsUnder21 { get; init; }
        /// <summary>Every data element (<c>DAQ</c>, <c>DCS</c>, jurisdiction <c>Z..</c> fields...).</summary>
        [JsonPropertyName("fields")] public IReadOnlyDictionary<string, string> Fields { get; init; } = new Dictionary<string, string>();
    }

    /// <summary>
    /// Parses the PDF417 on the back of North American driver licenses and ID cards
    /// (AAMVA DL/ID Card Design Standard, versions 1-10). Never throws.
    /// </summary>
    public static class AamvaParser
    {
        private static readonly Regex Header = new Regex(@"(ANSI |AAMVA)\s?(\d{6})(\d{2})", RegexOptions.CultureInvariant);
        private static readonly Regex Subfile = new Regex(@"^([A-Z]{2})(\d{4})(\d{4})$", RegexOptions.CultureInvariant);
        private static readonly Regex Field = new Regex(@"^([A-Z][A-Z0-9]{2})(.*)$", RegexOptions.CultureInvariant | RegexOptions.Singleline);
        private static readonly Regex LineSplit = new Regex(@"[\n\r\u001e]+", RegexOptions.CultureInvariant);
        private static readonly Regex ZSubfileStart = new Regex(@"(?:^|[\n\r])(Z[A-Z])(?=Z[A-Z])", RegexOptions.CultureInvariant);

        private static readonly HashSet<string> CanadianIins = new HashSet<string>
        {
            "604426", "604428", "604429", "604432", "604433", "604434", "636012", "636013", "636016", "636017",
            "636028", "636044", "636048",
        };

        /// <summary>Returns <c>true</c> when the text looks like an AAMVA DL/ID payload.</summary>
        public static bool IsAamva(string? data) => Parse(data) is not null;

        /// <summary>Parses an AAMVA payload; returns <c>null</c> when the text is not AAMVA data.</summary>
        /// <param name="data">The decoded PDF417 text.</param>
        /// <param name="today">Reference date for <c>age</c>, <c>isExpired</c> and <c>isUnder21</c> (default: today).</param>
        public static AamvaResult? Parse(string? data, DateTime? today = null)
        {
            try
            {
                return ParseCore(data, (today ?? DateTime.Today).Date);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static AamvaResult? ParseCore(string? text, DateTime today)
        {
            if (text is null || text.Length < 10) return null;
            var head = text.Length > 64 ? text.Substring(0, 64) : text;
            var header = Header.Match(head);
            if (!header.Success) header = Header.Match(text);
            var issuerId = string.Empty;
            var version = 0;
            var jurisdictionVersion = 0;
            var types = new List<string> { "DL", "ID" };
            var designatorTypes = new List<string>();
            string body;
            if (header.Success)
            {
                issuerId = header.Groups[2].Value;
                version = int.Parse(header.Groups[3].Value, CultureInfo.InvariantCulture);
                var pos = header.Index + header.Length;
                if (version >= 2 && pos + 2 <= text.Length && IsDigits(text.Substring(pos, 2)))
                {
                    jurisdictionVersion = int.Parse(text.Substring(pos, 2), CultureInfo.InvariantCulture);
                    pos += 2;
                }
                var bodyStart = pos;
                if (pos + 2 <= text.Length && IsDigits(text.Substring(pos, 2)))
                {
                    var count = int.Parse(text.Substring(pos, 2), CultureInfo.InvariantCulture);
                    var cursor = pos + 2;
                    var found = new List<string>();
                    for (var i = 0; i < count && cursor + 10 <= text.Length; i++)
                    {
                        var match = Subfile.Match(text.Substring(cursor, 10));
                        if (!match.Success) break;
                        found.Add(match.Groups[1].Value);
                        cursor += 10;
                    }
                    if (count > 0 && found.Count == count)
                    {
                        designatorTypes.AddRange(found);
                        bodyStart = cursor;
                    }
                }
                foreach (var type in designatorTypes)
                {
                    if (!types.Contains(type)) types.Add(type);
                }
                body = text.Substring(bodyStart);
            }
            else
            {
                if (!text.TrimStart().StartsWith("@", StringComparison.Ordinal)) return null;
                var match = Regex.Match(text, @"(DL|ID)(?=DA[A-Z])");
                if (!match.Success) return null;
                body = text.Substring(match.Index);
            }
            foreach (Match match in ZSubfileStart.Matches(body))
            {
                if (!types.Contains(match.Groups[1].Value)) types.Add(match.Groups[1].Value);
            }

            var fields = new Dictionary<string, string>(StringComparer.Ordinal);
            var documentType = string.Empty;
            foreach (var rawLine in LineSplit.Split(body))
            {
                var line = rawLine.Trim('\0');
                if (line.Length == 0) continue;
                if (line.Length >= 5 && types.Contains(line.Substring(0, 2)))
                {
                    var kind = line.Substring(0, 2);
                    var rest = line.Substring(2);
                    var isDocument = kind == "DL" || kind == "ID";
                    if ((isDocument && rest.StartsWith("D", StringComparison.Ordinal)) ||
                        (kind[0] == 'Z' && rest.StartsWith(kind, StringComparison.Ordinal)))
                    {
                        if (isDocument && documentType.Length == 0) documentType = kind;
                        line = rest;
                    }
                }
                var fieldMatch = Field.Match(line);
                if (!fieldMatch.Success) continue;
                var code = fieldMatch.Groups[1].Value;
                if (code[0] != 'D' && code[0] != 'Z') continue;
                if (!fields.ContainsKey(code)) fields[code] = fieldMatch.Groups[2].Value.TrimEnd();
            }
            if (!new[] { "DAQ", "DCS", "DAC", "DAA", "DAB", "DBB" }.Any(fields.ContainsKey)) return null;
            if (documentType.Length == 0)
                documentType = designatorTypes.FirstOrDefault(t => t == "DL" || t == "ID") ?? "DL";

            string Get(string key) => fields.TryGetValue(key, out var value) ? value.Trim() : string.Empty;

            var country = Get("DCG").ToUpperInvariant();
            if (country != "USA" && country != "CAN")
                country = CanadianIins.Contains(issuerId) ? "CAN" : (issuerId.Length > 0 ? "USA" : string.Empty);
            bool? canada = country == "CAN" ? true : country == "USA" ? false : (bool?)null;
            if (version == 1) canada = null; // AAMVA 2000 used CCYYMMDD everywhere

            var first = Get("DAC");
            var middle = Get("DAD");
            var last = Get("DCS");
            if (last.Length == 0) last = Get("DAB");
            var suffix = Get("DCU");
            if (suffix.Length == 0) suffix = Get("DAE");
            if (first.Length == 0 && Get("DCT").Length > 0)
            {
                var given = Regex.Split(Get("DCT"), @"[,$ ]+").Where(p => p.Length > 0).ToList();
                first = given.FirstOrDefault() ?? string.Empty;
                if (middle.Length == 0) middle = string.Join(" ", given.Skip(1));
            }
            if (Get("DAA").Length > 0 && (first.Length == 0 || last.Length == 0))
            {
                var (f, m, l, s) = SplitLegacyName(Get("DAA"));
                if (first.Length == 0) first = f;
                if (middle.Length == 0) middle = m;
                if (last.Length == 0) last = l;
                if (suffix.Length == 0) suffix = s;
            }
            var fullName = string.Join(" ", new[] { first, middle, last, suffix }.Where(p => p.Length > 0));

            var dob = ParseDate(Get("DBB"), canada);
            var issued = ParseDate(Get("DBD"), canada);
            var expiry = ParseDate(Get("DBA"), canada);
            int? age = dob is DateTime birth ? Age(birth, today) : (int?)null;

            var street = Get("DAG");
            if (Get("DAH").Length > 0) street = (street + ", " + Get("DAH")).Trim(',', ' ');

            return new AamvaResult
            {
                IssuerId = issuerId,
                AamvaVersion = version,
                JurisdictionVersion = jurisdictionVersion,
                DocumentType = documentType,
                FirstName = first,
                MiddleName = middle,
                LastName = last,
                Suffix = suffix,
                FullName = fullName,
                DateOfBirth = Iso(dob),
                IssueDate = Iso(issued),
                ExpiryDate = Iso(expiry),
                Sex = Sex(Get("DBC")),
                DocumentNumber = Get("DAQ"),
                Street = street,
                City = Get("DAI"),
                State = Get("DAJ"),
                PostalCode = Postal(Get("DAK"), country == "CAN"),
                Country = country,
                EyeColor = Get("DAY"),
                Height = Get("DAU"),
                Age = age,
                IsExpired = expiry is DateTime exp ? exp < today : (bool?)null,
                IsUnder21 = age is int years ? years < 21 : (bool?)null,
                Fields = fields,
            };
        }

        private static bool IsDigits(string value) => value.Length > 0 && value.All(c => c >= '0' && c <= '9');

        private static string Iso(DateTime? date) =>
            date is DateTime d ? d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : string.Empty;

        private static DateTime? Valid(int year, int month, int day)
        {
            if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
            if (day < 1 || day > DateTime.DaysInMonth(year, month)) return null;
            return new DateTime(year, month, day);
        }

        internal static DateTime? ParseDate(string value, bool? canada)
        {
            var digits = new string(value.Where(c => c >= '0' && c <= '9').ToArray());
            if (digits.Length < 8) return null;
            digits = digits.Substring(0, 8);
            int P(int start, int length) => int.Parse(digits.Substring(start, length), CultureInfo.InvariantCulture);
            var us = Valid(P(4, 4), P(0, 2), P(2, 2)); // MMDDCCYY
            var ca = Valid(P(0, 4), P(4, 2), P(6, 2)); // CCYYMMDD
            if (canada == true) return ca ?? us;
            if (canada == false) return us ?? ca;
            if (us is not null && ca is null) return us;
            if (ca is not null && us is null) return ca;
            if (us is not null && ca is not null) return ca.Value.Year >= 1900 && ca.Value.Year <= 2100 ? ca : us;
            return null;
        }

        private static int Age(DateTime dob, DateTime today)
        {
            var age = today.Year - dob.Year;
            if (today.Month < dob.Month || (today.Month == dob.Month && today.Day < dob.Day)) age--;
            return age;
        }

        private static string Postal(string value, bool canada)
        {
            value = value.Trim();
            if (!canada && value.Length == 9 && IsDigits(value))
                return value.Substring(5) == "0000" ? value.Substring(0, 5) : value.Substring(0, 5) + "-" + value.Substring(5);
            if (!canada && Regex.IsMatch(value, @"^\d{5}-?0000$")) return value.Substring(0, 5);
            return value.Replace("  ", " ").Trim();
        }

        private static string Sex(string value)
        {
            switch (value.Trim().ToUpperInvariant())
            {
                case "1":
                case "M": return "M";
                case "2":
                case "F": return "F";
                case "9":
                case "X": return "X";
                default: return string.Empty;
            }
        }

        private static (string First, string Middle, string Last, string Suffix) SplitLegacyName(string value)
        {
            value = value.Trim();
            if (value.IndexOf(',') >= 0 || value.IndexOf('$') >= 0)
            {
                var parts = value.Split(',', '$').Select(p => p.Trim()).ToList();
                while (parts.Count < 4) parts.Add(string.Empty);
                return (parts[1], parts[2], parts[0], parts[3]);
            }
            var tokens = value.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length >= 2)
                return (tokens[0], string.Join(" ", tokens.Skip(1).Take(tokens.Length - 2)), tokens[tokens.Length - 1], string.Empty);
            return (value, string.Empty, string.Empty, string.Empty);
        }
    }
}
