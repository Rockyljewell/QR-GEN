using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace QRGen
{
    /// <summary>
    /// System.Text.Json settings that produce the camelCase JSON shared by every QRGen platform.
    /// </summary>
    public static class QRGenJson
    {
        /// <summary>
        /// Serializer options: camelCase names, <c>null</c> optional fields omitted, relaxed escaping
        /// (so URLs and non-ASCII text stay readable), case-insensitive reading.
        /// </summary>
        public static JsonSerializerOptions Options { get; } = CreateOptions();

        /// <summary>Creates a fresh copy of <see cref="Options"/> that callers may modify.</summary>
        public static JsonSerializerOptions CreateOptions() => new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DictionaryKeyPolicy = null,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            PropertyNameCaseInsensitive = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
        };

        /// <summary>Serializes a value with <see cref="Options"/>.</summary>
        public static string Serialize<T>(T value, bool indented = false)
        {
            if (!indented) return JsonSerializer.Serialize(value, Options);
            var options = CreateOptions();
            options.WriteIndented = true;
            return JsonSerializer.Serialize(value, options);
        }

        /// <summary>Deserializes a value with <see cref="Options"/>.</summary>
        public static T? Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);
    }
}
