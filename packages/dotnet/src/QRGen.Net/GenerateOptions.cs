// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

namespace QRGen
{
    /// <summary>Barcode generation options (SPEC section 7), shared by <see cref="QRGenClient"/> and <see cref="QRGenLocal"/>.</summary>
    public sealed class GenerateOptions
    {
        /// <summary>Symbology id or alias (default <c>qr</c>).</summary>
        public string Symbology { get; set; } = "qr";

        /// <summary><c>svg</c> or <c>png</c> (the REST API also accepts <c>jpeg</c>, <c>webp</c>...).</summary>
        public string Format { get; set; } = "svg";

        /// <summary>Pixels per module (default 4).</summary>
        public int Scale { get; set; } = 4;

        /// <summary>Error correction: <c>L</c>/<c>M</c>/<c>Q</c>/<c>H</c> for QR; <c>0</c>-<c>8</c> for PDF417; a percentage for Aztec. <c>null</c> uses the default.</summary>
        public string? EcLevel { get; set; }

        /// <summary>Encode GS1 element strings given in HRI form, for example <c>(01)09501101530003(10)ABC</c>.</summary>
        public bool Gs1 { get; set; }

        /// <summary>Add human readable text under linear barcodes.</summary>
        public bool Hrt { get; set; }

        /// <summary>Include the quiet zone (default <c>true</c>).</summary>
        public bool Margin { get; set; } = true;

        /// <summary>Bar color as <c>#rrggbb</c> or <c>#rrggbbaa</c> (default black).</summary>
        public string? Foreground { get; set; }

        /// <summary>Background color as <c>#rrggbb</c>, <c>#rrggbbaa</c> or <c>transparent</c> (default white).</summary>
        public string? Background { get; set; }
    }
}
