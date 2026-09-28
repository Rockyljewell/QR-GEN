// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Xunit;

namespace QRGen.Tests
{
    public class LocalRoundTripTests
    {
        public static TheoryData<string, string, bool> Cases => new TheoryData<string, string, bool>
        {
            { "qr", "https://example.com/QRGen?x=1", false },
            { "data-matrix", "Data Matrix 123", false },
            { "aztec", "Aztec payload", false },
            { "pdf417", "PDF417 payload 0123456789", false },
            { "ean13", "9501101530003", false },
            { "ean8", "96385074", false },
            { "upca", "036000291452", false },
            { "upce", "01234565", false },
            { "code128", "QRGEN-128", false },
            { "code128", "(01)09501101530003(17)250101(10)ABC123", true },
            { "code39", "QRGEN39", false },
            { "code93", "CODE93", false },
            { "codabar", "A12345B", false },
            { "itf", "12345678", false },
            { "itf14", "15400141288763", false },
            { "qr", "(01)09501101530003(10)ABC", true },
        };

        [Theory]
        [MemberData(nameof(Cases))]
        public void GenerateThenDecode(string symbology, string data, bool gs1)
        {
            var image = QRGenLocal.GenerateImage(data, new GenerateOptions { Symbology = symbology, Scale = 3, Gs1 = gs1 });
            var found = QRGenLocal.Decode(image.Pixels, image.Width, image.Height, new[] { symbology });
            var code = Assert.Single(found);
            Assert.Equal(data, code.Data);
            Assert.Equal(symbology, code.Symbology);
            Assert.Equal(Symbologies.GetName(symbology), code.SymbologyName);
            Assert.Equal(gs1, code.IsGS1);
            if (gs1)
            {
                Assert.Equal("gs1", code.ContentType);
                Assert.Equal("gs1", code.Parse().Type);
            }
            Assert.Equal(new ImageSize(image.Width, image.Height), code.FrameSize);
            Assert.True(code.Timestamp > 1_700_000_000_000);
        }

        [Fact]
        public void QrMetadata()
        {
            var image = QRGenLocal.GenerateImage("metadata", new GenerateOptions { EcLevel = "H" });
            var code = QRGenLocal.Decode(image.Pixels, image.Width, image.Height).Single();
            Assert.Equal("H", code.EcLevel);
            Assert.Equal("]Q1", code.SymbologyIdentifier);
            Assert.Equal("metadata", System.Text.Encoding.UTF8.GetString(code.RawBytes));
            Assert.True(code.Location.BottomRight.X > code.Location.TopLeft.X);
        }

        [Fact]
        public void AllSymbologiesReportsUpcAndBooksLikeMlKit()
        {
            var upc = QRGenLocal.GenerateImage("036000291452", new GenerateOptions { Symbology = "upca" });
            Assert.Equal("upca", QRGenLocal.Decode(upc.Pixels, upc.Width, upc.Height).Single().Symbology);
            var book = QRGenLocal.GenerateImage("9780306406157", new GenerateOptions { Symbology = "isbn" });
            Assert.Equal("ean13", QRGenLocal.Decode(book.Pixels, book.Width, book.Height).Single().Symbology);
            Assert.Equal("isbn", QRGenLocal.Decode(book.Pixels, book.Width, book.Height, new[] { "isbn" }).Single().Symbology);
        }

        [Fact]
        public void FilterExcludesOtherSymbologies()
        {
            var image = QRGenLocal.GenerateImage("hello");
            Assert.Empty(QRGenLocal.Decode(image.Pixels, image.Width, image.Height, new[] { "retail" }));
            Assert.Empty(QRGenLocal.Decode(image.Pixels, image.Width, image.Height, new[] { "micro-qr" })); // not readable locally
        }

        [Fact]
        public void DecodesRgbaAndBgraPixels()
        {
            var image = QRGenLocal.GenerateImage("color", new GenerateOptions { Scale = 4 });
            var rgba = new byte[image.Pixels.Length * 4];
            for (var i = 0; i < image.Pixels.Length; i++)
            {
                rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = image.Pixels[i];
                rgba[i * 4 + 3] = 255;
            }
            Assert.Equal("color", QRGenLocal.Decode(rgba, image.Width, image.Height, PixelFormat.Rgba32).Single().Data);
            Assert.Equal("color", QRGenLocal.Decode(rgba, image.Width, image.Height, PixelFormat.Bgra32).Single().Data);
        }

