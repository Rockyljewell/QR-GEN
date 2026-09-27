using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using ZXing;
using ZXing.Common;
using ZXing.QrCode.Internal;

namespace QRGen
{
    /// <summary>Pixel layouts accepted by <see cref="QRGenLocal.Decode(byte[], int, int, PixelFormat, IEnumerable{string}?, bool)"/>.</summary>
    public enum PixelFormat
    {
        /// <summary>8-bit luminance, one byte per pixel.</summary>
        Gray8,
        /// <summary>24-bit RGB.</summary>
        Rgb24,
        /// <summary>24-bit BGR.</summary>
        Bgr24,
        /// <summary>32-bit RGBA.</summary>
        Rgba32,
        /// <summary>32-bit BGRA (Windows bitmaps, most camera APIs).</summary>
        Bgra32,
        /// <summary>32-bit ARGB.</summary>
        Argb32,
    }

    /// <summary>An 8-bit grayscale raster produced by <see cref="QRGenLocal.GenerateImage(string, GenerateOptions?)"/> (0 = black, 255 = white).</summary>
    public sealed class BarcodeImage
    {
        internal BarcodeImage(byte[] pixels, int width, int height, bool[,] modules, int scale)
        {
            Pixels = pixels;
            Width = width;
            Height = height;
            Modules = modules;
            Scale = scale;
        }

        /// <summary>Row-major grayscale pixels.</summary>
        public byte[] Pixels { get; }

        /// <summary>Width in pixels.</summary>
        public int Width { get; }

        /// <summary>Height in pixels.</summary>
        public int Height { get; }

        /// <summary>Pixels per module.</summary>
        public int Scale { get; }

        /// <summary>The module grid including the quiet zone, <c>[row, column]</c>, <c>true</c> = dark.</summary>
        public bool[,] Modules { get; }
    }

    /// <summary>
    /// Local (offline) barcode generation and decoding with ZXing.Net. For the full symbology set
    /// (Micro QR, rMQR, MicroPDF417, DataBar Limited, Telepen...) use <see cref="QRGenClient"/> with a
    /// QRGen REST server.
    /// </summary>
    public static class QRGenLocal
    {
        private static readonly Dictionary<string, BarcodeFormat> ReadFormats = new Dictionary<string, BarcodeFormat>
        {
            ["qr"] = BarcodeFormat.QR_CODE,
            ["data-matrix"] = BarcodeFormat.DATA_MATRIX,
            ["aztec"] = BarcodeFormat.AZTEC,
            ["pdf417"] = BarcodeFormat.PDF_417,
            ["maxicode"] = BarcodeFormat.MAXICODE,
            ["ean13"] = BarcodeFormat.EAN_13,
            ["ean8"] = BarcodeFormat.EAN_8,
            ["upca"] = BarcodeFormat.UPC_A,
            ["upce"] = BarcodeFormat.UPC_E,
            ["isbn"] = BarcodeFormat.EAN_13,
            ["code128"] = BarcodeFormat.CODE_128,
            ["code39"] = BarcodeFormat.CODE_39,
            ["code93"] = BarcodeFormat.CODE_93,
            ["codabar"] = BarcodeFormat.CODABAR,
            ["itf"] = BarcodeFormat.ITF,
            ["itf14"] = BarcodeFormat.ITF,
            ["databar"] = BarcodeFormat.RSS_14,
            ["databar-expanded"] = BarcodeFormat.RSS_EXPANDED,
        };

        private static readonly Dictionary<string, BarcodeFormat> WriteFormats = new Dictionary<string, BarcodeFormat>
        {
            ["qr"] = BarcodeFormat.QR_CODE,
            ["data-matrix"] = BarcodeFormat.DATA_MATRIX,
            ["aztec"] = BarcodeFormat.AZTEC,
            ["pdf417"] = BarcodeFormat.PDF_417,
            ["ean13"] = BarcodeFormat.EAN_13,
            ["ean8"] = BarcodeFormat.EAN_8,
            ["upca"] = BarcodeFormat.UPC_A,
            ["upce"] = BarcodeFormat.UPC_E,
            ["isbn"] = BarcodeFormat.EAN_13,
            ["code128"] = BarcodeFormat.CODE_128,
            ["code39"] = BarcodeFormat.CODE_39,
            ["code93"] = BarcodeFormat.CODE_93,
            ["codabar"] = BarcodeFormat.CODABAR,
            ["itf"] = BarcodeFormat.ITF,
            ["itf14"] = BarcodeFormat.ITF,
        };

