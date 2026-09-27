using System;
using Xunit;

namespace QRGen.Tests
{
    public class AamvaParserTests
    {
        private static string Card(string body, string iin = "636012", string version = "09", string kind = "DL") =>
            $"@\n\u001e\rANSI {iin}{version}0001{kind}00310000{kind}{body}\r";

        [Fact]
        public void SpecVector()
        {
            var r = AamvaParser.Parse(Vectors.Aamva, new DateTime(2026, 1, 15))!;
            Assert.Equal("JANE", r.FirstName);
            Assert.Equal("SAMPLE", r.LastName);
            Assert.Equal("Q", r.MiddleName);
            Assert.Equal("JANE Q SAMPLE", r.FullName);
            Assert.Equal("1990-01-31", r.DateOfBirth);
            Assert.Equal("2028-01-31", r.ExpiryDate);
            Assert.Equal("2020-02-01", r.IssueDate);
            Assert.Equal("F", r.Sex);
            Assert.Equal("95814", r.PostalCode);
            Assert.Equal("CA", r.State);
            Assert.Equal("SACRAMENTO", r.City);
            Assert.Equal("123 MAIN ST", r.Street);
            Assert.Equal("USA", r.Country);
            Assert.Equal("D1234567", r.DocumentNumber);
            Assert.Equal("DL", r.DocumentType);
            Assert.Equal("636014", r.IssuerId);
            Assert.Equal(10, r.AamvaVersion);
            Assert.Equal(0, r.JurisdictionVersion);
            Assert.Equal("BRO", r.EyeColor);
            Assert.Equal("065 IN", r.Height);
            Assert.Equal(35, r.Age);
            Assert.False(r.IsExpired);
            Assert.False(r.IsUnder21);
            Assert.Equal("D1234567", r.Fields["DAQ"]);
            Assert.Equal("A", r.Fields["ZCA"]);
        }

        [Fact]
        public void InjectableToday()
        {
            Assert.True(AamvaParser.Parse(Vectors.Aamva, new DateTime(2011, 1, 30))!.IsUnder21);
            Assert.False(AamvaParser.Parse(Vectors.Aamva, new DateTime(2011, 1, 31))!.IsUnder21);
            Assert.False(AamvaParser.Parse(Vectors.Aamva, new DateTime(2028, 1, 31))!.IsExpired);
            Assert.True(AamvaParser.Parse(Vectors.Aamva, new DateTime(2028, 2, 1))!.IsExpired);
        }

        [Fact]
        public void CanadianDates()
        {
            var r = AamvaParser.Parse(Card("DAQA1234\nDCSDOE\nDACJOHN\nDBB19851224\nDBA20300101\nDBC1\nDAKM5V 3L9\nDCGCAN"), new DateTime(2026, 1, 1))!;
            Assert.Equal("CAN", r.Country);
            Assert.Equal("1985-12-24", r.DateOfBirth);
            Assert.Equal("2030-01-01", r.ExpiryDate);
            Assert.Equal("M", r.Sex);
            Assert.Equal("M5V 3L9", r.PostalCode);
            Assert.Equal(40, r.Age);
            Assert.Equal("CAN", AamvaParser.Parse(Card("DAQX1\nDCSDOE\nDACJOHN\nDBB19851224", iin: "636028"))!.Country);
        }

        [Fact]
        public void ZipPlusFourSexXAndIdCards()
        {
            var r = AamvaParser.Parse(Card("DAQ1\nDCSDOE\nDACALEX\nDBB07041976\nDBC9\nDAK981011234\nDCGUSA", iin: "636045"))!;
            Assert.Equal("98101-1234", r.PostalCode);
            Assert.Equal("X", r.Sex);
            Assert.Equal("1976-07-04", r.DateOfBirth);
            Assert.Equal("ID", AamvaParser.Parse(Card("DAQ99\nDCSROE\nDACRICHARD\nDBB02291992", kind: "ID"))!.DocumentType);
        }

        [Fact]
        public void LegacyNames()
        {
            var v1 = AamvaParser.Parse("@\n\u001e\rANSI 6360000101DL00290100DLDAQ1234\nDAASMITH,JOHN,PAUL\nDBB19700101\nDBA20200101\r", new DateTime(2026, 1, 1))!;
            Assert.Equal(1, v1.AamvaVersion);
            Assert.Equal(("JOHN", "PAUL", "SMITH"), (v1.FirstName, v1.MiddleName, v1.LastName));
            Assert.Equal("1970-01-01", v1.DateOfBirth);
            Assert.True(v1.IsExpired);
            var v3 = AamvaParser.Parse(Card("DAQ1\nDCSDOE\nDCTJANE,MARIE\nDBB01011990", version: "03"))!;
            Assert.Equal(("JANE", "MARIE", "DOE"), (v3.FirstName, v3.MiddleName, v3.LastName));
        }

        [Fact]
        public void MissingDatesAreNull()
        {
            var r = AamvaParser.Parse(Card("DAQ1\nDCSDOE\nDACJO"))!;
            Assert.Equal(string.Empty, r.DateOfBirth);
            Assert.Null(r.Age);
            Assert.Null(r.IsExpired);
            Assert.Null(r.IsUnder21);
            Assert.Contains("\"age\":null", QRGenJson.Serialize(r));
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("hello world")]
        [InlineData("@")]
        [InlineData("ANSI 636014")]
        [InlineData("(01)09501101530003")]
        public void NotAamva(string? data) => Assert.Null(AamvaParser.Parse(data));
    }
}
