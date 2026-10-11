"""Add diagnostic tests to an isolated pinned C++ checkout, never a product checkout.

The test-only TU compiles exact private helper/collector source bodies. The
reader TU and its public API remain unchanged after applying the candidate.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

checkout = Path(sys.argv[1]).resolve()
fixtures = Path(sys.argv[2]).resolve()
output = Path(sys.argv[3]).resolve()
source_path = checkout / 'core/src/oned/ODMultiUPCEANReader.cpp'
source = source_path.read_bytes()
expected = 'b9cd713e52c5579fa9366f6b7c89f5012b10b1510a5c81fb01e2145f57cd46ce'
if hashlib.sha256(source).hexdigest() != expected:
    raise ValueError('Candidate source fingerprint does not match the reviewed patch')
if hashlib.sha256(fixtures.read_bytes()).hexdigest() != '1ac9edbb4121f99890186a274015e61adb12d9947c17a09badccb407e35411a6':
    raise ValueError('Frozen helper-test fixture fingerprint does not match')
data = json.loads(fixtures.read_text(encoding='utf-8'))
if data['candidateSha256'] != expected or len(data['realRows']) != 238:
    raise ValueError('Unexpected frozen helper-test fixtures')
text = source.decode('utf-8')
constants = re.search(r'static const int FIRST_DIGIT_ENCODINGS\[\] = .*?;', text).group()
variances = re.search(r'static constexpr float MAX_AVG_VARIANCE.*?MAX_INDIVIDUAL_VARIANCE = .*?;', text, re.S).group()
start = text.index('template <typename Patterns>\nstatic int DecodeDigitAndBestMatches')
end = text.index('\nstatic bool DecodeDigit(', start)
helpers = text[start:end]

def initializer(masks):
    return '{{' + ', '.join(f'{x}u' for x in masks) + '}}'

body = '''// Diagnostic-only extracted private helpers; no public reader API export.
// SPDX-License-Identifier: Apache-2.0
#include "oned/ODRowReader.h"
#include "oned/ODUPCEANCommon.h"
#include "gtest/gtest.h"
#include <algorithm>
#include <array>
#include <cstdint>

namespace ZXing::OneD {
'''
body += constants + '\n' + variances + '\n' + helpers + '\n'
for case in data['cases']:
    body += f'''TEST(QRGenEANWordBoundary, {case['name']})
{{
    const std::array<uint32_t, 12> masks = {initializer(case['masks'])};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), {str(case['multiple']).lower()});
}}
'''
body += 'TEST(QRGenEANWordBoundary, AllFrozenRealRowMasks)\n{\n'
for row in data['realRows']:
    label = f"{row['id']}:{row['axis']}:{row['row']}:{row['reverse']}"
    body += f'    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{initializer(row["masks"])}), {str(row["multiple"]).lower()}) << "{label}";\n'
body += '''}
TEST(QRGenEANWordCollector, EveryExactTablePatternRetainsBaselineWinner)
{
    for (int i = 0; i < 20; ++i) {
        const auto& p = UPCEANCommon::L_AND_G_PATTERNS[i];
        const Pattern<4> counters{static_cast<uint16_t>(p[0]), static_cast<uint16_t>(p[1]),
                                  static_cast<uint16_t>(p[2]), static_cast<uint16_t>(p[3])};
        uint32_t mask = 0;
        EXPECT_EQ(DecodeDigitAndBestMatches(PatternView(counters), UPCEANCommon::L_AND_G_PATTERNS, mask), i);
        EXPECT_EQ(mask, uint32_t{1} << i);
        EXPECT_EQ(RowReader::DecodeDigit(PatternView(counters), UPCEANCommon::L_AND_G_PATTERNS,
                                        MAX_AVG_VARIANCE, MAX_INDIVIDUAL_VARIANCE, false), i);
    }
}
TEST(QRGenEANWordCollector, RealChromeExactTieRetainsFirstWinner)
{
    const Pattern<4> counters{7, 3, 4, 4};
    uint32_t mask = 0;
    EXPECT_EQ(DecodeDigitAndBestMatches(PatternView(counters), UPCEANCommon::L_AND_G_PATTERNS, mask), 9);
    EXPECT_EQ(mask, (uint32_t{1} << 9) | (uint32_t{1} << 18));
    EXPECT_EQ(RowReader::DecodeDigit(PatternView(counters), UPCEANCommon::L_AND_G_PATTERNS,
                                    MAX_AVG_VARIANCE, MAX_INDIVIDUAL_VARIANCE, false), 9);
}
TEST(QRGenEANWordCollector, ThresholdOnlyTieIsNotAccepted)
{
    // Generic patterns isolate the strict average threshold; not an EAN label.
    const Pattern<4> counters{8, 2, 8, 7};
    const std::array<std::array<int, 4>, 2> patterns{{{{1, 1, 1, 2}}, {{1, 1, 1, 2}}}};
    EXPECT_EQ(RowReader::PatternMatchVariance(counters, patterns[0], MAX_INDIVIDUAL_VARIANCE), MAX_AVG_VARIANCE);
    uint32_t mask = 123;
    EXPECT_EQ(DecodeDigitAndBestMatches(PatternView(counters), patterns, mask), -1);
    EXPECT_EQ(mask, 0u);
}
TEST(QRGenEANWordCollector, TooShortCountersHaveNoMask)
{
    const Pattern<4> counters{1, 1, 1, 1};
    uint32_t mask = 123;
    EXPECT_EQ(DecodeDigitAndBestMatches(PatternView(counters), UPCEANCommon::L_AND_G_PATTERNS, mask), -1);
    EXPECT_EQ(mask, 0u);
}
} // namespace ZXing::OneD
'''
target = checkout / 'test/unit/QRGenEANWordDiagnosticTest.cpp'
target.write_text(body, encoding='utf-8', newline='\n')
cmake = checkout / 'test/unit/CMakeLists.txt'
with cmake.open('a', encoding='utf-8') as handle:
    handle.write('\n# Isolated diagnostic helper tests; not a production API.\n')
    handle.write('target_sources(UnitTest PRIVATE "${CMAKE_CURRENT_LIST_DIR}/QRGenEANWordDiagnosticTest.cpp")\n')
output.mkdir(parents=True, exist_ok=True)
metadata = {
    'scope': 'Candidate-only test TU compiles exact private helper/collector source bodies; the reader TU source is unchanged. This is helper compilation plus the upstream unit suite, not a full blackbox confidence guarantee.',
    'candidateSourceSha256': expected,
    'testFixtureSha256': hashlib.sha256(fixtures.read_bytes()).hexdigest(),
    'extractedHelperSha256': hashlib.sha256(helpers.encode()).hexdigest(),
    'generatedTestSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'addedGoogleTests': 14,
    'frozenRealRows': len(data['realRows']),
    'boundaryCases': len(data['cases']),
}
(output / 'helper-test-provenance.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print(json.dumps(metadata))