        private static readonly Dictionary<BarcodeFormat, string> FormatIds = new Dictionary<BarcodeFormat, string>
        {
            [BarcodeFormat.QR_CODE] = "qr",
            [BarcodeFormat.DATA_MATRIX] = "data-matrix",
            [BarcodeFormat.AZTEC] = "aztec",
            [BarcodeFormat.PDF_417] = "pdf417",
            [BarcodeFormat.MAXICODE] = "maxicode",
            [BarcodeFormat.EAN_13] = "ean13",
            [BarcodeFormat.EAN_8] = "ean8",
            [BarcodeFormat.UPC_A] = "upca",
            [BarcodeFormat.UPC_E] = "upce",
            [BarcodeFormat.CODE_128] = "code128",
            [BarcodeFormat.CODE_39] = "code39",
            [BarcodeFormat.CODE_93] = "code93",
            [BarcodeFormat.CODABAR] = "codabar",
            [BarcodeFormat.ITF] = "itf",
            [BarcodeFormat.RSS_14] = "databar",
            [BarcodeFormat.RSS_EXPANDED] = "databar-expanded",
        };

        private static readonly HashSet<string> Gs1Identifiers = new HashSet<string> { "]C1", "]e0", "]d2", "]Q3", "]J1" };

        /// <summary>Ids that <see cref="Decode(byte[], int, int, IEnumerable{string}?, bool)"/> can read, in SPEC order.</summary>
        public static IReadOnlyList<string> ReadableSymbologies { get; } = Symbologies.Ids.Where(ReadFormats.ContainsKey).ToArray();

        /// <summary>Ids that <see cref="Generate(string, GenerateOptions?)"/> can write, in SPEC order.</summary>
        public static IReadOnlyList<string> WritableSymbologies { get; } = Symbologies.Ids.Where(WriteFormats.ContainsKey).ToArray();

        // ------------------------------------------------------------------ generate

        /// <summary>Generates an SVG document.</summary>
        /// <param name="data">Text to encode (HRI form such as <c>(01)...(10)...</c> when <see cref="GenerateOptions.Gs1"/> is set).</param>
        /// <param name="options">Symbology, scale, colors...; <see cref="GenerateOptions.Format"/> is ignored.</param>
        /// <exception cref="ArgumentException">The data or options are invalid for the symbology.</exception>
        /// <exception cref="NotSupportedException">The symbology cannot be generated locally.</exception>
        public static string Generate(string data, GenerateOptions? options = null)
        {
            options ??= new GenerateOptions();
            var (modules, linear, id) = BuildModules(data, options);
            return RenderSvg(modules, linear, id, data, options);
        }

        /// <summary>Generates an SVG document for <paramref name="symbology"/> with default options.</summary>
        public static string Generate(string data, string symbology) => Generate(data, new GenerateOptions { Symbology = symbology });

        /// <summary>Generates a PNG image (human readable text is not rendered in PNG output).</summary>
        public static byte[] GeneratePng(string data, GenerateOptions? options = null)
        {
            options ??= new GenerateOptions();
            var image = GenerateImage(data, options);
            var fg = ParseColor(options.Foreground, (0, 0, 0, 255));
            var bg = ParseColor(options.Background, (255, 255, 255, 255));
            if (fg == (0, 0, 0, 255) && bg == (255, 255, 255, 255)) return PngEncoder.EncodeGray(image.Pixels, image.Width, image.Height);
            var rgba = new byte[image.Pixels.Length * 4];
            for (var i = 0; i < image.Pixels.Length; i++)
            {
                var c = image.Pixels[i] == 0 ? fg : bg;
                rgba[i * 4] = c.R;
                rgba[i * 4 + 1] = c.G;
                rgba[i * 4 + 2] = c.B;
                rgba[i * 4 + 3] = c.A;
            }
            return PngEncoder.EncodeRgba(rgba, image.Width, image.Height);
        }

