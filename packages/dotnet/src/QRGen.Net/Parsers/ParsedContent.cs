using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace QRGen
{
    /// <summary>The <see cref="ParsedContent.Type"/> values (SPEC section 3.1).</summary>
    public static class ParsedContentType
    {
        /// <summary>A URL (<c>url</c>).</summary>
        public const string Url = "url";
        /// <summary>A GS1 Digital Link URL (<c>url</c>, <c>gs1</c>).</summary>
        public const string Gs1DigitalLink = "gs1-digital-link";
        /// <summary>E-mail (<c>to</c>, <c>subject</c>, <c>body</c>).</summary>
        public const string Email = "email";
        /// <summary>Phone number (<c>number</c>).</summary>
        public const string Phone = "phone";
        /// <summary>SMS (<c>number</c>, <c>body</c>).</summary>
        public const string Sms = "sms";
        /// <summary>Wi-Fi network (<c>ssid</c>, <c>password</c>, <c>security</c>, <c>hidden</c>).</summary>
        public const string Wifi = "wifi";
        /// <summary>Geo location (<c>latitude</c>, <c>longitude</c>, <c>altitude</c>, <c>query</c>).</summary>
        public const string Geo = "geo";
        /// <summary>Contact card (vCard or MECARD).</summary>
        public const string Contact = "contact";
        /// <summary>Calendar event (VEVENT).</summary>
        public const string Event = "event";
        /// <summary>Payment request (EPC, bitcoin, ethereum, UPI...).</summary>
        public const string Payment = "payment";
        /// <summary>Product code (GTIN).</summary>
        public const string Product = "product";
        /// <summary>GS1 element strings.</summary>
        public const string Gs1 = "gs1";
        /// <summary>AAMVA driver license / ID card.</summary>
        public const string Aamva = "aamva";
        /// <summary>Anything else.</summary>
        public const string Text = "text";

        /// <summary>Every type, in SPEC order.</summary>
        public static IReadOnlyList<string> All { get; } = new[]
        {
            Url, Gs1DigitalLink, Email, Phone, Sms, Wifi, Geo, Contact, Event, Payment, Product, Gs1, Aamva, Text,
        };
    }

    /// <summary>
    /// Result of <see cref="ContentParser.Parse(string?, string?, System.DateTime?)"/> (SPEC section 3.1).
    /// Only the properties that belong to <see cref="Type"/> are set; the others are <c>null</c> and are
    /// omitted from JSON.
    /// </summary>
    public sealed class ParsedContent
    {
        /// <summary>One of <see cref="ParsedContentType"/>.</summary>
        [JsonPropertyName("type")] public string Type { get; init; } = ParsedContentType.Text;

        /// <summary>url, gs1-digital-link: the URL.</summary>
        [JsonPropertyName("url")] public string? Url { get; init; }
        /// <summary>gs1, gs1-digital-link: the GS1 elements.</summary>
        [JsonPropertyName("gs1")] public Gs1Result? Gs1 { get; init; }

        /// <summary>email: recipient(s).</summary>
        [JsonPropertyName("to")] public string? To { get; init; }
        /// <summary>email: subject.</summary>
        [JsonPropertyName("subject")] public string? Subject { get; init; }
        /// <summary>email, sms: message body.</summary>
        [JsonPropertyName("body")] public string? Body { get; init; }

        /// <summary>phone, sms: phone number.</summary>
        [JsonPropertyName("number")] public string? Number { get; init; }

        /// <summary>wifi: network name.</summary>
        [JsonPropertyName("ssid")] public string? Ssid { get; init; }
        /// <summary>wifi: password.</summary>
        [JsonPropertyName("password")] public string? Password { get; init; }
        /// <summary>wifi: <c>WPA</c>, <c>WEP</c>, <c>SAE</c>, <c>nopass</c>...</summary>
        [JsonPropertyName("security")] public string? Security { get; init; }
        /// <summary>wifi: hidden network.</summary>
        [JsonPropertyName("hidden")] public bool? Hidden { get; init; }

        /// <summary>geo: latitude in degrees.</summary>
        [JsonPropertyName("latitude")] public double? Latitude { get; init; }
        /// <summary>geo: longitude in degrees.</summary>
        [JsonPropertyName("longitude")] public double? Longitude { get; init; }
        /// <summary>geo: altitude in meters.</summary>
        [JsonPropertyName("altitude")] public double? Altitude { get; init; }
        /// <summary>geo: search query (<c>q</c> parameter).</summary>
        [JsonPropertyName("query")] public string? Query { get; init; }

        /// <summary>contact, payment: name.</summary>
        [JsonPropertyName("name")] public string? Name { get; init; }
        /// <summary>contact: organization.</summary>
        [JsonPropertyName("organization")] public string? Organization { get; init; }
        /// <summary>contact: job title.</summary>
        [JsonPropertyName("title")] public string? Title { get; init; }
        /// <summary>contact: phone numbers.</summary>
        [JsonPropertyName("phones")] public IReadOnlyList<string>? Phones { get; init; }
        /// <summary>contact: e-mail addresses.</summary>
        [JsonPropertyName("emails")] public IReadOnlyList<string>? Emails { get; init; }
        /// <summary>contact: URLs.</summary>
        [JsonPropertyName("urls")] public IReadOnlyList<string>? Urls { get; init; }
        /// <summary>contact: postal address; payment: wallet address or payee id.</summary>
        [JsonPropertyName("address")] public string? Address { get; init; }
        /// <summary>contact: note.</summary>
        [JsonPropertyName("note")] public string? Note { get; init; }
        /// <summary>contact: <c>vcard</c> or <c>mecard</c>.</summary>
        [JsonPropertyName("format")] public string? Format { get; init; }

        /// <summary>event: summary.</summary>
        [JsonPropertyName("summary")] public string? Summary { get; init; }
        /// <summary>event: ISO 8601 start.</summary>
        [JsonPropertyName("start")] public string? Start { get; init; }
        /// <summary>event: ISO 8601 end.</summary>
        [JsonPropertyName("end")] public string? End { get; init; }
        /// <summary>event: location.</summary>
        [JsonPropertyName("location")] public string? Location { get; init; }
        /// <summary>event: description.</summary>
        [JsonPropertyName("description")] public string? Description { get; init; }

        /// <summary>payment: <c>epc</c>, <c>bitcoin</c>, <c>ethereum</c>, <c>upi</c> or <c>other</c>.</summary>
        [JsonPropertyName("scheme")] public string? Scheme { get; init; }
        /// <summary>payment: IBAN.</summary>
        [JsonPropertyName("iban")] public string? Iban { get; init; }
        /// <summary>payment: BIC.</summary>
        [JsonPropertyName("bic")] public string? Bic { get; init; }
        /// <summary>payment: amount as a decimal string.</summary>
        [JsonPropertyName("amount")] public string? Amount { get; init; }
        /// <summary>payment: currency code.</summary>
        [JsonPropertyName("currency")] public string? Currency { get; init; }
        /// <summary>payment: remittance reference or message.</summary>
        [JsonPropertyName("reference")] public string? Reference { get; init; }

        /// <summary>product: 14 digit, zero padded GTIN.</summary>
        [JsonPropertyName("gtin")] public string? Gtin { get; init; }
        /// <summary>product: <c>ean13</c>, <c>ean8</c>, <c>upca</c>, <c>upce</c>, <c>isbn</c> or <c>gtin14</c>.</summary>
        [JsonPropertyName("kind")] public string? Kind { get; init; }
        /// <summary>product: whether the check digit is valid.</summary>
        [JsonPropertyName("checksumValid")] public bool? ChecksumValid { get; init; }

        /// <summary>aamva: the parsed license.</summary>
        [JsonPropertyName("aamva")] public AamvaResult? Aamva { get; init; }

        /// <summary>text: the original text.</summary>
        [JsonPropertyName("text")] public string? Text { get; init; }
    }
}
