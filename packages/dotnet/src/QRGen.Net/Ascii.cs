namespace QRGen
{
    /// <summary>ASCII-only character tests (<see cref="char.IsDigit(char)"/> also accepts non-Latin digits).</summary>
    internal static class Ascii
    {
        public static bool IsDigit(char c) => c >= '0' && c <= '9';
    }
}