        /// <summary>Generates an 8-bit grayscale raster (useful for custom rendering or printing).</summary>
        public static BarcodeImage GenerateImage(string data, GenerateOptions? options = null)
        {
            options ??= new GenerateOptions();
            var (modules, _, _) = BuildModules(data, options);
            var scale = Math.Max(1, options.Scale);
            var rows = modules.GetLength(0);
            var cols = modules.GetLength(1);
            var width = cols * scale;
            var height = rows * scale;
            var pixels = new byte[width * height];
            for (var y = 0; y < height; y++)
            {
                var row = y / scale;
                for (var x = 0; x < width; x++) pixels[y * width + x] = modules[row, x / scale] ? (byte)0 : (byte)255;
            }
            return new BarcodeImage(pixels, width, height, modules, scale);
        }

        private static (bool[,] Modules, bool Linear, string Id) BuildModules(string data, GenerateOptions options)
        {
            if (string.IsNullOrEmpty(data)) throw new ArgumentException("Data must not be empty.", nameof(data));
            var id = Symbologies.Get(options.Symbology).Id;
            if (!WriteFormats.TryGetValue(id, out var format))
                throw new NotSupportedException($"'{id}' cannot be generated locally; use QRGenClient.GenerateAsync with a QRGen REST server.");
            if (options.Scale < 1 || options.Scale > 100) throw new ArgumentException("Scale must be between 1 and 100.", nameof(options));

            var hints = new Dictionary<EncodeHintType, object> { [EncodeHintType.MARGIN] = 0 };
            var contents = data;
            var linear = Symbology.All.First(s => s.Id == id).IsLinear;
            // Only declare UTF-8 (which adds an ECI segment) when the text is not plain ASCII.
            if (!linear && data.Any(c => c > 0x7E)) hints[EncodeHintType.CHARACTER_SET] = "UTF-8";

            if (options.Gs1)
            {
                var gs1 = Gs1Parser.Parse(data) ?? throw new ArgumentException("Data is not valid GS1 element strings.", nameof(data));
                if (id == "code128") contents = "\u00f1" + Gs1Parser.ToElementString(gs1, '\u00f1');
                else if (id == "qr")
                {
                    contents = Gs1Parser.ToElementString(gs1);
                    hints[EncodeHintType.GS1_FORMAT] = true;
                }
                else
                {
                    // ZXing.Net 0.16's GS1 Data Matrix encoder pads symbols incorrectly, so it is not used.
                    throw new NotSupportedException(
                        $"GS1 mode is supported locally for code128 and qr, not '{id}'; use QRGenClient.GenerateAsync with a QRGen REST server.");
                }
            }
            if (id == "itf14")
            {
                if (contents.Length == 13 && contents.All(Ascii.IsDigit)) contents += CheckDigit(contents);
                if (contents.Length != 14 || !contents.All(Ascii.IsDigit)) throw new ArgumentException("ITF-14 needs 13 or 14 digits.", nameof(data));
            }
            if (id == "isbn" && !(contents.StartsWith("978", StringComparison.Ordinal) || contents.StartsWith("979", StringComparison.Ordinal)))
                throw new ArgumentException("ISBN barcodes start with 978 or 979.", nameof(data));

            if (!string.IsNullOrEmpty(options.EcLevel))
            {
                var level = options.EcLevel!.Trim().TrimEnd('%');
                switch (id)
                {
                    case "qr":
                        hints[EncodeHintType.ERROR_CORRECTION] = level.ToUpperInvariant() switch
                        {
                            "L" => ErrorCorrectionLevel.L,
                            "M" => ErrorCorrectionLevel.M,
                            "Q" => ErrorCorrectionLevel.Q,
                            "H" => ErrorCorrectionLevel.H,
                            _ => throw new ArgumentException("QR ecLevel must be L, M, Q or H.", nameof(options)),
                        };
                        break;
                    case "pdf417":
                    case "aztec":
                        if (!int.TryParse(level, NumberStyles.Integer, CultureInfo.InvariantCulture, out var numeric))
                            throw new ArgumentException("ecLevel must be a number for PDF417 (0-8) and Aztec (percent).", nameof(options));
                        hints[EncodeHintType.ERROR_CORRECTION] = numeric;
                        break;
                }
            }

            BitMatrix matrix;
            try
            {
                matrix = new MultiFormatWriter().encode(contents, format, 0, 0, hints);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is WriterException || ex is System.FormatException || ex is InvalidOperationException || ex is IndexOutOfRangeException)
            {
                throw new ArgumentException($"Cannot encode '{data}' as {Symbologies.GetName(id)}: {ex.Message}", nameof(data), ex);
            }

            var rect = matrix.getEnclosingRectangle() ?? new[] { 0, 0, matrix.Width, matrix.Height };
            int left = rect[0], top = rect[1], w = rect[2], h = rect[3];
            var quiet = options.Margin ? QuietZone(id) : 0;
            var quietY = linear ? (options.Margin ? 2 : 0) : quiet;
            var barHeight = linear ? 50 : 1;
            var rows = (linear ? barHeight : h) + 2 * quietY;
            var cols = w + 2 * quiet;
            var modules = new bool[rows, cols];
            for (var y = 0; y < (linear ? barHeight : h); y++)
            {
                var sourceY = linear ? top : top + y;
                for (var x = 0; x < w; x++) modules[y + quietY, x + quiet] = matrix[left + x, sourceY];
            }
            return (modules, linear, id);
        }

