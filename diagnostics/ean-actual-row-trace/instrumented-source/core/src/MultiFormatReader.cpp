/*
* Copyright 2016 Nu-book Inc.
* Copyright 2016 ZXing authors
*/
// SPDX-License-Identifier: Apache-2.0

#include "MultiFormatReader.h"
#include "QRGenRowTrace.h"

#include "BarcodeFormat.h"
#include "BinaryBitmap.h"
#include "Reader.h"
#include "ReaderOptions.h"
#include "Version.h"

#if ZXING_ENABLE_AZTEC
#include "aztec/AZReader.h"
#endif
#if ZXING_ENABLE_DATAMATRIX
#include "datamatrix/DMReader.h"
#endif
#if ZXING_ENABLE_MAXICODE
#include "maxicode/MCReader.h"
#endif
#if ZXING_ENABLE_1D
#include "oned/ODReader.h"
#endif
#if ZXING_ENABLE_PDF417
#include "pdf417/PDFReader.h"
#include "pdf417/MicroPDFReader.h"
#endif
#if ZXING_ENABLE_QRCODE
#include "qrcode/QRReader.h"
#endif

#include <memory>

namespace ZXing {

MultiFormatReader::MultiFormatReader(const ReaderOptions& opts) : _opts(opts)
{
	using enum BarcodeFormat;

	// Put linear readers upfront in "normal" mode
#if ZXING_ENABLE_1D
	if (!opts.tryHarder() && opts.hasAnyFormat(AllLinear))
		_readers.emplace_back(new OneD::Reader(opts));
#endif

#if ZXING_ENABLE_QRCODE
	if (opts.hasAnyFormat(QRCode))
		_readers.emplace_back(new QRCode::Reader(opts, true));
#endif
#if ZXING_ENABLE_DATAMATRIX
	if (opts.hasAnyFormat(DataMatrix))
		_readers.emplace_back(new DataMatrix::Reader(opts, true));
#endif
#if ZXING_ENABLE_AZTEC
	if (opts.hasAnyFormat(Aztec))
		_readers.emplace_back(new Aztec::Reader(opts, true));
#endif
#if ZXING_ENABLE_PDF417
	if (opts.hasFormat(PDF417 | CompactPDF417))
		_readers.emplace_back(new Pdf417::Reader(opts));
	if (opts.hasFormat(MicroPDF417))
		_readers.emplace_back(new MicroPdf417::Reader(opts));
#endif
#if ZXING_ENABLE_MAXICODE
	if (opts.hasAnyFormat(MaxiCode))
		_readers.emplace_back(new MaxiCode::Reader(opts));
#endif

	// At end in "try harder" mode
#if ZXING_ENABLE_1D
	if (opts.tryHarder() && opts.hasAnyFormat(AllLinear))
		_readers.emplace_back(new OneD::Reader(opts));
#endif
}

MultiFormatReader::~MultiFormatReader() = default;

Barcodes MultiFormatReader::read(const BinaryBitmap& image, int maxSymbols) const
{
	Barcodes res;

	for (const auto& reader : _readers) {
		QRT("reader-dispatch", qrt.number("readerOrdinal", &reader - _readers.data());
			qrt.number("remainingBudget", maxSymbols); qrt.boolean("inverted", image.inverted());
			qrt.boolean("supportsInversion", reader->supportsInversion););
		if (image.inverted() && !reader->supportsInversion)
			continue;
		auto r = reader->read(image, maxSymbols);
		QRT("reader-return", qrt.number("countBeforeErrorFilter", r.size()););
		QRT_ONLY(for (size_t qi = 0; qi < r.size(); ++qi) if (!_opts.returnErrors() && !r[qi].isValid()) {
			QRT("reader-discard-error", qrt.number("index", qi); qrt.position("position", r[qi].position()););
		})
		if (!_opts.returnErrors())
			std::erase_if(r, [](auto&& s) { return !s.isValid(); });
		maxSymbols -= Size(r);
		res.insert(res.end(), std::move_iterator(r.begin()), std::move_iterator(r.end()));
		if (maxSymbols <= 0) {
			QRT("reader-budget-exit", qrt.number("count", res.size()); qrt.number("remainingBudget", maxSymbols););
			break;
		}
	}

	// sort barcodes based on their position on the image
	std::sort(res.begin(), res.end(), [](const Barcode& l, const Barcode& r) {
		auto lp = l.position().topLeft();
		auto rp = r.position().topLeft();
		return lp.y < rp.y || (lp.y == rp.y && lp.x < rp.x);
	});

	QRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) {
		QRT("reader-sorted-output", qrt.number("index", qi); qrt.position("position", res[qi].position());
			qrt.number("format", res[qi].format()); qrt.number("lineCount", res[qi].lineCount()););
	})
	return res;
}

} // ZXing
