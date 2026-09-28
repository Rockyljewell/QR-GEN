// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace QRGen.Tests
{
    public class ClientTests
    {
        private sealed class FakeHandler : HttpMessageHandler
        {
            private readonly Func<HttpRequestMessage, string?, HttpResponseMessage> _respond;

            public FakeHandler(Func<HttpRequestMessage, string?, HttpResponseMessage> respond) => _respond = respond;

            public List<(HttpRequestMessage Request, byte[] Body)> Requests { get; } = new List<(HttpRequestMessage, byte[])>();

            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                var body = request.Content is null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(cancellationToken);
                Requests.Add((request, body));
                return _respond(request, Encoding.UTF8.GetString(body));
            }
        }

        private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
            new HttpResponseMessage(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

        private static (QRGenClient Client, FakeHandler Handler) Create(Func<HttpRequestMessage, string?, HttpResponseMessage> respond)
        {
            var handler = new FakeHandler(respond);
            return (new QRGenClient(new Uri("http://qrgen.test/api"), new HttpClient(handler)), handler);
        }

        [Fact]
        public async Task Health()
        {
            var (client, handler) = Create((_, _) => Json("{\"ok\":true,\"version\":\"1.0.0\"}"));
            var health = await client.HealthAsync();
            Assert.True(health.Ok);
            Assert.Equal("1.0.0", health.Version);
            Assert.Equal("http://qrgen.test/api/health", handler.Requests.Single().Request.RequestUri!.ToString());
        }

        [Fact]
        public async Task ScanPostsImageBytesWithSymbologies()
        {
            var response = "{\"barcodes\":[{\"data\":\"https://example.com\",\"symbology\":\"qr\",\"symbologyName\":\"QR Code\",\"rawBytes\":\"aGk=\"," +
                           "\"contentType\":\"text\",\"isGS1\":false,\"location\":{\"topLeft\":{\"x\":1,\"y\":2},\"topRight\":{\"x\":3,\"y\":2}," +
                           "\"bottomRight\":{\"x\":3,\"y\":4},\"bottomLeft\":{\"x\":1,\"y\":4}},\"frameSize\":{\"width\":10,\"height\":10}," +
                           "\"orientation\":0,\"ecLevel\":\"M\",\"symbologyIdentifier\":\"]Q1\",\"timestamp\":1,\"parsed\":{\"type\":\"url\",\"url\":\"https://example.com\"}}]}";
            var (client, handler) = Create((_, _) => Json(response));
            var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 1, 2, 3 };
            var codes = await client.ScanAsync(png, new[] { "qr", "ean13" });
            var code = Assert.Single(codes);
            Assert.Equal("https://example.com", code.Data);
            Assert.Equal("url", code.Parsed!.Type);
            Assert.Equal(new byte[] { (byte)'h', (byte)'i' }, code.RawBytes);
            var (request, body) = handler.Requests.Single();
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("http://qrgen.test/api/v1/scan?symbologies=qr,ean13", Uri.UnescapeDataString(request.RequestUri!.ToString()));
            Assert.Equal("image/png", request.Content!.Headers.ContentType!.MediaType);
            Assert.Equal(png, body);
        }

        [Fact]
        public async Task GenerateSendsSpecFields()
        {
            var (client, handler) = Create((_, _) => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes("<svg/>")) });
            var svg = await client.GenerateSvgAsync("hello", new GenerateOptions { Symbology = "code128", Scale = 2, EcLevel = "M", Gs1 = true });
            Assert.Equal("<svg/>", svg);
            using var doc = JsonDocument.Parse(handler.Requests.Single().Body);
            var root = doc.RootElement;
            Assert.Equal("hello", root.GetProperty("data").GetString());
            Assert.Equal("code128", root.GetProperty("symbology").GetString());
            Assert.Equal("svg", root.GetProperty("format").GetString());
            Assert.Equal(2, root.GetProperty("scale").GetInt32());
            Assert.Equal("M", root.GetProperty("ecLevel").GetString());
            Assert.True(root.GetProperty("gs1").GetBoolean());
            Assert.False(root.GetProperty("hrt").GetBoolean());
            Assert.True(root.GetProperty("margin").GetBoolean());
        }

        [Fact]
        public async Task ParseAndErrors()
        {
            var (client, _) = Create((request, body) => body!.Contains("fail")
                ? Json("{\"error\":{\"code\":\"bad-request\",\"message\":\"nope\"}}", HttpStatusCode.BadRequest)
                : Json("{\"type\":\"wifi\",\"ssid\":\"Home\",\"security\":\"WPA\",\"hidden\":false}"));
            var parsed = await client.ParseAsync("WIFI:S:Home;T:WPA;P:x;;");
            Assert.Equal(("wifi", "Home"), (parsed.Type, parsed.Ssid));
            var error = await Assert.ThrowsAsync<QRGenApiException>(() => client.ParseAsync("fail"));
            Assert.Equal(HttpStatusCode.BadRequest, error.StatusCode);
            Assert.Equal("bad-request", error.Code);
            Assert.Equal("nope", error.Message);
        }

        [Fact]
        public async Task NonJsonErrorBody()
        {
            var (client, _) = Create((_, _) => new HttpResponseMessage(HttpStatusCode.BadGateway) { Content = new StringContent("upstream down") });
            var error = await Assert.ThrowsAsync<QRGenApiException>(() => client.HealthAsync());
            Assert.Equal("http-502", error.Code);
            Assert.Equal("upstream down", error.Message);
        }

        [Theory]
        [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }, "image/jpeg")]
        [InlineData(new byte[] { 0x47, 0x49, 0x46, 0x38, 0x39 }, "image/gif")]
        [InlineData(new byte[] { 0x42, 0x4D, 0, 0 }, "image/bmp")]
        [InlineData(new byte[] { 0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50 }, "image/webp")]
        [InlineData(new byte[] { 1, 2, 3 }, "application/octet-stream")]
        public void DetectsImageTypes(byte[] bytes, string expected) => Assert.Equal(expected, QRGenClient.DetectImageType(bytes));
    }
}
