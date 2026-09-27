using System.Linq;
using System.Text;
using System.Text.Json;
using Xunit;

namespace QRGen.Tests
{
    public class JsonShapeTests
    {
        private static Barcode Sample() => new Barcode
        {
            Data = "https://example.com",
            Symbology = "qr",
            SymbologyName = "QR Code",
            RawBytes = Encoding.UTF8.GetBytes("https://example.com"),
            ContentType = "text",
            IsGS1 = false,
            Location = new Quad(new Point(10, 10), new Point(90, 10), new Point(90, 90), new Point(10, 90)),
            FrameSize = new ImageSize(1280, 720),
            Orientation = 0,
            EcLevel = "M",
            SymbologyIdentifier = "]Q1",
            Timestamp = 1735689600000,
        };

        [Fact]
        public void BarcodeMatchesSpecSection2()
        {
            var json = QRGenJson.Serialize(Sample());
            Assert.Equal(
                "{\"data\":\"https://example.com\",\"symbology\":\"qr\",\"symbologyName\":\"QR Code\"," +
                "\"rawBytes\":\"aHR0cHM6Ly9leGFtcGxlLmNvbQ==\",\"contentType\":\"text\",\"isGS1\":false," +
                "\"location\":{\"topLeft\":{\"x\":10,\"y\":10},\"topRight\":{\"x\":90,\"y\":10}," +
                "\"bottomRight\":{\"x\":90,\"y\":90},\"bottomLeft\":{\"x\":10,\"y\":90}}," +
                "\"frameSize\":{\"width\":1280,\"height\":720},\"orientation\":0,\"ecLevel\":\"M\"," +
                "\"symbologyIdentifier\":\"]Q1\",\"timestamp\":1735689600000}",
                json);
        }

        [Fact]
        public void BarcodeRoundTripsAndReadsParsed()
        {
            var json = "{\"data\":\"WIFI:S:Home;;\",\"symbology\":\"qr\",\"symbologyName\":\"QR Code\",\"rawBytes\":\"\",\"contentType\":\"text\"," +
                       "\"isGS1\":false,\"location\":{\"topLeft\":{\"x\":1.5,\"y\":2},\"topRight\":{\"x\":3,\"y\":4},\"bottomRight\":{\"x\":5,\"y\":6}," +
                       "\"bottomLeft\":{\"x\":7,\"y\":8}},\"frameSize\":{\"width\":100,\"height\":50},\"orientation\":90,\"ecLevel\":\"\"," +
                       "\"symbologyIdentifier\":\"]Q1\",\"timestamp\":5,\"parsed\":{\"type\":\"wifi\",\"ssid\":\"Home\",\"security\":\"nopass\",\"hidden\":false}}";
            var barcode = QRGenJson.Deserialize<Barcode>(json)!;
            Assert.Equal("WIFI:S:Home;;", barcode.Data);
            Assert.Equal(new Point(1.5, 2), barcode.Location.TopLeft);
            Assert.Equal(new ImageSize(100, 50), barcode.FrameSize);
            Assert.Equal(90, barcode.Orientation);
            Assert.Equal("Home", barcode.Parsed!.Ssid);
            Assert.Equal("wifi", barcode.Parse().Type);

            var sample = Sample();
            var again = QRGenJson.Deserialize<Barcode>(QRGenJson.Serialize(sample))!;
            Assert.Equal(sample.Location, again.Location);
            Assert.Equal(sample.RawBytes, again.RawBytes);
            Assert.Equal(sample.Timestamp, again.Timestamp);
        }

        [Fact]
        public void TrackedBarcodeAddsTrackingFields()
        {
            var tracked = new TrackedBarcode { Data = "x", Symbology = "qr", Id = "abc", FirstSeen = 1, LastSeen = 2, Count = 3 };
            using var doc = JsonDocument.Parse(QRGenJson.Serialize(tracked));
            var names = doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();
            Assert.Contains("id", names);
            Assert.Contains("firstSeen", names);
            Assert.Contains("lastSeen", names);
            Assert.Contains("count", names);
            Assert.Contains("symbologyIdentifier", names);
        }

        [Fact]
        public void ParsedContentOmitsUnusedFields()
        {
            Assert.Equal("{\"type\":\"url\",\"url\":\"https://example.com/?a=1&b=2\"}", QRGenJson.Serialize(ContentParser.Parse("https://example.com/?a=1&b=2")));
            var contact = QRGenJson.Serialize(ContentParser.Parse("MECARD:N:Doe,Jane;;"));
            Assert.Equal("{\"type\":\"contact\",\"name\":\"Jane Doe\",\"phones\":[],\"emails\":[],\"urls\":[],\"format\":\"mecard\"}", contact);
        }

        [Fact]
        public void Gs1JsonShape()
        {
            var json = QRGenJson.Serialize(Gs1Parser.Parse("(01)09501101530003(17)250101(3103)000195", new System.DateTime(2026, 1, 1)));
            Assert.Equal(
                "{\"elements\":[{\"ai\":\"01\",\"title\":\"GTIN\",\"value\":\"09501101530003\"}," +
                "{\"ai\":\"17\",\"title\":\"USE BY or EXPIRY\",\"value\":\"250101\",\"date\":\"2025-01-01\"}," +
                "{\"ai\":\"3103\",\"title\":\"NET WEIGHT (kg)\",\"value\":\"000195\",\"number\":0.195}]," +
                "\"values\":{\"01\":\"09501101530003\",\"17\":\"250101\",\"3103\":\"000195\"}}",
                json);
        }

        [Fact]
        public void AamvaJsonKeysAreCamelCase()
        {
            using var doc = JsonDocument.Parse(QRGenJson.Serialize(AamvaParser.Parse(Vectors.Aamva)));
            var names = doc.RootElement.EnumerateObject().Select(p => p.Name).ToArray();
            Assert.Equal(new[]
            {
                "issuerId", "aamvaVersion", "jurisdictionVersion", "documentType", "firstName", "middleName", "lastName", "suffix",
                "fullName", "dateOfBirth", "issueDate", "expiryDate", "sex", "documentNumber", "street", "city", "state",
                "postalCode", "country", "eyeColor", "height", "age", "isExpired", "isUnder21", "fields",
            }, names);
            Assert.Equal("D1234567", doc.RootElement.GetProperty("fields").GetProperty("DAQ").GetString());
        }
    }
}
