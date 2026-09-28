// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

using QRGen.Embed;
using Xunit;

namespace QRGen.Tests
{
    public class EmbedTests
    {
        [Fact]
        public void BuildsSpecQueryString()
        {
            var uri = new EmbedOptions { Symbologies = { "QRCode", "ean-13" }, Mode = "single", Viewfinder = "frame" }.BuildUri();
            Assert.Equal("https://rockyljewell.github.io/QR-GEN/embed/?symbologies=qr,ean13&mode=single&beep=1&vibrate=1&camera=back&viewfinder=frame", uri.ToString());
            var batch = new EmbedOptions { Mode = "batch", Beep = false, DuplicateFilter = -1, MaxResults = 20, ScanArea = (0.1, 0.2, 0.8, 0.5), BaseUrl = "https://example.com/embed/?theme=dark" }.BuildUri();
            Assert.Equal("https://example.com/embed/?theme=dark&mode=batch&duplicateFilter=-1&beep=0&vibrate=1&camera=back&maxResults=20&scanArea=0.1,0.2,0.8,0.5", batch.ToString());
        }

        [Fact]
        public void ParsesMessages()
        {
            var scan = EmbedMessage.TryParse("{\"source\":\"qrgen\",\"version\":1,\"type\":\"scan\",\"barcodes\":[{\"data\":\"hi\",\"symbology\":\"qr\"}]}")!;
            Assert.Equal("scan", scan.Type);
            Assert.Equal("hi", scan.Barcodes![0].Data);
            var doubleEncoded = EmbedMessage.TryParse("\"{\\\"source\\\":\\\"qrgen\\\",\\\"version\\\":1,\\\"type\\\":\\\"ready\\\"}\"")!;
            Assert.Equal("ready", doubleEncoded.Type);
            var error = EmbedMessage.TryParse("{\"source\":\"qrgen\",\"version\":1,\"type\":\"error\",\"code\":\"camera-permission-denied\",\"message\":\"denied\"}")!;
            Assert.Equal(("camera-permission-denied", "denied"), (error.Code, error.Message));
            var track = EmbedMessage.TryParse("{\"source\":\"qrgen\",\"version\":1,\"type\":\"track\",\"tracked\":[{\"data\":\"a\",\"symbology\":\"qr\",\"id\":\"t1\",\"count\":4}]}")!;
            Assert.Equal(("t1", 4), (track.Tracked![0].Id, track.Tracked[0].Count));
            Assert.Null(EmbedMessage.TryParse("{\"source\":\"other\",\"type\":\"scan\"}"));
            Assert.Null(EmbedMessage.TryParse("not json"));
            Assert.Null(EmbedMessage.TryParse(null));
        }

        [Fact]
        public void Commands()
        {
            Assert.Equal("window.qrgen && window.qrgen.command({\"type\":\"start\"});", EmbedCommands.Start);
            Assert.Equal("window.qrgen && window.qrgen.command({\"type\":\"torch\",\"value\":true});", EmbedCommands.Torch(true));
        }
    }
}
