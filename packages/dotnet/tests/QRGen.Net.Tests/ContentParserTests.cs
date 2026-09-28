// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System.Linq;
using Xunit;

namespace QRGen.Tests
{
    public class ContentParserTests
    {
        private static ParsedContent P(string data, string? symbology = null) => ContentParser.Parse(data, symbology);

        [Fact]
        public void Urls()
        {
            Assert.Equal("url", P("https://example.com/x?q=1").Type);
            Assert.Equal("https://example.com/x?q=1", P("https://example.com/x?q=1").Url);
            Assert.Equal("https://example.com", P("URLTO:https://example.com").Url);
            Assert.Equal("https://example.com", P("MEBKM:TITLE:Example;URL:https\\://example.com;;").Url);
        }

        [Fact]
        public void DigitalLink()
        {
            var r = P("https://id.gs1.org/01/09501101530003/10/ABC123?17=250101");
            Assert.Equal("gs1-digital-link", r.Type);
            Assert.Equal("ABC123", r.Gs1!.Values["10"]);
        }

        [Fact]
        public void Email()
        {
            var r = P("mailto:jane@example.com?subject=Hi%20there&body=Hello");
            Assert.Equal(("email", "jane@example.com", "Hi there", "Hello"), (r.Type, r.To, r.Subject, r.Body));
            r = P(@"MATMSG:TO:jane@example.com;SUB:Hi;BODY:Line\; two;;");
            Assert.Equal(("jane@example.com", "Hi", "Line; two"), (r.To, r.Subject, r.Body));
            r = P("SMTP:jane@example.com:Subject:Body");
            Assert.Equal(("jane@example.com", "Subject", "Body"), (r.To, r.Subject, r.Body));
            Assert.Equal("email", P("jane@example.com").Type);
        }

        [Fact]
        public void PhoneAndSms()
        {
            Assert.Equal(("phone", "+1-555-0100"), (P("tel:+1-555-0100").Type, P("tel:+1-555-0100").Number));
            var sms = P("sms:+15550100?body=Hello%20you");
            Assert.Equal(("sms", "+15550100", "Hello you"), (sms.Type, sms.Number, sms.Body));
            sms = P("SMSTO:+15550100:Hi there");
            Assert.Equal(("+15550100", "Hi there"), (sms.Number, sms.Body));
        }

