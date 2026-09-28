// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace QRGen.Embed
{
    /// <summary>
    /// Scanner options for the hosted embed page (SPEC sections 4 and 5). <see cref="BuildUri"/> turns them
    /// into the query string the page reads, for use in any WebView (.NET MAUI, WPF/WinUI WebView2...).
    /// </summary>
    public sealed class EmbedOptions
    {
        /// <summary>The hosted scanner page.</summary>
        public const string DefaultBaseUrl = "https://rockyljewell.github.io/QR-GEN/embed/";

        /// <summary>Page URL (default <see cref="DefaultBaseUrl"/>; point it at a self-hosted copy if needed).</summary>
        public string BaseUrl { get; set; } = DefaultBaseUrl;

        /// <summary>Ids or groups (default: all).</summary>
        public IList<string> Symbologies { get; set; } = new List<string>();

        /// <summary><c>single</c>, <c>continuous</c> or <c>batch</c> (default <c>continuous</c>).</summary>
        public string Mode { get; set; } = "continuous";

        /// <summary>Milliseconds before the same code is reported again (<c>0</c> every frame, <c>-1</c> once). <c>null</c> keeps the page default (1000).</summary>
        public int? DuplicateFilter { get; set; }

        /// <summary>Play a tone on scan (default <c>true</c>).</summary>
        public bool Beep { get; set; } = true;

        /// <summary>Vibrate on scan (default <c>true</c>).</summary>
        public bool Vibrate { get; set; } = true;

        /// <summary><c>back</c>, <c>front</c> or a device id (default <c>back</c>).</summary>
        public string Camera { get; set; } = "back";

        /// <summary>Start with the flashlight on.</summary>
        public bool Torch { get; set; }

        /// <summary><c>frame</c>, <c>line</c> or <c>none</c>; <c>null</c> lets the page choose.</summary>
        public string? Viewfinder { get; set; }

        /// <summary>Codes per frame; <c>null</c> keeps the page default (1, or 20 in batch mode).</summary>
        public int? MaxResults { get; set; }

        /// <summary>Region of interest <c>(x, y, width, height)</c> normalized to 0..1; <c>null</c> for the full frame.</summary>
        public (double X, double Y, double Width, double Height)? ScanArea { get; set; }

        /// <summary>Builds the page URL with the options in the query string.</summary>
        public Uri BuildUri()
        {
            var query = new List<string>();
            void Add(string key, string value) => query.Add(key + "=" + Uri.EscapeDataString(value).Replace("%2C", ","));
            var symbologies = Symbologies?.Where(s => !string.IsNullOrWhiteSpace(s)).ToList() ?? new List<string>();
            if (symbologies.Count > 0) Add("symbologies", string.Join(",", QRGen.Symbologies.Resolve(symbologies)));
            Add("mode", Mode);
            if (DuplicateFilter is int filter) Add("duplicateFilter", filter.ToString(CultureInfo.InvariantCulture));
            Add("beep", Beep ? "1" : "0");
            Add("vibrate", Vibrate ? "1" : "0");
            Add("camera", Camera);
            if (Torch) Add("torch", "1");
            if (!string.IsNullOrEmpty(Viewfinder)) Add("viewfinder", Viewfinder!);
            if (MaxResults is int max) Add("maxResults", max.ToString(CultureInfo.InvariantCulture));
            if (ScanArea is { } area)
            {
                Add("scanArea", string.Join(",", new[] { area.X, area.Y, area.Width, area.Height }
                    .Select(v => v.ToString("0.####", CultureInfo.InvariantCulture))));
            }
            var separator = BaseUrl.Contains("?") ? "&" : "?";
            return new Uri(BaseUrl + separator + string.Join("&", query));
        }
    }

    /// <summary>
    /// A message posted by the embed page (SPEC section 5):
    /// <c>{ "source": "qrgen", "version": 1, "type": "scan" | "track" | "error" | "ready", ... }</c>.
    /// </summary>
    public sealed class EmbedMessage
    {
        /// <summary>Always <c>qrgen</c> for messages from the page.</summary>
        [JsonPropertyName("source")] public string Source { get; init; } = string.Empty;

        /// <summary>Envelope version (1).</summary>
        [JsonPropertyName("version")] public int Version { get; init; }

        /// <summary><c>scan</c>, <c>track</c>, <c>error</c> or <c>ready</c>.</summary>
        [JsonPropertyName("type")] public string Type { get; init; } = string.Empty;

        /// <summary>Barcodes of a <c>scan</c> event.</summary>
        [JsonPropertyName("barcodes")] public IReadOnlyList<Barcode>? Barcodes { get; init; }

        /// <summary>Tracked barcodes of a <c>track</c> event (batch mode).</summary>
        [JsonPropertyName("tracked")] public IReadOnlyList<TrackedBarcode>? Tracked { get; init; }

        /// <summary>Error code of an <c>error</c> event, for example <c>camera-permission-denied</c>.</summary>
        [JsonPropertyName("code")] public string? Code { get; init; }

        /// <summary>Error message of an <c>error</c> event.</summary>
        [JsonPropertyName("message")] public string? Message { get; init; }

        /// <summary>
        /// Parses a message string from a WebView channel. Handles plain JSON and JSON that was
        /// string-encoded a second time (as some WebView bridges do). Returns <c>null</c> for anything
        /// that is not a QRGen message.
        /// </summary>
        public static EmbedMessage? TryParse(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                var text = json!.Trim();
                if (text.StartsWith("\"", StringComparison.Ordinal)) text = JsonSerializer.Deserialize<string>(text) ?? string.Empty;
                var message = JsonSerializer.Deserialize<EmbedMessage>(text, QRGenJson.Options);
                return message is not null && message.Source == "qrgen" ? message : null;
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

    /// <summary>Builds JavaScript snippets for host-to-page commands (<c>window.qrgen.command(...)</c>).</summary>
    public static class EmbedCommands
    {
        /// <summary>Start scanning.</summary>
        public static string Start => Command("start");

        /// <summary>Stop scanning and release the camera.</summary>
        public static string Stop => Command("stop");

        /// <summary>Pause decoding (camera stays on).</summary>
        public static string Pause => Command("pause");

        /// <summary>Resume decoding.</summary>
        public static string Resume => Command("resume");

        /// <summary>Turn the flashlight on or off.</summary>
        public static string Torch(bool on) => Command("torch", on);

        /// <summary>Builds <c>window.qrgen &amp;&amp; window.qrgen.command({...})</c> for any command.</summary>
        public static string Command(string type, bool? value = null)
        {
            var payload = new Dictionary<string, object> { ["type"] = type };
            if (value is bool v) payload["value"] = v;
            var json = JsonSerializer.Serialize(payload);
            return "window.qrgen && window.qrgen.command(" + json + ");";
        }
    }
}
