/*
* Copyright 2016 Nu-book Inc.
* Copyright 2016 ZXing authors
* Copyright 2020 Axel Waggershauser
*/
// SPDX-License-Identifier: Apache-2.0

#include "ODReader.h"
#include "QRGenRowTrace.h"

#include "BinaryBitmap.h"
#include "ReaderOptions.h"
#include "ODCodabarReader.h"
#include "ODCode128Reader.h"
#include "ODCode39Reader.h"
#include "ODCode93Reader.h"
#include "ODDataBarExpandedReader.h"
#include "ODDataBarLimitedReader.h"
#include "ODDataBarReader.h"
#include "ODDXFilmEdgeReader.h"
#include "ODITFReader.h"
#include "ODMultiUPCEANReader.h"
#include "ODTelepenReader.h"
#include "BarcodeData.h"

#include <algorithm>
#include <utility>

#ifdef PRINT_DEBUG
#include "BitMatrix.h"
#include "BitMatrixIO.h"
#endif

namespace ZXing::OneD {

Reader::Reader(const ReaderOptions& opts) : ZXing::Reader(opts)
{
	using enum BarcodeFormat;

	_readers.reserve(8);

	if (opts.hasAnyFormat(EANUPC))
		_readers.emplace_back(new MultiUPCEANReader(opts));

	if (opts.hasAnyFormat(Code39))
		_readers.emplace_back(new Code39Reader(opts));
	if (opts.hasAnyFormat(Code93))
		_readers.emplace_back(new Code93Reader(opts));
	if (opts.hasAnyFormat(Code128))
		_readers.emplace_back(new Code128Reader(opts));
	if (opts.hasAnyFormat(ITF))
		_readers.emplace_back(new ITFReader(opts));
	if (opts.hasAnyFormat(Telepen))
		_readers.emplace_back(new TelepenReader(opts));
	if (opts.hasAnyFormat(Codabar))
		_readers.emplace_back(new CodabarReader(opts));
	if (opts.hasFormat(DataBar | DataBarOmni | DataBarStk | DataBarStkOmni))
		_readers.emplace_back(new DataBarReader(opts));
	if (opts.hasFormat(DataBar | DataBarExp | DataBarExpStk))
		_readers.emplace_back(new DataBarExpandedReader(opts));
	if (opts.hasFormat(DataBar | DataBarLtd))
		_readers.emplace_back(new DataBarLimitedReader(opts));
	if (opts.hasAnyFormat(DXFilmEdge))
		_readers.emplace_back(new DXFilmEdgeReader(opts));
}

Reader::~Reader() = default;

/**
* We're going to examine rows from the middle outward, searching alternately above and below the
* middle, and farther out each time. rowStep is the number of rows between each successive
* attempt above and below the middle. So we'd scan row middle, then middle - rowStep, then
* middle + rowStep, then middle - (2 * rowStep), etc.
* rowStep is bigger as the image is taller, but is always at least 1. We've somewhat arbitrarily
* decided that moving up and down by about 1/16 of the image is pretty good; we try more of the
* image if "trying harder".
*/
BarcodesData DoDecode(const std::vector<std::unique_ptr<RowReader>>& readers, const BinaryBitmap& image, bool tryHarder,
						 bool rotate, bool isPure, int maxSymbols, int minLineCount, bool returnErrors)
{
	BarcodesData res;
	QRT_ONLY(QRGenTrace::GroupIds qrtGroups;)

	std::vector<std::unique_ptr<RowReader::DecodingState>> decodingState(readers.size());

	int width = image.width();
	int height = image.height();

	if (rotate)
		std::swap(width, height);

	int middle = height / 2;
	// TODO: find a better heuristic/parameterization if maxSymbols != 1
	int rowStep = std::max(1, height / ((tryHarder && !isPure) ? (maxSymbols == 1 ? 256 : 512) : 32));
	int maxLines = tryHarder ?
		height :	// Look at the whole image, not just the center
		15;			// 15 rows spaced 1/32 apart is roughly the middle half of the image

	if (isPure)
		minLineCount = 1;
	else
		minLineCount = std::min(minLineCount, height);
	std::vector<int> checkRows;
	QRT_ONLY(QRGenTrace::state.pass = ++QRGenTrace::state.passes;
		QRGenTrace::state.rotate = rotate; QRGenTrace::state.reverse = false;
		QRGenTrace::state.row = 0; QRGenTrace::state.attempt = 0; QRGenTrace::state.candidate = 0;
		QRGenTrace::state.rowNumber = -1; QRGenTrace::state.reader = -1;)
	QRT("oned-pass-begin", qrt.number("scanWidth", width); qrt.number("scanHeight", height);
		qrt.number("rowStep", rowStep); qrt.number("maxLines", maxLines); qrt.number("maxSymbols", maxSymbols);
		qrt.number("minLineCount", minLineCount); qrt.boolean("tryHarder", tryHarder); qrt.boolean("isPure", isPure););
	PatternRow bars;
	bars.reserve(128); // e.g. EAN-13 has 59 bars/spaces

#ifdef PRINT_DEBUG
	BitMatrix dbg(width, height);
#endif

	for (int i = 0; i < maxLines; i++) {

		// Scanning from the middle out. Determine which row we're looking at next:
		int rowStepsAboveOrBelow = (i + 1) / 2;
		bool isAbove = (i & 0x01) == 0; // i.e. is x even?
		int rowNumber = middle + rowStep * (isAbove ? rowStepsAboveOrBelow : -rowStepsAboveOrBelow);
		bool isCheckRow = false;
		if (rowNumber < 0 || rowNumber >= height) {
			// Oops, if we run off the top or bottom, stop
			QRT("schedule-out-of-bounds", qrt.number("iteration", i); qrt.number("proposedRow", rowNumber);
				qrt.array("pendingCheckRows", checkRows););
			break;
		}

		// See if we have additional check rows (see below) to process
		if (checkRows.size()) {
			--i;
			rowNumber = checkRows.back();
			checkRows.pop_back();
			isCheckRow = true;
			if (rowNumber < 0 || rowNumber >= height) {
				QRT("check-row-out-of-bounds", qrt.number("proposedRow", rowNumber););
				continue;
			}
		}

		QRT_ONLY(QRGenTrace::state.row = ++QRGenTrace::state.rows;
			QRGenTrace::state.rowNumber = rowNumber; QRGenTrace::state.reverse = false;
			QRGenTrace::state.attempt = 0; QRGenTrace::state.candidate = 0; QRGenTrace::state.reader = -1;)
		QRT("row-attempt", qrt.number("iteration", i); qrt.boolean("checkRow", isCheckRow);
			qrt.array("pendingCheckRows", checkRows); qrt.number("scanWidth", width););
		if (!image.getPatternRow(rowNumber, rotate ? 90 : 0, bars)) {
			QRT("row-binarizer-reject", qrt.text("reason", "getPatternRow returned false"););
			continue;
		}
		QRT("row-runs", qrt.array("runs", bars););

#ifdef PRINT_DEBUG
		bool val = false;
		int x = 0;
		for (auto b : bars) {
			for(unsigned j = 0; j < b; ++j)
				dbg.set(x++, rowNumber, val);
			val = !val;
		}
#endif

		// While we have the image data in a PatternRow, it's fairly cheap to reverse it in place to
		// handle decoding upside down barcodes.
		// TODO: the DataBarExpanded (stacked) decoder depends on seeing each line from both directions. This is
		// 'surprising' and inconsistent. It also requires the decoderState to be shared between normal and reversed
		// scans, which makes no sense in general because it would mix partial detection data from two codes of the same
		// type next to each other. See also https://github.com/zxing-cpp/zxing-cpp/issues/87
		for (bool upsideDown : {false, true}) {
			// trying again?
			if (upsideDown) {
				// reverse the row and continue
				std::reverse(bars.begin(), bars.end());
			}
			QRT_ONLY(QRGenTrace::state.reverse = upsideDown;)
			QRT("row-direction", qrt.number("rotationDegrees", rotate ? 90 : 0);
				qrt.number("layerWidth", image.width()); qrt.number("layerHeight", image.height());
				qrt.number("scanWidth", width); qrt.number("scanHeight", height);
				qrt.number("originX", rotate ? rowNumber : (upsideDown ? width - 1 : 0));
				qrt.number("originY", rotate ? (upsideDown ? 0 : width - 1) : rowNumber);
				qrt.number("xStep", rotate ? 0 : (upsideDown ? -1 : 1));
				qrt.number("yStep", rotate ? (upsideDown ? 1 : -1) : 0););
			// Look for a barcode
			for (size_t r = 0; r < readers.size(); ++r) {
				// If this is a pure symbol, then checking a single non-empty line is sufficient for all but the stacked
				// DataBar codes. They are the only ones using the decodingState, which we can use as a flag here.
				if (isPure && i && !decodingState[r]) {
					QRT("pure-reader-skip", qrt.number("readerOrdinal", r););
					continue;
				}

				PatternView next(bars);
				do {
					QRT_ONLY(QRGenTrace::state.reader = static_cast<int>(r);
						QRGenTrace::state.attempt = ++QRGenTrace::state.attempts; QRGenTrace::state.candidate = 0;)
					QRT("decode-attempt", qrt.view("searchRuns", next););
					BarcodeData result = readers[r]->decodePattern(rowNumber, next, decodingState[r]);
					QRT("decode-return", qrt.number("format", result.format); qrt.boolean("valid", result.isValid());
						qrt.boolean("error", static_cast<bool>(result.error)); qrt.position("rawPosition", result.position);
						qrt.array("bytes", result.content.bytes); qrt.view("remainingRuns", next););
					if (result.isValid() || (returnErrors && result.error)) {
						result.lineCount++;
						if (upsideDown) {
							// update position (flip horizontally).
							for (auto& p : result.position) {
								p = {width - p.x - 1, p.y};
							}
						}
						if (rotate) {
							for (auto& p : result.position) {
								p = {p.y, width - p.x - 1};
							}
						}

						QRT("collector-candidate", qrt.position("position", result.position); qrt.number("lineCount", result.lineCount););
						// check if we know this code already
						for (auto& other : res) {
							if (QRT_BOOL("collector-compare", result == other,
								qrt.number("group", qrtGroups.at(&other - res.data())); qrt.position("groupPosition", other.position);
								qrt.position("incomingPosition", result.position); qrt.array("groupBytes", other.content.bytes);)) {
								QRT("collector-merge", qrt.number("group", qrtGroups.at(&other - res.data()));
									qrt.number("index", &other - res.data()); qrt.number("supportBefore", other.lineCount);
									qrt.position("positionBefore", other.position); qrt.position("incomingPosition", result.position););
								// merge the position information
								auto dTop = maxAbsComponent(other.position.topLeft() - result.position.topLeft());
								auto dBot = maxAbsComponent(other.position.bottomLeft() - result.position.topLeft());
								if (dTop < dBot || (dTop == dBot && rotate ^ (sumAbsComponent(other.position[0]) >
																			  sumAbsComponent(result.position[0])))) {
									other.position[0] = result.position[0];
									other.position[1] = result.position[1];
								} else {
									other.position[2] = result.position[2];
									other.position[3] = result.position[3];
								}
								other.lineCount++;
								QRT("collector-merged", qrt.number("group", qrtGroups.at(&other - res.data()));
									qrt.number("supportAfter", other.lineCount); qrt.position("positionAfter", other.position););
								// clear the result, so we don't insert it again below
								result = BarcodeData();
								break;
							}
						}

						if (result.format != BarcodeFormat::None) {
							QRT_ONLY(qrtGroups.inserted(res.size());)
							QRT("collector-insert", qrt.number("group", qrtGroups.at(res.size())); qrt.number("index", res.size());
								qrt.array("bytes", result.content.bytes); qrt.number("format", result.format);
								qrt.position("position", result.position); qrt.number("lineCount", result.lineCount););
							res.push_back(std::move(result));

							// if we found a valid code we have not seen before but a minLineCount > 1,
							// add additional check rows above and below the current one
							if (!isCheckRow && minLineCount > 1 && rowStep > 1) {
								checkRows = {rowNumber - 1, rowNumber + 1};
								if (rowStep > 2)
									checkRows.insert(checkRows.end(), {rowNumber - 2, rowNumber + 2});
								QRT("check-rows-replaced", qrt.array("pendingCheckRows", checkRows););
							}
						}

						if (maxSymbols && Reduce(res, 0, [&](int s, const BarcodeData& r) {
											  return s + (r.lineCount >= minLineCount);
										  }) == maxSymbols) {
							QRT("oned-budget-exit", qrt.number("maxSymbols", maxSymbols); qrt.number("groupsBeforePrune", res.size());
								qrt.array("pendingCheckRows", checkRows); qrt.number("iteration", i););
							goto out;
						}
					}
					else { QRT("collector-reject-invalid", qrt.number("format", result.format);); }
					// make sure we make progress and we start the next try on a bar
					next.shift(2 - (next.index() % 2));
					next.extend();
					QRT("cursor-advance", qrt.view("remainingRuns", next); qrt.boolean("tryHarder", tryHarder););
				} while (tryHarder && next.size());
			}
		}
	}

out:
	QRT("oned-search-end", qrt.number("groupsBeforePrune", res.size()); qrt.array("pendingCheckRows", checkRows););
	QRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) if (res[qi].lineCount < minLineCount) {
		QRT("collector-drop-support", qrt.number("group", qrtGroups.at(qi)); qrt.number("index", qi);
			qrt.number("lineCount", res[qi].lineCount); qrt.number("required", minLineCount););
	}
	qrtGroups.beforeErase(res, [&](const auto& x) { return x.lineCount < minLineCount; });)
	// remove all symbols with insufficient line count
	std::erase_if(res, [&](auto&& r) { return r.lineCount < minLineCount; });

	// if symbols overlap, remove the one with a lower line count
	for (auto a = res.begin(); a != res.end(); ++a)
		for (auto b = std::next(a); b != res.end(); ++b)
			if (HaveIntersectingBoundingBoxes(a->position, b->position)) {
				QRT("collector-drop-overlap", qrt.number("aGroup", qrtGroups.at(a - res.begin()));
					qrt.number("bGroup", qrtGroups.at(b - res.begin())); qrt.number("aSupport", a->lineCount);
					qrt.number("bSupport", b->lineCount); qrt.number("dropGroup", qrtGroups.at((a->lineCount < b->lineCount ? a : b) - res.begin()));
					qrt.position("aPosition", a->position); qrt.position("bPosition", b->position););
				*(a->lineCount < b->lineCount ? a : b) = BarcodeData();
			}

	QRT_ONLY(qrtGroups.beforeErase(res, [](const auto& x) { return x.format == BarcodeFormat::None; });)
	std::erase_if(res, [](auto&& r) { return r.format == BarcodeFormat::None; });
	QRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) {
		QRT("collector-output", qrt.number("group", qrtGroups.at(qi)); qrt.number("index", qi);
			qrt.number("lineCount", res[qi].lineCount); qrt.position("position", res[qi].position);
			qrt.array("bytes", res[qi].content.bytes); qrt.number("format", res[qi].format););
	})

#ifdef PRINT_DEBUG
	SaveAsPBM(dbg, rotate ? "od-log-r.pnm" : "od-log.pnm");
#endif

	return res;
}

BarcodesData Reader::read(const BinaryBitmap& image, int maxSymbols) const
{
	auto resH =
		DoDecode(_readers, image, _opts.tryHarder(), false, _opts.isPure(), maxSymbols, _opts.minLineCount(), _opts.returnErrors());
	QRT("orientation-gate", qrt.number("horizontalCount", resH.size()); qrt.number("maxSymbols", maxSymbols);
		qrt.boolean("tryRotate", _opts.tryRotate()); qrt.boolean("willRotate", (!maxSymbols || Size(resH) < maxSymbols) && _opts.tryRotate()););
	if ((!maxSymbols || Size(resH) < maxSymbols) && _opts.tryRotate()) {
		auto resV = DoDecode(_readers, image, _opts.tryHarder(), true, _opts.isPure(), maxSymbols - Size(resH),
								 _opts.minLineCount(), _opts.returnErrors());
		resH.insert(resH.end(), std::make_move_iterator(resV.begin()), std::make_move_iterator(resV.end()));
	}
	return resH;
}

} // namespace ZXing::OneD