        [Fact]
        public void Wifi()
        {
            var r = P("WIFI:T:WPA;S:Home;P:secret;;");
            Assert.Equal(("wifi", "Home", "secret", "WPA", (bool?)false), (r.Type, r.Ssid, r.Password, r.Security, r.Hidden));
            Assert.Equal("{\"type\":\"wifi\",\"ssid\":\"Home\",\"password\":\"secret\",\"security\":\"WPA\",\"hidden\":false}", QRGenJson.Serialize(r));
            r = P(@"WIFI:S:My\;Net\:work\\5G;T:WEP;P:pa\,ss\""w;H:true;;");
            Assert.Equal(("My;Net:work\\5G", "pa,ss\"w", "WEP", (bool?)true), (r.Ssid, r.Password, r.Security, r.Hidden));
            r = P("WIFI:S:Cafe;;");
            Assert.Equal(("nopass", (string?)null), (r.Security, r.Password));
        }

        [Fact]
        public void Geo()
        {
            var r = P("geo:40.7,-74.0,12.5?q=New%20York");
            Assert.Equal(("geo", 40.7, -74.0, 12.5, "New York"), (r.Type, r.Latitude!.Value, r.Longitude!.Value, r.Altitude!.Value, r.Query));
            Assert.Equal("text", P("geo:not,valid").Type);
        }

        [Fact]
        public void VCard()
        {
            var vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;Q;;\r\nFN:Jane Doe\r\nORG:Example Inc.;R&D\r\nTITLE:Engineer\r\n" +
                        "TEL;TYPE=CELL:+1 555 0100\r\nTEL;TYPE=WORK:+1 555 0101\r\nEMAIL:jane@example.com\r\n" +
                        "item1.EMAIL;type=INTERNET:jd@example.org\r\nURL:https://example.com\r\n" +
                        "ADR;TYPE=WORK:;;123 Main St;Springfield;IL;62701;USA\r\nNOTE:Line one\\nLine two\r\n continued\r\nEND:VCARD";
            var r = P(vcard);
            Assert.Equal("contact", r.Type);
            Assert.Equal("vcard", r.Format);
            Assert.Equal("Jane Doe", r.Name);
            Assert.Equal("Example Inc. R&D", r.Organization);
            Assert.Equal("Engineer", r.Title);
            Assert.Equal(new[] { "+1 555 0100", "+1 555 0101" }, r.Phones);
            Assert.Equal(new[] { "jane@example.com", "jd@example.org" }, r.Emails);
            Assert.Equal(new[] { "https://example.com" }, r.Urls);
            Assert.Equal("123 Main St, Springfield, IL, 62701, USA", r.Address);
            Assert.Equal("Line one\nLine twocontinued", r.Note);
            var qp = P("BEGIN:VCARD\nVERSION:2.1\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:M=C3=BCller;J=C3=BCrgen\nEND:VCARD");
            Assert.Equal("Jürgen Müller", qp.Name);
            Assert.Empty(qp.Phones!);
        }

        [Fact]
        public void MeCard()
        {
            var r = P("MECARD:N:Doe,Jane;TEL:+15550100;EMAIL:jane@example.com;URL:https\\://example.com;ADR:1 Main St;NOTE:Hi;ORG:ACME;;");
            Assert.Equal(("contact", "mecard", "Jane Doe", "ACME", "1 Main St", "Hi"), (r.Type, r.Format, r.Name, r.Organization, r.Address, r.Note));
            Assert.Equal(new[] { "+15550100" }, r.Phones);
            Assert.Equal(new[] { "https://example.com" }, r.Urls);
        }

        [Fact]
        public void Event()
        {
            var r = P("BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Launch party\nDTSTART:20250101T190000Z\n" +
                      "DTEND;TZID=Europe/Berlin:20250101T230000\nLOCATION:Berlin\\, Germany\nDESCRIPTION:Bring friends\nEND:VEVENT\nEND:VCALENDAR");
            Assert.Equal(("event", "Launch party", "2025-01-01T19:00:00Z", "2025-01-01T23:00:00", "Berlin, Germany", "Bring friends"),
                (r.Type, r.Summary, r.Start, r.End, r.Location, r.Description));
            Assert.Equal("2025-07-04", P("BEGIN:VEVENT\nSUMMARY:All day\nDTSTART;VALUE=DATE:20250704\nEND:VEVENT").Start);
        }

        [Fact]
        public void Payments()
        {
            var epc = P("BCD\n002\n1\nSCT\nBFSWDE33BER\nWikimedia Foerdergesellschaft\nDE33 1002 0500 0001 1947 00\nEUR123.45\n\n\nDonation\n");
            Assert.Equal(("payment", "epc", "Wikimedia Foerdergesellschaft", "DE33100205000001194700", "BFSWDE33BER", "123.45", "EUR", "Donation"),
                (epc.Type, epc.Scheme, epc.Name, epc.Iban, epc.Bic, epc.Amount, epc.Currency, epc.Reference));
            var btc = P("bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=0.01&label=Shop&message=Order%2042");
            Assert.Equal(("bitcoin", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "Shop", "0.01", "BTC", "Order 42"),
                (btc.Scheme, btc.Address, btc.Name, btc.Amount, btc.Currency, btc.Reference));
            var eth = P("ethereum:0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359@1?value=2.014e18");
            Assert.Equal(("ethereum", "0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359", "2.014e18", "ETH"), (eth.Scheme, eth.Address, eth.Amount, eth.Currency));
            var upi = P("upi://pay?pa=shop@okbank&pn=Corner%20Shop&am=150.00&cu=INR&tn=Tea");
            Assert.Equal(("upi", "shop@okbank", "Corner Shop", "150.00", "INR", "Tea"), (upi.Scheme, upi.Address, upi.Name, upi.Amount, upi.Currency, upi.Reference));
            Assert.Equal("other", P("litecoin:LQ3B36Yv2rBTxdgAdYpU2UcEZsaNwXeATk?amount=1").Scheme);
            var payto = P("payto://iban/DE75512108001245126199?amount=EUR:10.50&receiver-name=Jane");
            Assert.Equal(("DE75512108001245126199", "10.50", "EUR", "Jane"), (payto.Iban, payto.Amount, payto.Currency, payto.Name));
        }

        [Theory]
        [InlineData("9501101530003", "ean13", "09501101530003", true)]
        [InlineData("9501101530004", "ean13", "09501101530004", false)]
        [InlineData("96385074", "ean8", "00000096385074", true)]
        [InlineData("036000291452", "upca", "00036000291452", true)]
        [InlineData("9780306406157", "isbn", "09780306406157", true)]
        [InlineData("15400141288763", "gtin14", "15400141288763", true)]
        [InlineData("04252614", "upce", "00042100005264", true)]
        [InlineData("01234565", "ean8", "00000001234565", true)]
        public void Products(string data, string kind, string gtin, bool valid)
        {
            var r = P(data);
            Assert.Equal(("product", kind, gtin, (bool?)valid), (r.Type, r.Kind, r.Gtin, r.ChecksumValid));
        }

        [Fact]
        public void ProductHintAndHelpers()
        {
            Assert.Equal("upce", P("01234565", "upce").Kind);
            Assert.Equal("00012345000065", P("01234565", "upce").Gtin);
            Assert.Equal("012345000065", ContentParser.ExpandUpcE("01234565"));
            Assert.Equal("042100005264", ContentParser.ExpandUpcE("04252614"));
            Assert.Null(ContentParser.ExpandUpcE("21234565"));
            Assert.True(ContentParser.GtinChecksumValid("09501101530003"));
            Assert.False(ContentParser.GtinChecksumValid("09501101530004"));
        }

        [Fact]
        public void Gs1AndAamva()
        {
            Assert.Equal("gs1", P(Vectors.Gs1).Type);
            Assert.Equal("09501101530003", P(Vectors.Gs1).Gs1!.Values["01"]);
            Assert.Equal("gs1", P("]C1010950110153000310ABC").Type);
            Assert.Equal("gs1", P("0109501101530003\u001d10ABC").Type);
            var aamva = P(Vectors.Aamva);
            Assert.Equal("aamva", aamva.Type);
            Assert.Equal("SAMPLE", aamva.Aamva!.LastName);
        }

        [Theory]
        [InlineData("hello world")]
        [InlineData("12345")]
        [InlineData("(555) 123-4567")]
        [InlineData("WIFI")]
        [InlineData("@home")]
        public void TextFallback(string data)
        {
            var r = P(data);
            Assert.Equal(("text", data), (r.Type, r.Text));
            Assert.Equal("{\"type\":\"text\",\"text\":" + System.Text.Json.JsonSerializer.Serialize(data) + "}", QRGenJson.Serialize(r));
        }

        [Fact]
        public void NeverThrows()
        {
            foreach (var data in new[] { null, "", "BCD\n", "geo:", "sms:", "mailto:", "BEGIN:VCARD", "MECARD:", "upi://pay", "payto://", "ethereum:" })
            {
                var r = ContentParser.Parse(data);
                Assert.Contains(r.Type, ParsedContentType.All);
            }
        }
    }
}
