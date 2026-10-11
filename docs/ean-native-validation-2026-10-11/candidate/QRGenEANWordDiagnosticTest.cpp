// Diagnostic-only extracted private helpers; no public reader API export.
// SPDX-License-Identifier: Apache-2.0
#include "oned/ODRowReader.h"
#include "oned/ODUPCEANCommon.h"
#include "gtest/gtest.h"
#include <algorithm>
#include <array>
#include <cstdint>

namespace ZXing::OneD {
static const int FIRST_DIGIT_ENCODINGS[] = {0x00, 0x0B, 0x0D, 0x0E, 0x13, 0x19, 0x1C, 0x15, 0x16, 0x1A};
static constexpr float MAX_AVG_VARIANCE = 0.48f;
static constexpr float MAX_INDIVIDUAL_VARIANCE = 0.7f;
template <typename Patterns>
static int DecodeDigitAndBestMatches(const PatternView& view, const Patterns& patterns, uint32_t& bestMatches)
{
	float bestVariance = MAX_AVG_VARIANCE;
	int bestMatch = -1;
	bestMatches = 0;
	for (int i = 0; i < Size(patterns); ++i) {
		float variance =
			RowReader::PatternMatchVariance(view.data(), patterns[i].data(), patterns[i].size(), MAX_INDIVIDUAL_VARIANCE);
		if (variance < bestVariance) {
			bestVariance = variance;
			bestMatch = i;
			bestMatches = uint32_t{1} << i;
		} else if (bestMatch != -1 && variance == bestVariance) {
			bestMatches |= uint32_t{1} << i;
		}
	}
	return bestMatch;
}

static bool HasMultipleValidEAN13Words(const std::array<uint32_t, 12>& matches)
{
	bool hasTie = false;
	for (auto mask : matches)
		hasTie |= (mask & (mask - 1)) != 0;
	if (!hasTie)
		return false;

	// Left-hand states retain parity and checksum residue. Counts saturate at2:
	// every full EAN13 word has exactly one valid digit/parity encoding path.
	std::array<uint8_t, 64 * 10> states = {};
	states[0] = 1;
	for (int digit = 0; digit < 6; ++digit) {
		std::array<uint8_t, 64 * 10> next = {};
		for (int parity = 0; parity < (1 << digit); ++parity)
			for (int residue = 0; residue < 10; ++residue) {
				auto count = states[parity * 10 + residue];
				if (!count)
					continue;
				for (int pattern = 0; pattern < 20; ++pattern)
					if (matches[digit] & (uint32_t{1} << pattern)) {
						int p = (parity << 1) | (pattern >= 10);
						int r = (residue + (pattern % 10) * (digit % 2 == 0 ? 3 : 1)) % 10;
						auto& dest = next[p * 10 + r];
						dest = static_cast<uint8_t>(std::min(2, int(dest) + count));
					}
			}
		states = next;
	}

	std::array<uint8_t, 10> counts = {};
	for (int parity = 0; parity < 64; ++parity) {
		int lead = IndexOf(FIRST_DIGIT_ENCODINGS, parity);
		if (lead == -1)
			continue;
		for (int residue = 0; residue < 10; ++residue) {
			auto& dest = counts[(residue + lead) % 10];
			dest = static_cast<uint8_t>(std::min(2, int(dest) + states[parity * 10 + residue]));
		}
	}
	for (int digit = 6; digit < 12; ++digit) {
		std::array<uint8_t, 10> next = {};
		for (int residue = 0; residue < 10; ++residue) {
			if (!counts[residue])
				continue;
			for (int pattern = 0; pattern < 10; ++pattern)
				if (matches[digit] & (uint32_t{1} << pattern)) {
					int r = (residue + pattern * (digit % 2 == 0 ? 3 : 1)) % 10;
					auto& dest = next[r];
					dest = static_cast<uint8_t>(std::min(2, int(dest) + counts[residue]));
				}
		}
		counts = next;
	}
	return counts[0] > 1;
}

TEST(QRGenEANWordBoundary, EmptyMasks)
{
    const std::array<uint32_t, 12> masks = {{0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, ValidSingleton)
{
    const std::array<uint32_t, 12> masks = {{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, InvalidSingletonStillNotAmbiguous)
{
    const std::array<uint32_t, 12> masks = {{1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u, 1u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, ChromeTwoValidWords)
{
    const std::array<uint32_t, 12> masks = {{128u, 262656u, 1280u, 256u, 1280u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), true);
}
TEST(QRGenEANWordBoundary, Confirmed35OnlyOneValidWord)
{
    const std::array<uint32_t, 12> masks = {{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, ChecksumRejectsExtraChoice)
{
    const std::array<uint32_t, 12> masks = {{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 12u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, InvalidLeftParityWithTie)
{
    const std::array<uint32_t, 12> masks = {{1024u, 1024u, 1024u, 1024u, 1024u, 1024u, 1u, 1u, 1u, 1u, 1u, 3u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, HighestLegalBitIndices)
{
    const std::array<uint32_t, 12> masks = {{512u, 524288u, 524288u, 512u, 524288u, 512u, 512u, 512u, 512u, 512u, 512u, 528u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), false);
}
TEST(QRGenEANWordBoundary, DenseMasksSaturate)
{
    const std::array<uint32_t, 12> masks = {{1048575u, 1048575u, 1048575u, 1048575u, 1048575u, 1048575u, 1023u, 1023u, 1023u, 1023u, 1023u, 1023u}};
    EXPECT_EQ(HasMultipleValidEAN13Words(masks), true);
}
TEST(QRGenEANWordBoundary, AllFrozenRealRowMasks)
{
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:144:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:145:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:146:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:147:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:150:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:156:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:157:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:158:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:159:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:160:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:161:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:162:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:163:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:164:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:165:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:166:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:167:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:168:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:169:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:170:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:171:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:172:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:173:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:174:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:175:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:179:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:180:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:181:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:182:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:183:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:184:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:185:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:186:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:187:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:189:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:190:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:191:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:192:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:193:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:194:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:196:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 1040u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:197:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:198:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:199:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:200:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:201:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:204:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:205:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:206:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:207:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:208:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:209:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:210:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:211:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:215:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:216:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:218:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:219:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:221:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:222:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:223:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:224:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:225:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:226:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:227:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:228:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:229:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:230:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:231:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:232:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:233:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:234:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:235:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:239:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:240:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:241:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:242:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:243:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:245:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:246:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:247:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:248:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:249:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:250:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:251:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:252:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:258:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:261:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:263:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:264:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:265:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:266:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:267:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:268:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:269:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:270:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:271:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:273:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:274:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:278:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:279:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:280:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:283:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:288:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:290:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:291:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-original:horizontal:294:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262656u, 1280u, 256u, 1280u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), true) << "ean13-2-07-chrome-full:horizontal:207:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262656u, 1280u, 256u, 1280u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), true) << "ean13-2-07-chrome-full:horizontal:209:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:144:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:145:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:146:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:157:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:158:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:159:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:160:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:161:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:162:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:163:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:164:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:165:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:166:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:167:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:168:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:169:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:170:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:171:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:172:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:173:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:174:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:175:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:178:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:179:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:180:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:181:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:182:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:183:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:184:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:185:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:186:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:187:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:188:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:189:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:190:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:191:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:192:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:193:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:196:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:197:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:198:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:199:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:200:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:201:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:203:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:204:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:205:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:206:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:207:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:208:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:209:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:210:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:211:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:215:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:216:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:217:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:218:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:219:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:220:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:221:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:222:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:223:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:224:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:225:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:226:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:227:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:228:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:229:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:230:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:231:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:232:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:233:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:234:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:235:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:236:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:238:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:240:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:241:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:242:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:243:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:244:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:245:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:246:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:247:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:248:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:249:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:250:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:251:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:252:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:258:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:261:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:263:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:264:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:265:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:266:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:267:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:269:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:270:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:271:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:273:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:274:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:278:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:280:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:283:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:288:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:289:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{128u, 262144u, 1024u, 256u, 1024u, 16u, 256u, 2u, 64u, 64u, 8u, 4u}}), false) << "ean13-2-07-chrome-source-crop:horizontal:291:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:241:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:244:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:264:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:300:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:301:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:302:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:303:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 131104u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:307:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 131104u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:316:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 131104u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:317:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-original:vertical:413:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:241:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:243:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:244:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:264:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1040u, 393216u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:265:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 131104u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:296:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:301:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:302:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:303:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 131104u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:307:False";
    EXPECT_EQ(HasMultipleValidEAN13Words(std::array<uint32_t, 12>{{1u, 8192u, 1024u, 2u, 32u, 524288u, 1u, 1u, 8u, 512u, 8u, 1u}}), false) << "ean13-1-35-derived:vertical:413:False";
}
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
