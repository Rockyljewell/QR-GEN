using System;
using System.IO;
using System.IO.Compression;

namespace QRGen
{
    /// <summary>A minimal, dependency-free PNG encoder for 8-bit grayscale and RGBA images.</summary>
    public static class PngEncoder
    {
        private static readonly uint[] CrcTable = BuildCrcTable();

        /// <summary>Encodes 8-bit grayscale pixels (one byte per pixel, row-major).</summary>
        public static byte[] EncodeGray(byte[] pixels, int width, int height) => Encode(pixels, width, height, 1, 0);

        /// <summary>Encodes RGBA pixels (four bytes per pixel, row-major).</summary>
        public static byte[] EncodeRgba(byte[] pixels, int width, int height) => Encode(pixels, width, height, 4, 6);

        private static byte[] Encode(byte[] pixels, int width, int height, int channels, byte colorType)
        {
            if (pixels is null) throw new ArgumentNullException(nameof(pixels));
            if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException(nameof(width), "Image must not be empty.");
            if (pixels.Length < width * height * channels) throw new ArgumentException("Pixel buffer is too small.", nameof(pixels));

            using var output = new MemoryStream();
            output.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, 0, 8);

            var header = new byte[13];
            WriteUInt32(header, 0, (uint)width);
            WriteUInt32(header, 4, (uint)height);
            header[8] = 8; // bit depth
            header[9] = colorType;
            WriteChunk(output, "IHDR", header);

            var stride = width * channels;
            var raw = new byte[(stride + 1) * height];
            for (var y = 0; y < height; y++)
            {
                raw[y * (stride + 1)] = 0; // filter: none
                Buffer.BlockCopy(pixels, y * stride, raw, y * (stride + 1) + 1, stride);
            }
            WriteChunk(output, "IDAT", Zlib(raw));
            WriteChunk(output, "IEND", Array.Empty<byte>());
            return output.ToArray();
        }

        private static byte[] Zlib(byte[] data)
        {
            using var stream = new MemoryStream();
            stream.WriteByte(0x78);
            stream.WriteByte(0x9C);
            using (var deflate = new DeflateStream(stream, CompressionLevel.Optimal, leaveOpen: true))
            {
                deflate.Write(data, 0, data.Length);
            }
            uint a = 1, b = 0;
            foreach (var value in data)
            {
                a = (a + value) % 65521;
                b = (b + a) % 65521;
            }
            var adler = new byte[4];
            WriteUInt32(adler, 0, (b << 16) | a);
            stream.Write(adler, 0, 4);
            return stream.ToArray();
        }

        private static void WriteChunk(Stream output, string type, byte[] data)
        {
            var length = new byte[4];
            WriteUInt32(length, 0, (uint)data.Length);
            output.Write(length, 0, 4);
            var typeBytes = new[] { (byte)type[0], (byte)type[1], (byte)type[2], (byte)type[3] };
            output.Write(typeBytes, 0, 4);
            output.Write(data, 0, data.Length);
            var crc = 0xFFFFFFFFu;
            crc = UpdateCrc(crc, typeBytes);
            crc = UpdateCrc(crc, data);
            var crcBytes = new byte[4];
            WriteUInt32(crcBytes, 0, crc ^ 0xFFFFFFFFu);
            output.Write(crcBytes, 0, 4);
        }

        private static uint UpdateCrc(uint crc, byte[] data)
        {
            foreach (var value in data) crc = CrcTable[(crc ^ value) & 0xFF] ^ (crc >> 8);
            return crc;
        }

        private static uint[] BuildCrcTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                table[n] = c;
            }
            return table;
        }

        private static void WriteUInt32(byte[] buffer, int offset, uint value)
        {
            buffer[offset] = (byte)(value >> 24);
            buffer[offset + 1] = (byte)(value >> 16);
            buffer[offset + 2] = (byte)(value >> 8);
            buffer[offset + 3] = (byte)value;
        }
    }
}
