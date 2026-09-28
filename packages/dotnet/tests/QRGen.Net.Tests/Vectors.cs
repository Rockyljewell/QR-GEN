// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

namespace QRGen.Tests
{
    internal static class Vectors
    {
        /// <summary>SPEC section 3.2 GS1 vector.</summary>
        public const string Gs1 = "(01)09501101530003(17)250101(10)ABC123";

        /// <summary>SPEC section 3.3 AAMVA vector (fictional data).</summary>
        public const string Aamva =
            "@\n\u001e\rANSI 636014100002DL00410279ZC03200024DLDAQD1234567\nDCSSAMPLE\nDACJANE\nDADQ\n" +
            "DBB01311990\nDBA01312028\nDBD02012020\nDBC2\nDAYBRO\nDAU065 IN\nDAG123 MAIN ST\n" +
            "DAISACRAMENTO\nDAJCA\nDAK958140000\nDCGUSA\n\rZCZCAA\r";
    }
}