        private static int QuietZone(string id)
        {
            switch (id)
            {
                case "qr": return 4;
                case "data-matrix": return 1;
                case "aztec": return 1;
                case "pdf417": return 2;
                default: return 10;
            }
        }

        private static char CheckDigit(string digits)
        {
            var total = 0;
            for (int i = digits.Length - 1, weight = 3; i >= 0; i--, weight = weight == 3 ? 1 : 3) total += (digits[i] - '0') * weight;
            return (char)('0' + (10 - total % 10) % 10);
        }

        private static string RenderSvg(bool[,] modules, bool linear, string id, string data, GenerateOptions options)
        {
            var scale = Math.Max(1, options.Scale);
            var rows = modules.GetLength(0);
            var cols = modules.GetLength(1);
            var width = cols * scale;
            var textHeight = linear && options.Hrt ? 12 * scale / 2 + 4 * scale : 0;
            var height = rows * scale + textHeight;
            var fg = ParseColor(options.Foreground, (0, 0, 0, 255));
            var bg = ParseColor(options.Background, (255, 255, 255, 255));

            var path = new StringBuilder();
            var y = 0;
            while (y < rows)
            {
                // Merge identical consecutive rows into one band (linear codes become one rect per bar).
                var bandEnd = y + 1;
                while (bandEnd < rows && RowsEqual(modules, y, bandEnd, cols)) bandEnd++;
                var x = 0;
                while (x < cols)
                {
                    if (!modules[y, x])
                    {
                        x++;
                        continue;
                    }
                    var start = x;
                    while (x < cols && modules[y, x]) x++;
                    path.Append('M').Append(start * scale).Append(' ').Append(y * scale)
                        .Append('h').Append((x - start) * scale).Append('v').Append((bandEnd - y) * scale)
                        .Append('h').Append(-(x - start) * scale).Append('Z');
                }
                y = bandEnd;
            }

            var svg = new StringBuilder();
            svg.Append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            svg.Append("<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"").Append(width)
                .Append("\" height=\"").Append(height).Append("\" viewBox=\"0 0 ").Append(width).Append(' ').Append(height)
                .Append("\" shape-rendering=\"crispEdges\">\n");
            svg.Append(" <desc>").Append(Escape(Symbologies.GetName(id))).Append(" generated by QRGen</desc>\n");
            svg.Append(" <rect width=\"100%\" height=\"100%\" ").Append(Paint(bg)).Append("/>\n");
            svg.Append(" <path ").Append(Paint(fg)).Append(" d=\"").Append(path).Append("\"/>\n");
            if (textHeight > 0)
            {
                svg.Append(" <text x=\"").Append(width / 2).Append("\" y=\"").Append(height - 2 * scale)
                    .Append("\" text-anchor=\"middle\" font-family=\"OCRB, monospace\" font-size=\"").Append(6 * scale).Append("\" ")
                    .Append(Paint(fg)).Append('>').Append(Escape(data)).Append("</text>\n");
            }
            svg.Append("</svg>\n");
            return svg.ToString();
        }

        private static bool RowsEqual(bool[,] modules, int a, int b, int cols)
        {
            for (var x = 0; x < cols; x++)
            {
                if (modules[a, x] != modules[b, x]) return false;
            }
            return true;
        }

        private static string Escape(string text) =>
            text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;")
                .Replace("\u001d", " ").Replace("\u00f1", " ");

        private static string Paint((byte R, byte G, byte B, byte A) color)
        {
            var fill = string.Format(CultureInfo.InvariantCulture, "fill=\"#{0:X2}{1:X2}{2:X2}\"", color.R, color.G, color.B);
            if (color.A < 255) fill += string.Format(CultureInfo.InvariantCulture, " fill-opacity=\"{0:0.###}\"", color.A / 255.0);
            return fill;
        }

        internal static (byte R, byte G, byte B, byte A) ParseColor(string? value, (byte, byte, byte, byte) fallback)
        {
            if (string.IsNullOrWhiteSpace(value)) return fallback;
            var text = value!.Trim().ToLowerInvariant();
            if (text == "transparent") return (255, 255, 255, 0);
            if (text.StartsWith("#", StringComparison.Ordinal)) text = text.Substring(1);
            if (text.Length == 3 || text.Length == 4) text = string.Concat(text.Select(c => new string(c, 2)));
            if (text.Length == 6) text += "ff";
            if (text.Length != 8 || !text.All(Uri.IsHexDigit))
                throw new ArgumentException($"Invalid color '{value}'; use #rgb, #rrggbb or #rrggbbaa.", nameof(value));
            byte Part(int index) => byte.Parse(text.Substring(index, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            return (Part(0), Part(2), Part(4), Part(6));
        }

        // ------------------------------------------------------------------ decode

        /// <summary>Decodes barcodes from 8-bit luminance (grayscale) pixels.</summary>
        /// <param name="luminance">Row-major grayscale pixels, one byte per pixel.</param>
        /// <param name="width">Image width in pixels.</param>
        /// <param name="height">Image height in pixels.</param>
        /// <param name="symbologies">Ids, aliases or groups (default: all). Ids ZXing.Net cannot read are skipped.</param>
        /// <param name="tryHarder">Spend more time searching (rotation, inversion).</param>
        public static IReadOnlyList<Barcode> Decode(byte[] luminance, int width, int height, IEnumerable<string>? symbologies = null, bool tryHarder = true) =>
            Decode(luminance, width, height, PixelFormat.Gray8, symbologies, tryHarder);

        /// <summary>Decodes barcodes from raw pixels in the given layout.</summary>
        public static IReadOnlyList<Barcode> Decode(byte[] pixels, int width, int height, PixelFormat format, IEnumerable<string>? symbologies = null, bool tryHarder = true)
        {
            if (pixels is null) throw new ArgumentNullException(nameof(pixels));
            if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException(nameof(width));
            var requested = Symbologies.Resolve(symbologies);
            var formats = requested.Where(ReadFormats.ContainsKey).Select(id => ReadFormats[id]).Distinct().ToList();
            if (formats.Count == 0) return Array.Empty<Barcode>();

            var reader = new BarcodeReaderGeneric
            {
                AutoRotate = tryHarder,
                Options = new DecodingOptions
                {
                    TryHarder = tryHarder,
                    TryInverted = tryHarder,
                    PossibleFormats = formats,
                    ReturnCodabarStartEnd = true, // match the other QRGen platforms ("A12345B")
                },
            };
            var source = new RGBLuminanceSource(pixels, width, height, ToBitmapFormat(format));
            var results = reader.DecodeMultiple(source);
            if (results is null || results.Length == 0)
            {
                var single = reader.Decode(source);
                results = single is null ? Array.Empty<Result>() : new[] { single };
            }

            var timestamp = Barcode.NowMilliseconds();
            var barcodes = new List<Barcode>();
            var seen = new HashSet<string>();
            foreach (var result in results)
            {
                var barcode = ToBarcode(result, requested, width, height, timestamp);
                if (barcode is null || !seen.Add(barcode.Symbology + "\0" + barcode.Data)) continue;
                barcodes.Add(barcode);
            }
            return barcodes;
        }

        private static RGBLuminanceSource.BitmapFormat ToBitmapFormat(PixelFormat format)
        {
            switch (format)
            {
                case PixelFormat.Gray8: return RGBLuminanceSource.BitmapFormat.Gray8;
                case PixelFormat.Rgb24: return RGBLuminanceSource.BitmapFormat.RGB24;
                case PixelFormat.Bgr24: return RGBLuminanceSource.BitmapFormat.BGR24;
                case PixelFormat.Rgba32: return RGBLuminanceSource.BitmapFormat.RGBA32;
                case PixelFormat.Bgra32: return RGBLuminanceSource.BitmapFormat.BGRA32;
                case PixelFormat.Argb32: return RGBLuminanceSource.BitmapFormat.ARGB32;
                default: throw new ArgumentOutOfRangeException(nameof(format));
            }
        }

        internal static string? RefineId(string id, string text, IReadOnlyCollection<string> requested)
        {
            var wanted = new HashSet<string>(requested);
            if (id == "ean13")
            {
                if (text.StartsWith("0", StringComparison.Ordinal) && wanted.Contains("upca")) id = "upca";
                else if ((text.StartsWith("978", StringComparison.Ordinal) || text.StartsWith("979", StringComparison.Ordinal)) &&
                         wanted.Contains("isbn") && !wanted.Contains("ean13")) id = "isbn";
            }
            else if (id == "upca" && !wanted.Contains("upca") && wanted.Contains("ean13"))
            {
                id = "ean13";
            }
            else if (id == "itf" && wanted.Contains("itf14") && text.Length == 14 && text.All(Ascii.IsDigit) &&
                     (!wanted.Contains("itf") || ContentParser.GtinChecksumValid(text)))
            {
                id = "itf14";
            }
            return wanted.Contains(id) ? id : null;
        }

        private static Barcode? ToBarcode(Result result, IReadOnlyList<string> requested, int width, int height, long timestamp)
        {
            if (!FormatIds.TryGetValue(result.BarcodeFormat, out var baseId)) return null;
            var text = result.Text ?? string.Empty;
            var id = RefineId(baseId, text, requested);
            if (id is null) return null;

            var metadata = result.ResultMetadata;
            string Meta(ResultMetadataType key) =>
                metadata is not null && metadata.TryGetValue(key, out var value) && value is not null ? Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty : string.Empty;

            var identifier = Meta(ResultMetadataType.SYMBOLOGY_IDENTIFIER);
            var isGs1 = Gs1Identifiers.Contains(identifier) || baseId == "databar" || baseId == "databar-expanded";
            var original = text;
            if (id == "upca" && text.Length == 13 && text[0] == '0') text = text.Substring(1);
            if (isGs1)
            {
                if (baseId == "databar" && text.Length == 14 && text.All(Ascii.IsDigit)) text = "(01)" + text;
                else if (!text.StartsWith("(", StringComparison.Ordinal))
                {
                    var parsed = Gs1Parser.Parse(text);
                    if (parsed is not null) text = Gs1Parser.ToHri(parsed);
                }
                if (identifier.Length == 0 && baseId.StartsWith("databar", StringComparison.Ordinal)) identifier = "]e0";
            }

            byte[] raw;
            if (metadata is not null && metadata.TryGetValue(ResultMetadataType.BYTE_SEGMENTS, out var segments) && segments is IEnumerable<byte[]> list)
                raw = list.SelectMany(b => b).ToArray();
            else
                raw = Encoding.UTF8.GetBytes(original);

            var orientation = 0;
            if (metadata is not null && metadata.TryGetValue(ResultMetadataType.ORIENTATION, out var o) && o is int degrees) orientation = degrees;

            var points = (result.ResultPoints ?? Array.Empty<ResultPoint>()).Where(p => p is not null).ToList();
            var location = Quad.Empty;
            if (points.Count > 0)
            {
                double minX = points.Min(p => p.X), maxX = points.Max(p => p.X);
                double minY = points.Min(p => p.Y), maxY = points.Max(p => p.Y);
                location = Quad.FromRect(Clamp(minX, width), Clamp(minY, height), Clamp(maxX, width) - Clamp(minX, width), Clamp(maxY, height) - Clamp(minY, height));
            }

            return new Barcode
            {
                Data = text,
                Symbology = id,
                SymbologyName = Symbologies.GetName(id),
                RawBytes = raw,
                ContentType = isGs1 ? "gs1" : "text",
                IsGS1 = isGs1,
                Location = location,
                FrameSize = new ImageSize(width, height),
                Orientation = orientation,
                EcLevel = Meta(ResultMetadataType.ERROR_CORRECTION_LEVEL),
                SymbologyIdentifier = identifier,
                Timestamp = timestamp,
            };
        }

        private static double Clamp(double value, int max) => Math.Round(Math.Min(Math.Max(value, 0), max), 1);
    }
}
