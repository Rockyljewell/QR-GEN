// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace QRGen
{
    /// <summary>
    /// Describes one barcode symbology from the QRGen specification (SPEC section 1).
    /// Every QRGen API accepts and returns the lowercase <see cref="Id"/>.
    /// </summary>
    public sealed class Symbology : IEquatable<Symbology>
    {
        private Symbology(string id, string name, bool isLinear, params string[] aliases)
        {
            Id = id;
            Name = name;
            IsLinear = isLinear;
            Aliases = aliases;
        }

        /// <summary>Canonical lowercase id, for example <c>data-matrix</c>.</summary>
        public string Id { get; }

        /// <summary>Human readable name, for example <c>Data Matrix</c>.</summary>
        public string Name { get; }

        /// <summary>Extra names accepted by <see cref="Symbologies.Resolve(IEnumerable{string}, bool)"/>.</summary>
        public IReadOnlyList<string> Aliases { get; }

        /// <summary><c>true</c> for 1D (linear) symbologies, <c>false</c> for 2D (matrix/stacked) ones.</summary>
        public bool IsLinear { get; }

        /// <summary>QR Code.</summary>
        public static readonly Symbology Qr = new Symbology("qr", "QR Code", false, "qrcode");
        /// <summary>Micro QR Code.</summary>
        public static readonly Symbology MicroQr = new Symbology("micro-qr", "Micro QR Code", false, "microqrcode");
        /// <summary>rMQR Code (rectangular Micro QR).</summary>
        public static readonly Symbology RmQr = new Symbology("rmqr", "rMQR Code", false, "rmqrcode");
        /// <summary>Data Matrix.</summary>
        public static readonly Symbology DataMatrix = new Symbology("data-matrix", "Data Matrix", false, "datamatrix", "dm");
        /// <summary>Aztec.</summary>
        public static readonly Symbology Aztec = new Symbology("aztec", "Aztec", false, "azteccode");
        /// <summary>PDF417 (including Compact PDF417).</summary>
        public static readonly Symbology Pdf417 = new Symbology("pdf417", "PDF417", false, "compactpdf417");
        /// <summary>MicroPDF417.</summary>
        public static readonly Symbology MicroPdf417 = new Symbology("micro-pdf417", "MicroPDF417", false, "micropdf417");
        /// <summary>MaxiCode.</summary>
        public static readonly Symbology MaxiCode = new Symbology("maxicode", "MaxiCode", false);
        /// <summary>EAN-13.</summary>
        public static readonly Symbology Ean13 = new Symbology("ean13", "EAN-13", true, "ean", "jan", "gtin13");
        /// <summary>EAN-8.</summary>
        public static readonly Symbology Ean8 = new Symbology("ean8", "EAN-8", true, "gtin8");
        /// <summary>UPC-A.</summary>
        public static readonly Symbology UpcA = new Symbology("upca", "UPC-A", true, "upc");
        /// <summary>UPC-E.</summary>
        public static readonly Symbology UpcE = new Symbology("upce", "UPC-E", true);
        /// <summary>ISBN (EAN-13 with a 978/979 prefix).</summary>
        public static readonly Symbology Isbn = new Symbology("isbn", "ISBN", true, "isbn13");
        /// <summary>Code 128 (including GS1-128).</summary>
        public static readonly Symbology Code128 = new Symbology("code128", "Code 128", true, "gs1128", "ean128");
        /// <summary>Code 39.</summary>
        public static readonly Symbology Code39 = new Symbology("code39", "Code 39", true, "code3of9");
        /// <summary>Code 93.</summary>
        public static readonly Symbology Code93 = new Symbology("code93", "Code 93", true);
        /// <summary>Codabar.</summary>
        public static readonly Symbology Codabar = new Symbology("codabar", "Codabar", true, "nw7");
        /// <summary>Interleaved 2 of 5.</summary>
        public static readonly Symbology Itf = new Symbology("itf", "Interleaved 2 of 5", true, "interleaved2of5", "i2of5");
        /// <summary>ITF-14.</summary>
        public static readonly Symbology Itf14 = new Symbology("itf14", "ITF-14", true);
        /// <summary>GS1 DataBar (Omnidirectional, Stacked).</summary>
        public static readonly Symbology DataBar = new Symbology("databar", "GS1 DataBar", true, "rss14", "databaromni");
        /// <summary>GS1 DataBar Expanded.</summary>
        public static readonly Symbology DataBarExpanded = new Symbology("databar-expanded", "GS1 DataBar Expanded", true, "rssexpanded");
        /// <summary>GS1 DataBar Limited.</summary>
        public static readonly Symbology DataBarLimited = new Symbology("databar-limited", "GS1 DataBar Limited", true, "rsslimited");
        /// <summary>Code 32 (Italian Pharmacode).</summary>
        public static readonly Symbology Code32 = new Symbology("code32", "Code 32 (Italian Pharmacode)", true);
        /// <summary>PZN (Pharmazentralnummer).</summary>
        public static readonly Symbology Pzn = new Symbology("pzn", "PZN", true);
        /// <summary>Telepen.</summary>
        public static readonly Symbology Telepen = new Symbology("telepen", "Telepen", true);
        /// <summary>DX Film Edge.</summary>
        public static readonly Symbology DxFilmEdge = new Symbology("dx-film-edge", "DX Film Edge", true);

        /// <summary>Every symbology, in SPEC order.</summary>
        public static IReadOnlyList<Symbology> All { get; } = new[]
        {
            Qr, MicroQr, RmQr, DataMatrix, Aztec, Pdf417, MicroPdf417, MaxiCode, Ean13, Ean8, UpcA, UpcE, Isbn,
            Code128, Code39, Code93, Codabar, Itf, Itf14, DataBar, DataBarExpanded, DataBarLimited, Code32, Pzn,
            Telepen, DxFilmEdge,
        };

        /// <inheritdoc />
        public bool Equals(Symbology? other) => other is not null && other.Id == Id;

        /// <inheritdoc />
        public override bool Equals(object? obj) => Equals(obj as Symbology);

        /// <inheritdoc />
        public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(Id);

        /// <summary>Returns <see cref="Id"/>.</summary>
        public override string ToString() => Id;

        /// <summary>Implicit conversion to the id string.</summary>
        public static implicit operator string(Symbology symbology) => symbology.Id;
    }

    /// <summary>
    /// Symbology lookup, alias and group resolution (SPEC section 1). Inputs are matched
    /// case-insensitively after removing everything except <c>[a-z0-9]</c>, so
    /// <c>QRCode</c>, <c>qr-code</c>, <c>QR</c> and <c>qr</c> all resolve to <c>qr</c>.
    /// </summary>
    public static class Symbologies
    {
        private static readonly Dictionary<string, Symbology> Lookup = BuildLookup();
        private static readonly Dictionary<string, string> GroupLookup;

        static Symbologies()
        {
            string[] linear =
            {
                "ean13", "ean8", "upca", "upce", "isbn", "code128", "code39", "code93", "codabar", "itf", "itf14",
                "databar", "databar-expanded", "databar-limited", "code32", "pzn", "telepen", "dx-film-edge",
            };
            string[] matrix = { "qr", "micro-qr", "rmqr", "data-matrix", "aztec", "pdf417", "micro-pdf417", "maxicode" };
            Groups = new Dictionary<string, IReadOnlyList<string>>
            {
                ["all"] = Ids,
                ["linear"] = linear,
                ["1d"] = linear,
                ["matrix"] = matrix,
                ["2d"] = matrix,
                ["retail"] = new[] { "ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited" },
                ["industrial"] = new[] { "code128", "code39", "code93", "codabar", "itf", "itf14", "data-matrix" },
                ["gs1"] = new[] { "code128", "data-matrix", "qr", "databar", "databar-expanded", "databar-limited" },
            };
            GroupLookup = Groups.Keys.ToDictionary(Normalize, k => k);
        }

        /// <summary>Every symbology id, in SPEC order.</summary>
        public static IReadOnlyList<string> Ids { get; } = Symbology.All.Select(s => s.Id).ToArray();

        /// <summary>Group name to ids (<c>all</c>, <c>linear</c>/<c>1d</c>, <c>matrix</c>/<c>2d</c>, <c>retail</c>, <c>industrial</c>, <c>gs1</c>).</summary>
        public static IReadOnlyDictionary<string, IReadOnlyList<string>> Groups { get; }

        /// <summary>Returns the lookup key for a name: lowercase with everything except <c>[a-z0-9]</c> removed.</summary>
        public static string Normalize(string name)
        {
            if (name is null) return string.Empty;
            var builder = new StringBuilder(name.Length);
            foreach (var ch in name)
            {
                var lower = char.ToLowerInvariant(ch);
                if ((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9')) builder.Append(lower);
            }
            return builder.ToString();
        }

        /// <summary>Looks up a single symbology by id, name or alias (not a group).</summary>
        public static bool TryGet(string name, out Symbology symbology)
        {
            if (name is not null && Lookup.TryGetValue(Normalize(name), out var found))
            {
                symbology = found;
                return true;
            }
            symbology = null!;
            return false;
        }

        /// <summary>Returns the symbology for an id, name or alias.</summary>
        /// <exception cref="ArgumentException">The name is not a known symbology.</exception>
        public static Symbology Get(string name)
        {
            if (TryGet(name, out var symbology)) return symbology;
            throw new ArgumentException($"Unknown symbology '{name}'.", nameof(name));
        }

        /// <summary>Returns the human readable name for an id (<c>qr</c> becomes <c>QR Code</c>), or the id itself when unknown.</summary>
        public static string GetName(string id) => TryGet(id, out var s) ? s.Name : id;

        /// <summary>
        /// Expands ids, aliases and groups into a de-duplicated list of ids in SPEC order.
        /// <c>null</c> or an empty list means <c>all</c>.
        /// </summary>
        /// <param name="names">Ids, aliases or groups, for example <c>["QRCode", "retail"]</c>.</param>
        /// <param name="ignoreUnknown">Skip unknown names instead of throwing.</param>
        /// <exception cref="ArgumentException">A name is unknown and <paramref name="ignoreUnknown"/> is <c>false</c>.</exception>
        public static IReadOnlyList<string> Resolve(IEnumerable<string>? names, bool ignoreUnknown = false)
        {
            var list = names?.Where(n => !string.IsNullOrWhiteSpace(n)).ToList() ?? new List<string>();
            if (list.Count == 0) return Ids;
            var wanted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var name in list)
            {
                var key = Normalize(name);
                if (GroupLookup.TryGetValue(key, out var group))
                {
                    wanted.UnionWith(Groups[group]);
                }
                else if (Lookup.TryGetValue(key, out var symbology))
                {
                    wanted.Add(symbology.Id);
                }
                else if (!ignoreUnknown)
                {
                    throw new ArgumentException(
                        $"Unknown symbology '{name}'. Use one of: {string.Join(", ", Ids)} or a group ({string.Join(", ", Groups.Keys)}).",
                        nameof(names));
                }
            }
            return Ids.Where(wanted.Contains).ToArray();
        }

        /// <summary>Resolves a comma or space separated list such as <c>"qr,ean13"</c>.</summary>
        public static IReadOnlyList<string> Resolve(string? commaSeparated, bool ignoreUnknown = false) =>
            Resolve((commaSeparated ?? string.Empty).Split(new[] { ',', ' ', ';' }, StringSplitOptions.RemoveEmptyEntries), ignoreUnknown);

        private static Dictionary<string, Symbology> BuildLookup()
        {
            var lookup = new Dictionary<string, Symbology>(StringComparer.Ordinal);
            foreach (var symbology in Symbology.All)
            {
                foreach (var key in new[] { symbology.Id, symbology.Name }.Concat(symbology.Aliases))
                {
                    var normalized = Normalize(key);
                    if (!lookup.ContainsKey(normalized)) lookup[normalized] = symbology;
                }
            }
            if (!lookup.ContainsKey("qr")) lookup["qr"] = Symbology.Qr;
            return lookup;
        }
    }
}
