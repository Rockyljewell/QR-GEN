// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Linq;
using Xunit;

namespace QRGen.Tests
{
    public class SymbologyTests
    {
        private static readonly string[] SpecIds =
        {
            "qr", "micro-qr", "rmqr", "data-matrix", "aztec", "pdf417", "micro-pdf417", "maxicode", "ean13", "ean8",
            "upca", "upce", "isbn", "code128", "code39", "code93", "codabar", "itf", "itf14", "databar",
            "databar-expanded", "databar-limited", "code32", "pzn", "telepen", "dx-film-edge",
        };

        [Fact]
        public void IdsMatchSpecOrder() => Assert.Equal(SpecIds, Symbologies.Ids);

        [Theory]
        [InlineData("QRCode")]
        [InlineData("qr-code")]
        [InlineData("QR")]
        [InlineData("qr")]
        [InlineData("QR Code")]
        public void QrAliases(string name) => Assert.Equal("qr", Symbologies.Get(name).Id);

        [Theory]
        [InlineData("microqrcode", "micro-qr")]
        [InlineData("DataMatrix", "data-matrix")]
        [InlineData("DM", "data-matrix")]
        [InlineData("AztecCode", "aztec")]
        [InlineData("CompactPDF417", "pdf417")]
        [InlineData("EAN", "ean13")]
        [InlineData("JAN", "ean13")]
        [InlineData("GTIN-13", "ean13")]
        [InlineData("gtin8", "ean8")]
        [InlineData("UPC", "upca")]
        [InlineData("ISBN13", "isbn")]
        [InlineData("GS1-128", "code128")]
        [InlineData("EAN128", "code128")]
        [InlineData("Code 3 of 9", "code39")]
        [InlineData("NW7", "codabar")]
        [InlineData("Interleaved 2 of 5", "itf")]
        [InlineData("I2of5", "itf")]
        [InlineData("RSS14", "databar")]
        [InlineData("DataBarOmni", "databar")]
        [InlineData("RSS Expanded", "databar-expanded")]
        [InlineData("RSSLimited", "databar-limited")]
        [InlineData("DX-Film-Edge", "dx-film-edge")]
        public void Aliases(string alias, string expected) => Assert.Equal(expected, Symbologies.Get(alias).Id);

        [Fact]
        public void ResolveIdsAndGroups()
        {
            Assert.Equal(
                new[] { "qr", "ean13", "ean8", "upca", "upce", "isbn", "databar", "databar-expanded", "databar-limited" },
                Symbologies.Resolve(new[] { "QRCode", "retail" }));
            Assert.Equal(new[] { "qr", "ean13" }, Symbologies.Resolve("ean13, qr,QR"));
        }

        [Fact]
        public void EmptyMeansAll()
        {
            Assert.Equal(SpecIds, Symbologies.Resolve((string[]?)null));
            Assert.Equal(SpecIds, Symbologies.Resolve(Array.Empty<string>()));
            Assert.Equal(SpecIds, Symbologies.Resolve(new[] { "ALL" }));
        }

        [Fact]
        public void GroupsMatchSpec()
        {
            var linear = "ean13 ean8 upca upce isbn code128 code39 code93 codabar itf itf14 databar databar-expanded databar-limited code32 pzn telepen dx-film-edge".Split(' ');
            var matrix = "qr micro-qr rmqr data-matrix aztec pdf417 micro-pdf417 maxicode".Split(' ');
            Assert.Equal(linear, Symbologies.Resolve(new[] { "linear" }));
            Assert.Equal(linear, Symbologies.Resolve(new[] { "1D" }));
            Assert.Equal(matrix, Symbologies.Resolve(new[] { "2d" }));
            Assert.Equal(new[] { "data-matrix", "code128", "code39", "code93", "codabar", "itf", "itf14" }, Symbologies.Resolve(new[] { "industrial" }));
            Assert.Equal(
                new[] { "code128", "data-matrix", "qr", "databar", "databar-expanded", "databar-limited" }.OrderBy(x => x),
                Symbologies.Resolve(new[] { "gs1" }).OrderBy(x => x));
            Assert.All(Symbology.All, s => Assert.Equal(s.IsLinear, linear.Contains(s.Id)));
        }

        [Fact]
        public void UnknownNames()
        {
            Assert.Throws<ArgumentException>(() => Symbologies.Resolve(new[] { "qr", "nope" }));
            Assert.Equal(new[] { "qr" }, Symbologies.Resolve(new[] { "qr", "nope" }, ignoreUnknown: true));
            Assert.False(Symbologies.TryGet("retail", out _));
            Assert.Throws<ArgumentException>(() => Symbologies.Get("nope"));
        }

        [Fact]
        public void NamesAndConversions()
        {
            Assert.Equal("QR Code", Symbologies.GetName("qr"));
            Assert.Equal("Interleaved 2 of 5", Symbology.Itf.Name);
            string id = Symbology.DataMatrix;
            Assert.Equal("data-matrix", id);
            Assert.Equal("datamatrix", Symbologies.Normalize("Data-Matrix!"));
            Assert.Equal(26, Symbology.All.Count);
        }
    }
}
