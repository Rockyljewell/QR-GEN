using System;
using System.Linq;
using Xunit;

namespace QRGen.Tests
{
    public class Gs1ParserTests
    {
        private static readonly DateTime Today = new DateTime(2026, 1, 15);

        private static Gs1Element El(Gs1Result result, string ai) => result.Elements.Single(e => e.Ai == ai);

        [Fact]
        public void SpecVector()
        {
            var result = Gs1Parser.Parse(Vectors.Gs1, Today)!;
            Assert.Equal("09501101530003", result.Values["01"]);
            Assert.Equal("250101", result.Values["17"]);
            Assert.Equal("ABC123", result.Values["10"]);
            Assert.Equal(3, result.Values.Count);
            Assert.Equal("GTIN", El(result, "01").Title);
            Assert.Equal("USE BY or EXPIRY", El(result, "17").Title);
            Assert.Equal("BATCH/LOT", El(result, "10").Title);
            Assert.Equal("2025-01-01", El(result, "17").Date);
            Assert.Equal(new[] { "01", "17", "10" }, result.Elements.Select(e => e.Ai));
        }

        [Theory]
        [InlineData("]C1")]
        [InlineData("]d2")]
        [InlineData("]Q3")]
        [InlineData("]e0")]
        [InlineData("")]
        public void RawWithSeparatorsAndPrefix(string prefix)
        {
            var result = Gs1Parser.Parse(prefix + "0109501101530003" + "10ABC123\u001d" + "17250101", Today)!;
            Assert.Equal("09501101530003", result["01"]);
            Assert.Equal("ABC123", result["10"]);
            Assert.Equal("250101", result["17"]);
        }

        [Fact]
        public void FixedLengthAndDecimals()
        {
            var result = Gs1Parser.Parse("00123456789012345675" + "0109501101530003" + "11240229" + "3103000195", Today)!;
            Assert.Equal("123456789012345675", result["00"]);
            Assert.Equal("2024-02-29", El(result, "11").Date);
            Assert.Equal(0.195, El(result, "3103").Number!.Value, 10);
            Assert.Equal("NET WEIGHT (kg)", El(result, "3103").Title);
        }

        [Theory]
        [InlineData("(17)240200", "2024-02-29")]
        [InlineData("(15)250400", "2025-04-30")]
        [InlineData("(16)231200", "2023-12-31")]
        public void DayZeroIsLastDayOfMonth(string data, string iso) => Assert.Equal(iso, Gs1Parser.Parse(data, Today)!.Elements[0].Date);

        [Fact]
        public void CenturyWindow()
        {
            var today = new DateTime(2026, 6, 1);
            Assert.Equal("1999-01-01", Gs1Parser.Parse("(11)990101", today)!.Elements[0].Date);
            Assert.Equal("2076-01-01", Gs1Parser.Parse("(17)760101", today)!.Elements[0].Date);
            Assert.Equal("1977-01-01", Gs1Parser.Parse("(17)770101", today)!.Elements[0].Date);
            Assert.Null(Gs1Parser.Parse("(17)251332", today)!.Elements[0].Date);
        }

        [Theory]
        [InlineData("(3103)000195", 0.195)]
        [InlineData("(3100)000195", 195)]
        [InlineData("(3922)1299", 12.99)]
        [InlineData("(3932)97812345", 123.45)]
        [InlineData("(3202)001250", 12.5)]
        [InlineData("(3955)012345", 0.12345)]
        public void DecimalAis(string data, double expected) => Assert.Equal(expected, Gs1Parser.Parse(data)!.Elements[0].Number!.Value, 10);

        [Fact]
        public void DigitalLink()
        {
            var result = Gs1Parser.Parse("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101", Today)!;
            Assert.Equal("09501101530003", result["01"]);
            Assert.Equal("ABC123", result["10"]);
            Assert.Equal("2025-01-01", El(result, "17").Date);

            var custom = Gs1Parser.Parse("https://brand.example.com/p/01/9501101530003/21/SN%2F42?3103=000195&linkType=gs1:pip", Today)!;
            Assert.Equal("09501101530003", custom["01"]);
            Assert.Equal("9501101530003", El(custom, "01").Raw);
            Assert.Equal("SN/42", custom["21"]);
            Assert.False(custom.Values.ContainsKey("linkType"));
            Assert.True(Gs1Parser.IsDigitalLink("https://id.gs1.org/01/09501101530003"));
            Assert.False(Gs1Parser.IsDigitalLink("https://example.com/about/us"));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("hello")]
        [InlineData("(01)123")]
        [InlineData("(01)0950110153000A")]
        [InlineData("(555) 123-4567")]
        [InlineData("12345")]
        [InlineData("https://example.com/")]
        [InlineData("https://example.com/01/notdigits")]
        public void InvalidInputReturnsNull(string? data) => Assert.Null(Gs1Parser.Parse(data));

        [Fact]
        public void VariableLengthLimits()
        {
            Assert.NotNull(Gs1Parser.Parse("(10)" + new string('A', 20)));
            Assert.Null(Gs1Parser.Parse("(10)" + new string('A', 21)));
        }

        [Fact]
        public void AiTableCoverage()
        {
            var required = new[] { "00", "01", "02", "10", "11", "12", "13", "15", "16", "17", "20", "21", "22", "235", "240", "241", "242", "243",
                "250", "251", "253", "254", "255", "30", "37", "400", "401", "402", "403", "7003", "7004", "8003", "8004", "8005", "8006",
                "8007", "8008", "8012", "8013", "8017", "8018", "8020", "8200", "90" }
                .Concat(Enumerable.Range(0, 8).Select(n => "41" + n))
                .Concat(Enumerable.Range(0, 8).Select(n => "42" + n))
                .Concat(Enumerable.Range(1, 9).Select(n => "9" + n))
                .Concat(Enumerable.Range(0, 7).SelectMany(a => Enumerable.Range(0, 10).Select(n => $"31{a}{n}")))
                .Concat(Enumerable.Range(0, 6).SelectMany(a => Enumerable.Range(0, 10).Select(n => $"39{a}{n}")));
            Assert.All(required, ai => Assert.True(Gs1Parser.AiTable.ContainsKey(ai), ai));
            Assert.Equal(757, Gs1Parser.AiTable.Count);
            var keys = Gs1Parser.AiTable.Keys.ToList();
            Assert.DoesNotContain(keys, a => keys.Any(b => a != b && b.StartsWith(a, StringComparison.Ordinal)));
        }

        [Fact]
        public void HriAndElementStringRoundTrip()
        {
            var result = Gs1Parser.Parse(Vectors.Gs1)!;
            Assert.Equal(Vectors.Gs1, Gs1Parser.ToHri(result));
            Assert.Equal("01095011015300031725010110ABC123", Gs1Parser.ToElementString(result));
            Assert.Equal("10ABC\u001d21XYZ", Gs1Parser.ToElementString(Gs1Parser.Parse("(10)ABC(21)XYZ")!));
        }
    }
}
