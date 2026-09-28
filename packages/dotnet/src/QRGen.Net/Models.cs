// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace QRGen
{
    /// <summary>A pixel coordinate in the source image or frame.</summary>
    /// <param name="X">Horizontal coordinate.</param>
    /// <param name="Y">Vertical coordinate.</param>
    public readonly record struct Point(
        [property: JsonPropertyName("x")] double X,
        [property: JsonPropertyName("y")] double Y);

    /// <summary>Width and height in pixels.</summary>
    /// <param name="Width">Width in pixels.</param>
    /// <param name="Height">Height in pixels.</param>
    public readonly record struct ImageSize(
        [property: JsonPropertyName("width")] int Width,
        [property: JsonPropertyName("height")] int Height);

    /// <summary>The four corners of a decoded symbol, clockwise from the top-left.</summary>
    /// <param name="TopLeft">Top-left corner.</param>
    /// <param name="TopRight">Top-right corner.</param>
    /// <param name="BottomRight">Bottom-right corner.</param>
    /// <param name="BottomLeft">Bottom-left corner.</param>
    public sealed record Quad(
        [property: JsonPropertyName("topLeft")] Point TopLeft,
        [property: JsonPropertyName("topRight")] Point TopRight,
        [property: JsonPropertyName("bottomRight")] Point BottomRight,
        [property: JsonPropertyName("bottomLeft")] Point BottomLeft)
    {
        /// <summary>A quad with every corner at the origin.</summary>
        public static Quad Empty { get; } = new Quad(default, default, default, default);

        /// <summary>The corners in drawing order.</summary>
        [JsonIgnore]
        public IReadOnlyList<Point> Points => new[] { TopLeft, TopRight, BottomRight, BottomLeft };

        /// <summary>Creates an axis-aligned quad.</summary>
        public static Quad FromRect(double x, double y, double width, double height) =>
            new Quad(new Point(x, y), new Point(x + width, y), new Point(x + width, y + height), new Point(x, y + height));
    }

    /// <summary>
    /// One decoded barcode (SPEC section 2). Serializes to the camelCase JSON shape shared by
    /// every QRGen platform (see <see cref="QRGenJson"/>).
    /// </summary>
    public record Barcode
    {
        /// <summary>Decoded text. GS1 content uses the HRI form <c>(01)...(10)...</c>.</summary>
        [JsonPropertyName("data")]
        public string Data { get; init; } = string.Empty;

        /// <summary>Symbology id from SPEC section 1, for example <c>qr</c>.</summary>
        [JsonPropertyName("symbology")]
        public string Symbology { get; init; } = string.Empty;

        /// <summary>Human readable symbology name, for example <c>QR Code</c>.</summary>
        [JsonPropertyName("symbologyName")]
        public string SymbologyName { get; init; } = string.Empty;

        /// <summary>Raw payload bytes (serialized as base64; may be empty).</summary>
        [JsonPropertyName("rawBytes")]
        public byte[] RawBytes { get; init; } = Array.Empty<byte>();

        /// <summary><c>text</c>, <c>binary</c>, <c>gs1</c>, <c>iso15434</c>, <c>mixed</c> or <c>unknown-eci</c>.</summary>
        [JsonPropertyName("contentType")]
        public string ContentType { get; init; } = "text";

        /// <summary><c>true</c> when the symbol carries GS1 element strings.</summary>
        [JsonPropertyName("isGS1")]
        public bool IsGS1 { get; init; }

        /// <summary>Corner points in source pixel coordinates.</summary>
        [JsonPropertyName("location")]
        public Quad Location { get; init; } = Quad.Empty;

        /// <summary>Size of the source image or frame.</summary>
        [JsonPropertyName("frameSize")]
        public ImageSize FrameSize { get; init; }

        /// <summary>Symbol orientation in degrees.</summary>
        [JsonPropertyName("orientation")]
        public int Orientation { get; init; }

        /// <summary>Error correction level when known, else an empty string.</summary>
        [JsonPropertyName("ecLevel")]
        public string EcLevel { get; init; } = string.Empty;

        /// <summary>AIM symbology identifier such as <c>]Q1</c>, when known.</summary>
        [JsonPropertyName("symbologyIdentifier")]
        public string SymbologyIdentifier { get; init; } = string.Empty;

        /// <summary>Milliseconds since the Unix epoch when the code was decoded.</summary>
        [JsonPropertyName("timestamp")]
        public long Timestamp { get; init; }

        /// <summary>Parsed content, filled in by the REST API (<c>POST /v1/scan</c>); <c>null</c> otherwise.</summary>
        [JsonPropertyName("parsed")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public ParsedContent? Parsed { get; init; }

        /// <summary>Runs <see cref="ContentParser.Parse(string?, string?, DateTime?)"/> on <see cref="Data"/>.</summary>
        public ParsedContent Parse() => Parsed ?? ContentParser.Parse(Data, Symbology);

        /// <summary>Current time in milliseconds since the Unix epoch.</summary>
        public static long NowMilliseconds() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    /// <summary>A barcode followed across frames in <c>batch</c> mode (SPEC section 4, <c>track</c> event).</summary>
    public sealed record TrackedBarcode : Barcode
    {
        /// <summary>Stable identifier derived from symbology and data.</summary>
        [JsonPropertyName("id")]
        public string Id { get; init; } = string.Empty;

        /// <summary>Milliseconds since the epoch when the code first appeared.</summary>
        [JsonPropertyName("firstSeen")]
        public long FirstSeen { get; init; }

        /// <summary>Milliseconds since the epoch of the latest frame containing the code.</summary>
        [JsonPropertyName("lastSeen")]
        public long LastSeen { get; init; }

        /// <summary>Number of frames the code was decoded in.</summary>
        [JsonPropertyName("count")]
        public int Count { get; init; }
    }
}