        [Fact]
        public void SvgOutput()
        {
            var svg = QRGenLocal.Generate("hello svg");
            Assert.StartsWith("<?xml", svg);
            Assert.Contains("<svg", svg);
            Assert.Contains("fill=\"#000000\"", svg);
            var colored = QRGenLocal.Generate("x", new GenerateOptions { Foreground = "#ff0000", Background = "transparent" });
            Assert.Contains("fill=\"#FF0000\"", colored);
            Assert.Contains("fill-opacity=\"0\"", colored);
            var hrt = QRGenLocal.Generate("96385074", new GenerateOptions { Symbology = "ean8", Hrt = true });
            Assert.Contains("<text", hrt);
            Assert.Contains("96385074", hrt);
            Assert.Contains("generated by QRGen", QRGenLocal.Generate("x", "code128"));
        }

        [Fact]
        public void MarginAndScale()
        {
            var with = QRGenLocal.GenerateImage("m", new GenerateOptions { Scale = 2 });
            var without = QRGenLocal.GenerateImage("m", new GenerateOptions { Scale = 2, Margin = false });
            Assert.Equal(with.Width - 16, without.Width); // 4 modules each side * scale 2
            Assert.Equal(0, without.Pixels[0]); // finder pattern starts at the corner
            Assert.Equal(255, with.Pixels[0]);
        }

        [Fact]
        public void PngIsValidAndDecodes()
        {
            var png = QRGenLocal.GeneratePng("png round trip", new GenerateOptions { Scale = 3 });
            var (pixels, width, height, channels) = DecodePng(png);
            Assert.Equal(1, channels);
            Assert.Equal("png round trip", QRGenLocal.Decode(pixels, width, height).Single().Data);

            var colored = QRGenLocal.GeneratePng("rgba", new GenerateOptions { Foreground = "#002060", Background = "#ffffff80" });
            var decoded = DecodePng(colored);
            Assert.Equal(4, decoded.Channels);
            Assert.Equal("rgba", QRGenLocal.Decode(decoded.Pixels, decoded.Width, decoded.Height, PixelFormat.Rgba32).Single().Data);
        }

        [Theory]
        [InlineData("12345678901234", "ean13")]
        [InlineData("ABC", "ean8")]
        [InlineData("1234567", "isbn")]
        public void InvalidDataThrows(string data, string symbology) =>
            Assert.Throws<ArgumentException>(() => QRGenLocal.Generate(data, symbology));

        [Fact]
        public void UnsupportedSymbologiesAndOptions()
        {
            Assert.Throws<NotSupportedException>(() => QRGenLocal.Generate("123", "micro-qr"));
            Assert.Throws<NotSupportedException>(() => QRGenLocal.Generate("(01)09501101530003", new GenerateOptions { Symbology = "data-matrix", Gs1 = true }));
            Assert.Throws<ArgumentException>(() => QRGenLocal.Generate("x", "nope"));
            Assert.Throws<ArgumentException>(() => QRGenLocal.Generate("", "qr"));
            Assert.Throws<ArgumentException>(() => QRGenLocal.Generate("x", new GenerateOptions { Foreground = "red-ish" }));
            Assert.Throws<ArgumentException>(() => QRGenLocal.Generate("x", new GenerateOptions { EcLevel = "Z" }));
            Assert.Contains("qr", QRGenLocal.WritableSymbologies);
            Assert.DoesNotContain("maxicode", QRGenLocal.WritableSymbologies);
            Assert.Contains("maxicode", QRGenLocal.ReadableSymbologies);
        }

        /// <summary>Tiny PNG reader (filter type 0 only) used to verify <see cref="PngEncoder"/>.</summary>
        private static (byte[] Pixels, int Width, int Height, int Channels) DecodePng(byte[] png)
        {
            Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png.Take(8).ToArray());
            int width = 0, height = 0, channels = 0;
            var idat = new MemoryStream();
            var pos = 8;
            while (pos < png.Length)
            {
                var length = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
                var type = System.Text.Encoding.ASCII.GetString(png, pos + 4, 4);
                if (type == "IHDR")
                {
                    width = (png[pos + 8] << 24) | (png[pos + 9] << 16) | (png[pos + 10] << 8) | png[pos + 11];
                    height = (png[pos + 12] << 24) | (png[pos + 13] << 16) | (png[pos + 14] << 8) | png[pos + 15];
                    channels = png[pos + 17] == 6 ? 4 : 1;
                }
                if (type == "IDAT") idat.Write(png, pos + 8, length);
                pos += 12 + length;
            }
            var zlib = idat.ToArray();
            using var inflate = new DeflateStream(new MemoryStream(zlib, 2, zlib.Length - 6), CompressionMode.Decompress);
            var raw = new MemoryStream();
            inflate.CopyTo(raw);
            var data = raw.ToArray();
            var stride = width * channels;
            var pixels = new byte[stride * height];
            for (var y = 0; y < height; y++)
            {
                Assert.Equal(0, data[y * (stride + 1)]);
                Buffer.BlockCopy(data, y * (stride + 1) + 1, pixels, y * stride, stride);
            }
            return (pixels, width, height, channels);
        }
    }
}
