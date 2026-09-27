using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace QRGen
{
    /// <summary>Response of <c>GET /health</c>.</summary>
    public sealed class HealthResponse
    {
        /// <summary><c>true</c> when the server is healthy.</summary>
        [JsonPropertyName("ok")] public bool Ok { get; init; }

        /// <summary>Server version.</summary>
        [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;
    }

    /// <summary>Response of <c>GET /v1/symbologies</c>.</summary>
    public sealed class SymbologySupport
    {
        /// <summary>Ids the server can decode.</summary>
        [JsonPropertyName("read")] public IReadOnlyList<string> Read { get; init; } = Array.Empty<string>();

        /// <summary>Ids the server can generate.</summary>
        [JsonPropertyName("write")] public IReadOnlyList<string> Write { get; init; } = Array.Empty<string>();
    }

    /// <summary>Options for <see cref="QRGenClient.ScanAsync(byte[], ScanOptions, CancellationToken)"/>.</summary>
    public sealed class ScanOptions
    {
        /// <summary>Ids, aliases or groups (default: all).</summary>
        public IEnumerable<string>? Symbologies { get; set; }

        /// <summary>Search rotated, downscaled and inverted variants (default <c>true</c>).</summary>
        public bool TryHarder { get; set; } = true;

        /// <summary>Maximum number of codes to return (default: all).</summary>
        public int? MaxResults { get; set; }

        /// <summary>MIME type of the image; detected from the bytes when <c>null</c>.</summary>
        public string? ContentType { get; set; }
    }

    /// <summary>Thrown when the QRGen REST API returns an error (<c>{ "error": { code, message } }</c>).</summary>
    public sealed class QRGenApiException : Exception
    {
        /// <summary>Creates an exception.</summary>
        public QRGenApiException(HttpStatusCode statusCode, string code, string message) : base(message)
        {
            StatusCode = statusCode;
            Code = code;
        }

        /// <summary>HTTP status code.</summary>
        public HttpStatusCode StatusCode { get; }

        /// <summary>Error code from the response, for example <c>bad-request</c>.</summary>
        public string Code { get; }
    }

    /// <summary>
    /// <see cref="HttpClient"/>-based client for the QRGen REST API (SPEC section 6), served by
    /// <c>qrgen serve</c>, <c>qrgen-py serve</c> or the Docker image.
    /// </summary>
    /// <example>
    /// <code>
    /// using var client = new QRGenClient("http://localhost:8080");
    /// var codes = await client.ScanAsync(File.ReadAllBytes("photo.jpg"), new[] { "qr", "ean13" });
    /// byte[] png = await client.GenerateAsync("https://example.com", new GenerateOptions { Format = "png" });
    /// </code>
    /// </example>
    public sealed class QRGenClient : IDisposable
    {
        private readonly HttpClient _http;
        private readonly bool _ownsClient;

        /// <summary>Creates a client for a base URL such as <c>http://localhost:8080</c>.</summary>
        public QRGenClient(string baseUrl = "http://localhost:8080") : this(new Uri(baseUrl))
        {
        }

        /// <summary>Creates a client. When <paramref name="httpClient"/> is given it is used as-is and not disposed.</summary>
        public QRGenClient(Uri baseUri, HttpClient? httpClient = null)
        {
            if (baseUri is null) throw new ArgumentNullException(nameof(baseUri));
            var text = baseUri.ToString();
            BaseUri = new Uri(text.EndsWith("/", StringComparison.Ordinal) ? text : text + "/");
            _ownsClient = httpClient is null;
            _http = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        }

        /// <summary>The API base address (always ends with <c>/</c>).</summary>
        public Uri BaseUri { get; }

        /// <summary><c>GET /health</c>.</summary>
        public async Task<HealthResponse> HealthAsync(CancellationToken cancellationToken = default)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Url("health"));
            return await SendJsonAsync<HealthResponse>(request, cancellationToken).ConfigureAwait(false);
        }

        /// <summary><c>GET /v1/symbologies</c>.</summary>
        public async Task<SymbologySupport> GetSymbologiesAsync(CancellationToken cancellationToken = default)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Url("v1/symbologies"));
            return await SendJsonAsync<SymbologySupport>(request, cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Decodes every barcode in an encoded image (PNG, JPEG, GIF, BMP, WebP...).</summary>
        /// <param name="image">Encoded image bytes.</param>
        /// <param name="symbologies">Ids, aliases or groups (default: all).</param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>Barcodes with <see cref="Barcode.Parsed"/> filled in.</returns>
        public Task<IReadOnlyList<Barcode>> ScanAsync(byte[] image, IEnumerable<string>? symbologies = null, CancellationToken cancellationToken = default) =>
            ScanAsync(image, new ScanOptions { Symbologies = symbologies }, cancellationToken);

        /// <summary>Decodes every barcode in an encoded image read from a stream.</summary>
        public async Task<IReadOnlyList<Barcode>> ScanAsync(Stream image, IEnumerable<string>? symbologies = null, CancellationToken cancellationToken = default)
        {
            if (image is null) throw new ArgumentNullException(nameof(image));
            using var buffer = new MemoryStream();
            await image.CopyToAsync(buffer, 81920, cancellationToken).ConfigureAwait(false);
            return await ScanAsync(buffer.ToArray(), new ScanOptions { Symbologies = symbologies }, cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Decodes every barcode in an encoded image with explicit options.</summary>
        public async Task<IReadOnlyList<Barcode>> ScanAsync(byte[] image, ScanOptions options, CancellationToken cancellationToken = default)
        {
            if (image is null) throw new ArgumentNullException(nameof(image));
            options ??= new ScanOptions();
            var query = new List<string>();
            var list = options.Symbologies?.Where(s => !string.IsNullOrWhiteSpace(s)).ToList();
            if (list is { Count: > 0 }) query.Add("symbologies=" + Uri.EscapeDataString(string.Join(",", list)));
            if (!options.TryHarder) query.Add("tryHarder=false");
            if (options.MaxResults is int max) query.Add("maxResults=" + max.ToString(CultureInfo.InvariantCulture));
            var path = "v1/scan" + (query.Count > 0 ? "?" + string.Join("&", query) : string.Empty);

            using var request = new HttpRequestMessage(HttpMethod.Post, Url(path));
            var content = new ByteArrayContent(image);
            content.Headers.ContentType = new MediaTypeHeaderValue(options.ContentType ?? DetectImageType(image));
            request.Content = content;
            var response = await SendJsonAsync<ScanResponse>(request, cancellationToken).ConfigureAwait(false);
            return response.Barcodes ?? (IReadOnlyList<Barcode>)Array.Empty<Barcode>();
        }

        /// <summary>Generates a barcode image (<c>POST /v1/generate</c>) and returns the image bytes (SVG as UTF-8).</summary>
        public async Task<byte[]> GenerateAsync(string data, GenerateOptions? options = null, CancellationToken cancellationToken = default)
        {
            if (data is null) throw new ArgumentNullException(nameof(data));
            options ??= new GenerateOptions();
            var body = new Dictionary<string, object?>
            {
                ["data"] = data,
                ["symbology"] = options.Symbology,
                ["format"] = options.Format,
                ["scale"] = options.Scale,
                ["gs1"] = options.Gs1,
                ["hrt"] = options.Hrt,
                ["margin"] = options.Margin,
            };
            if (!string.IsNullOrEmpty(options.EcLevel)) body["ecLevel"] = options.EcLevel;
            if (!string.IsNullOrEmpty(options.Foreground)) body["foreground"] = options.Foreground;
            if (!string.IsNullOrEmpty(options.Background)) body["background"] = options.Background;

            using var request = new HttpRequestMessage(HttpMethod.Post, Url("v1/generate"))
            {
                Content = JsonContent(body),
            };
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) throw ToException(response.StatusCode, bytes);
            return bytes;
        }

        /// <summary>Generates an SVG document through the REST API.</summary>
        public async Task<string> GenerateSvgAsync(string data, GenerateOptions? options = null, CancellationToken cancellationToken = default)
        {
            options ??= new GenerateOptions();
            var copy = new GenerateOptions
            {
                Symbology = options.Symbology,
                Format = "svg",
                Scale = options.Scale,
                EcLevel = options.EcLevel,
                Gs1 = options.Gs1,
                Hrt = options.Hrt,
                Margin = options.Margin,
                Foreground = options.Foreground,
                Background = options.Background,
            };
            var bytes = await GenerateAsync(data, copy, cancellationToken).ConfigureAwait(false);
            return Encoding.UTF8.GetString(bytes);
        }

        /// <summary>Classifies and parses decoded text on the server (<c>POST /v1/parse</c>).</summary>
        /// <remarks>The same parser runs locally with <see cref="ContentParser.Parse(string?, string?, DateTime?)"/>.</remarks>
        public async Task<ParsedContent> ParseAsync(string data, CancellationToken cancellationToken = default)
        {
            if (data is null) throw new ArgumentNullException(nameof(data));
            using var request = new HttpRequestMessage(HttpMethod.Post, Url("v1/parse"))
            {
                Content = JsonContent(new Dictionary<string, object?> { ["data"] = data }),
            };
            return await SendJsonAsync<ParsedContent>(request, cancellationToken).ConfigureAwait(false);
        }

        /// <inheritdoc />
        public void Dispose()
        {
            if (_ownsClient) _http.Dispose();
        }

        private Uri Url(string relative) => new Uri(BaseUri, relative);

        private static HttpContent JsonContent(object value)
        {
            var json = JsonSerializer.Serialize(value, QRGenJson.Options);
            return new StringContent(json, Encoding.UTF8, "application/json");
        }

        private async Task<T> SendJsonAsync<T>(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
            if (!response.IsSuccessStatusCode) throw ToException(response.StatusCode, bytes);
            try
            {
                return JsonSerializer.Deserialize<T>(bytes, QRGenJson.Options)
                       ?? throw new QRGenApiException(response.StatusCode, "invalid-response", "The server returned an empty body.");
            }
            catch (JsonException ex)
            {
                throw new QRGenApiException(response.StatusCode, "invalid-response", "The server returned invalid JSON: " + ex.Message);
            }
        }

        private static QRGenApiException ToException(HttpStatusCode status, byte[] body)
        {
            try
            {
                var envelope = JsonSerializer.Deserialize<ErrorEnvelope>(body, QRGenJson.Options);
                if (envelope?.Error is { } error)
                    return new QRGenApiException(status, error.Code ?? "unknown", error.Message ?? status.ToString());
            }
            catch (JsonException)
            {
                // not a QRGen error body
            }
            var text = Encoding.UTF8.GetString(body);
            return new QRGenApiException(status, "http-" + ((int)status).ToString(CultureInfo.InvariantCulture),
                string.IsNullOrWhiteSpace(text) ? status.ToString() : text);
        }

        /// <summary>Guesses the MIME type of encoded image bytes from their signature.</summary>
        public static string DetectImageType(byte[] image)
        {
            bool Starts(params byte[] signature) => image.Length >= signature.Length && !signature.Where((b, i) => image[i] != b).Any();
            if (Starts(0x89, 0x50, 0x4E, 0x47)) return "image/png";
            if (Starts(0xFF, 0xD8, 0xFF)) return "image/jpeg";
            if (Starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
            if (Starts(0x42, 0x4D)) return "image/bmp";
            if (image.Length >= 12 && Starts(0x52, 0x49, 0x46, 0x46) && image[8] == 0x57 && image[9] == 0x45 && image[10] == 0x42 && image[11] == 0x50) return "image/webp";
            if (Starts(0x49, 0x49, 0x2A, 0x00) || Starts(0x4D, 0x4D, 0x00, 0x2A)) return "image/tiff";
            return "application/octet-stream";
        }

        private sealed class ScanResponse
        {
            [JsonPropertyName("barcodes")] public List<Barcode>? Barcodes { get; set; }
        }

        private sealed class ErrorEnvelope
        {
            [JsonPropertyName("error")] public ErrorBody? Error { get; set; }
        }

        private sealed class ErrorBody
        {
            [JsonPropertyName("code")] public string? Code { get; set; }
            [JsonPropertyName("message")] public string? Message { get; set; }
        }
    }
}
