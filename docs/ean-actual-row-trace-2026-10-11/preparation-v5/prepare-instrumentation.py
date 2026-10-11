"""Prepare an instrumentation-only patch from retained, hash-pinned upstream bytes.
Does not build, import a reader, decode, or modify any repository/source snapshot.
"""
from pathlib import Path
import hashlib, json, difflib

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'ean-cpp-source-trace'
CPP = '2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4'
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest = json.loads((SOURCE / 'source-manifest.json').read_text())
assert manifest['commit'] == CPP
pins = {x['path']: x['sha256'] for x in manifest['files']}
names = ['core/src/ReadBarcode.cpp', 'core/src/MultiFormatReader.cpp', 'core/src/Pattern.h', 'core/src/GlobalHistogramBinarizer.cpp',
         'core/src/oned/ODReader.cpp', 'core/src/oned/ODRowReader.h', 'core/src/oned/ODMultiUPCEANReader.cpp']
files = {}
for name in names:
    raw = (SOURCE / name).read_bytes()
    assert sha(raw) == pins[name], name
    assert b'\r' not in raw, 'Pinned upstream files must be LF bytes: ' + name
    files[name] = raw.decode()
original = files.copy()

def once(name, old, new):
    assert files[name].count(old) == 1, (name, old[:100], files[name].count(old))
    files[name] = files[name].replace(old, new, 1)

for name in names:
    anchor = '#pragma once\n' if name.endswith('.h') else files[name][files[name].index('#include '):].splitlines()[0] + '\n'
    once(name, anchor, anchor + '#include "QRGenRowTrace.h"\n')

n = 'core/src/ReadBarcode.cpp'
once(n, 'Barcodes ReadBarcodes(const ImageView& _iv, const ReaderOptions& opts)\n{', '''Barcodes ReadBarcodes(const ImageView& _iv, const ReaderOptions& opts)
{
\tQRT_ONLY(QRGenTrace::Call qrtCall(_iv.width(), _iv.height());)
\tQRT("options", qrt.boolean("tryHarder", opts.tryHarder()); qrt.boolean("tryRotate", opts.tryRotate());
\t\tqrt.boolean("tryInvert", opts.tryInvert()); qrt.boolean("tryDownscale", opts.tryDownscale());
\t\tqrt.boolean("isPure", opts.isPure()); qrt.boolean("returnErrors", opts.returnErrors());
\t\tqrt.number("maxSymbols", opts.maxNumberOfSymbols()); qrt.number("minLineCount", opts.minLineCount());
\t\tqrt.number("binarizer", opts.binarizer()); qrt.number("eanAddon", opts.eanAddOnSymbol()););''')
once(n, '\tfor (auto&& iv : pyramid.layers) {', '''\tfor (auto&& iv : pyramid.layers) {
\t\tQRT_ONLY(QRGenTrace::state.layerWidth = iv.width(); QRGenTrace::state.layerHeight = iv.height();)
\t\tQRT("layer", qrt.number("width", iv.width()); qrt.number("height", iv.height());
\t\t\tqrt.number("originalWidth", _iv.width()); qrt.number("originalHeight", _iv.height()););''')
once(n, '\t\t\t\tauto rs = (close ? *closedReader : reader).read(*bitmap, maxSymbols);', '''\t\t\t\tQRT_ONLY(QRGenTrace::state.close = close; QRGenTrace::state.invert = invert;)
\t\t\t\tQRT("bitmap-pass", qrt.number("close", close); qrt.number("invert", invert);
\t\t\t\t\tqrt.boolean("bitmapInverted", bitmap->inverted()); qrt.number("remainingBudget", maxSymbols););
\t\t\t\tauto rs = (close ? *closedReader : reader).read(*bitmap, maxSymbols);
\t\t\t\tQRT("bitmap-result", qrt.number("count", rs.size()););''')
once(n, '\t\t\t\t\tif (!Contains(res, r)) {', '''\t\t\t\t\tQRT("global-candidate", qrt.number("ordinal", &r - rs.data()); qrt.position("position", r.position());
\t\t\t\t\t\tqrt.number("format", r.format()); qrt.number("lineCount", r.lineCount()););
\t\t\t\t\tif (!Contains(res, r)) {
\t\t\t\t\t\tQRT("global-insert", qrt.number("index", res.size()); qrt.number("budgetBefore", maxSymbols););''')
once(n, '\t\t\t\t\t\t--maxSymbols;\n\t\t\t\t\t}', '''\t\t\t\t\t\t--maxSymbols;
\t\t\t\t\t} else {
\t\t\t\t\t\tQRT("global-duplicate", qrt.position("position", r.position()););
\t\t\t\t\t}''')
once(n, '\t\t\t\tif (maxSymbols <= 0)\n\t\t\t\t\treturn res;', '''\t\t\t\tif (maxSymbols <= 0) {
\t\t\t\t\tQRT("global-budget-exit", qrt.number("count", res.size()); qrt.number("remainingBudget", maxSymbols););
\t\t\t\t\treturn res;
\t\t\t\t}''')

n = 'core/src/MultiFormatReader.cpp'
once(n, '\tfor (const auto& reader : _readers) {', '''\tfor (const auto& reader : _readers) {
\t\tQRT("reader-dispatch", qrt.number("readerOrdinal", &reader - _readers.data());
\t\t\tqrt.number("remainingBudget", maxSymbols); qrt.boolean("inverted", image.inverted());
\t\t\tqrt.boolean("supportsInversion", reader->supportsInversion););''')
once(n, '\t\tauto r = reader->read(image, maxSymbols);', '''\t\tauto r = reader->read(image, maxSymbols);
\t\tQRT("reader-return", qrt.number("countBeforeErrorFilter", r.size()););
\t\tQRT_ONLY(for (size_t qi = 0; qi < r.size(); ++qi) if (!_opts.returnErrors() && !r[qi].isValid()) {
\t\t\tQRT("reader-discard-error", qrt.number("index", qi); qrt.position("position", r[qi].position););
\t\t})''')
once(n, '\t\tif (maxSymbols <= 0)\n\t\t\tbreak;', '''\t\tif (maxSymbols <= 0) {
\t\t\tQRT("reader-budget-exit", qrt.number("count", res.size()); qrt.number("remainingBudget", maxSymbols););
\t\t\tbreak;
\t\t}''')
once(n, '\treturn res;\n}', '''\tQRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) {
\t\tQRT("reader-sorted-output", qrt.number("index", qi); qrt.position("position", res[qi].position());
\t\t\tqrt.number("format", res[qi].format()); qrt.number("lineCount", res[qi].lineCount()););
\t})
\treturn res;
}''')

n = 'core/src/oned/ODReader.cpp'
once(n, '\tBarcodesData res;\n', '\tBarcodesData res;\n\tQRT_ONLY(QRGenTrace::GroupIds qrtGroups;)\n')
once(n, '\tstd::vector<int> checkRows;\n', '''\tstd::vector<int> checkRows;
\tQRT_ONLY(QRGenTrace::state.pass = ++QRGenTrace::state.passes;
\t\tQRGenTrace::state.rotate = rotate; QRGenTrace::state.reverse = false;
\t\tQRGenTrace::state.row = 0; QRGenTrace::state.attempt = 0; QRGenTrace::state.candidate = 0;
\t\tQRGenTrace::state.rowNumber = -1; QRGenTrace::state.reader = -1;)
\tQRT("oned-pass-begin", qrt.number("scanWidth", width); qrt.number("scanHeight", height);
\t\tqrt.number("rowStep", rowStep); qrt.number("maxLines", maxLines); qrt.number("maxSymbols", maxSymbols);
\t\tqrt.number("minLineCount", minLineCount); qrt.boolean("tryHarder", tryHarder); qrt.boolean("isPure", isPure););''')
once(n, '\t\t\t// Oops, if we run off the top or bottom, stop\n\t\t\tbreak;', '''\t\t\t// Oops, if we run off the top or bottom, stop
\t\t\tQRT("schedule-out-of-bounds", qrt.number("iteration", i); qrt.number("proposedRow", rowNumber);
\t\t\t\tqrt.array("pendingCheckRows", checkRows););
\t\t\tbreak;''')
once(n, '\t\t\tif (rowNumber < 0 || rowNumber >= height)\n\t\t\t\tcontinue;', '''\t\t\tif (rowNumber < 0 || rowNumber >= height) {
\t\t\t\tQRT("check-row-out-of-bounds", qrt.number("proposedRow", rowNumber););
\t\t\t\tcontinue;
\t\t\t}''')
once(n, '\t\tif (!image.getPatternRow(rowNumber, rotate ? 90 : 0, bars))\n\t\t\tcontinue;', '''\t\tQRT_ONLY(QRGenTrace::state.row = ++QRGenTrace::state.rows;
\t\t\tQRGenTrace::state.rowNumber = rowNumber; QRGenTrace::state.reverse = false;
\t\t\tQRGenTrace::state.attempt = 0; QRGenTrace::state.candidate = 0; QRGenTrace::state.reader = -1;)
\t\tQRT("row-attempt", qrt.number("iteration", i); qrt.boolean("checkRow", isCheckRow);
\t\t\tqrt.array("pendingCheckRows", checkRows); qrt.number("scanWidth", width););
\t\tif (!image.getPatternRow(rowNumber, rotate ? 90 : 0, bars)) {
\t\t\tQRT("row-binarizer-reject", qrt.text("reason", "getPatternRow returned false"););
\t\t\tcontinue;
\t\t}
\t\tQRT("row-runs", qrt.array("runs", bars););''')
once(n, '\t\t\t// Look for a barcode\n', '''\t\t\tQRT_ONLY(QRGenTrace::state.reverse = upsideDown;)
\t\t\tQRT("row-direction", qrt.number("rotationDegrees", rotate ? 90 : 0);
\t\t\t\tqrt.number("layerWidth", image.width()); qrt.number("layerHeight", image.height());
\t\t\t\tqrt.number("scanWidth", width); qrt.number("scanHeight", height);
\t\t\t\tqrt.number("originX", rotate ? rowNumber : (upsideDown ? width - 1 : 0));
\t\t\t\tqrt.number("originY", rotate ? (upsideDown ? 0 : width - 1) : rowNumber);
\t\t\t\tqrt.number("xStep", rotate ? 0 : (upsideDown ? -1 : 1));
\t\t\t\tqrt.number("yStep", rotate ? (upsideDown ? 1 : -1) : 0););
\t\t\t// Look for a barcode
''')
once(n, '\t\t\t\tif (isPure && i && !decodingState[r])\n\t\t\t\t\tcontinue;', '''\t\t\t\tif (isPure && i && !decodingState[r]) {
\t\t\t\t\tQRT("pure-reader-skip", qrt.number("readerOrdinal", r););
\t\t\t\t\tcontinue;
\t\t\t\t}''')
once(n, '\t\t\t\t\tBarcodeData result = readers[r]->decodePattern(rowNumber, next, decodingState[r]);', '''\t\t\t\t\tQRT_ONLY(QRGenTrace::state.reader = static_cast<int>(r);
\t\t\t\t\t\tQRGenTrace::state.attempt = ++QRGenTrace::state.attempts; QRGenTrace::state.candidate = 0;)
\t\t\t\t\tQRT("decode-attempt", qrt.view("searchRuns", next););
\t\t\t\t\tBarcodeData result = readers[r]->decodePattern(rowNumber, next, decodingState[r]);
\t\t\t\t\tQRT("decode-return", qrt.number("format", result.format); qrt.boolean("valid", result.isValid());
\t\t\t\t\t\tqrt.boolean("error", static_cast<bool>(result.error)); qrt.position("rawPosition", result.position);
\t\t\t\t\t\tqrt.array("bytes", result.content.bytes); qrt.view("remainingRuns", next););''')
once(n, '\t\t\t\t\t\t// check if we know this code already\n', '''\t\t\t\t\t\tQRT("collector-candidate", qrt.position("position", result.position); qrt.number("lineCount", result.lineCount););
\t\t\t\t\t\t// check if we know this code already
''')
once(n, '\t\t\t\t\t\t\tif (result == other) {', '''\t\t\t\t\t\t\tif (QRT_BOOL("collector-compare", result == other,
\t\t\t\t\t\t\t\tqrt.number("group", qrtGroups.at(&other - res.data())); qrt.position("groupPosition", other.position);
\t\t\t\t\t\t\t\tqrt.position("incomingPosition", result.position); qrt.array("groupBytes", other.content.bytes);)) {
\t\t\t\t\t\t\t\tQRT("collector-merge", qrt.number("group", qrtGroups.at(&other - res.data()));
\t\t\t\t\t\t\t\t\tqrt.number("index", &other - res.data()); qrt.number("supportBefore", other.lineCount);
\t\t\t\t\t\t\t\t\tqrt.position("positionBefore", other.position); qrt.position("incomingPosition", result.position););''')
once(n, '\t\t\t\t\t\t\t\tother.lineCount++;', '''\t\t\t\t\t\t\t\tother.lineCount++;
\t\t\t\t\t\t\t\tQRT("collector-merged", qrt.number("group", qrtGroups.at(&other - res.data()));
\t\t\t\t\t\t\t\t\tqrt.number("supportAfter", other.lineCount); qrt.position("positionAfter", other.position););''')
once(n, '\t\t\t\t\t\t\tres.push_back(std::move(result));', '''\t\t\t\t\t\t\tQRT_ONLY(qrtGroups.inserted(res.size());)
\t\t\t\t\t\t\tQRT("collector-insert", qrt.number("group", qrtGroups.at(res.size())); qrt.number("index", res.size());
\t\t\t\t\t\t\t\tqrt.array("bytes", result.content.bytes); qrt.number("format", result.format);
\t\t\t\t\t\t\t\tqrt.position("position", result.position); qrt.number("lineCount", result.lineCount););
\t\t\t\t\t\t\tres.push_back(std::move(result));''')
once(n, '\t\t\t\t\t\t\t\t\tcheckRows.insert(checkRows.end(), {rowNumber - 2, rowNumber + 2});', '''\t\t\t\t\t\t\t\t\tcheckRows.insert(checkRows.end(), {rowNumber - 2, rowNumber + 2});
\t\t\t\t\t\t\t\tQRT("check-rows-replaced", qrt.array("pendingCheckRows", checkRows););''')
once(n, '\t\t\t\t\t\t\tgoto out;', '''\t\t\t\t\t\t\tQRT("oned-budget-exit", qrt.number("maxSymbols", maxSymbols); qrt.number("groupsBeforePrune", res.size());
\t\t\t\t\t\t\t\tqrt.array("pendingCheckRows", checkRows); qrt.number("iteration", i););
\t\t\t\t\t\t\tgoto out;''')
once(n, '\t\t\t\t\t// make sure we make progress and we start the next try on a bar', '''\t\t\t\t\telse { QRT("collector-reject-invalid", qrt.number("format", result.format);); }
\t\t\t\t\t// make sure we make progress and we start the next try on a bar''')
once(n, '\t\t\t\t\tnext.extend();', '''\t\t\t\t\tnext.extend();
\t\t\t\t\tQRT("cursor-advance", qrt.view("remainingRuns", next); qrt.boolean("tryHarder", tryHarder););''')
once(n, 'out:\n\t// remove all symbols', '''out:
\tQRT("oned-search-end", qrt.number("groupsBeforePrune", res.size()); qrt.array("pendingCheckRows", checkRows););
\tQRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) if (res[qi].lineCount < minLineCount) {
\t\tQRT("collector-drop-support", qrt.number("group", qrtGroups.at(qi)); qrt.number("index", qi);
\t\t\tqrt.number("lineCount", res[qi].lineCount); qrt.number("required", minLineCount););
\t}
\tqrtGroups.beforeErase(res, [&](const auto& x) { return x.lineCount < minLineCount; });)
\t// remove all symbols''')
once(n, '\t\t\tif (HaveIntersectingBoundingBoxes(a->position, b->position))\n\t\t\t\t*(a->lineCount < b->lineCount ? a : b) = BarcodeData();', '''\t\t\tif (HaveIntersectingBoundingBoxes(a->position, b->position)) {
\t\t\t\tQRT("collector-drop-overlap", qrt.number("aGroup", qrtGroups.at(a - res.begin()));
\t\t\t\t\tqrt.number("bGroup", qrtGroups.at(b - res.begin())); qrt.number("aSupport", a->lineCount);
\t\t\t\t\tqrt.number("bSupport", b->lineCount); qrt.number("dropGroup", qrtGroups.at((a->lineCount < b->lineCount ? a : b) - res.begin()));
\t\t\t\t\tqrt.position("aPosition", a->position); qrt.position("bPosition", b->position););
\t\t\t\t*(a->lineCount < b->lineCount ? a : b) = BarcodeData();
\t\t\t}''')
once(n, '\tstd::erase_if(res, [](auto&& r) { return r.format == BarcodeFormat::None; });', '''\tQRT_ONLY(qrtGroups.beforeErase(res, [](const auto& x) { return x.format == BarcodeFormat::None; });)
\tstd::erase_if(res, [](auto&& r) { return r.format == BarcodeFormat::None; });
\tQRT_ONLY(for (size_t qi = 0; qi < res.size(); ++qi) {
\t\tQRT("collector-output", qrt.number("group", qrtGroups.at(qi)); qrt.number("index", qi);
\t\t\tqrt.number("lineCount", res[qi].lineCount); qrt.position("position", res[qi].position);
\t\t\tqrt.array("bytes", res[qi].content.bytes); qrt.number("format", res[qi].format););
\t})''')
once(n, '\tif ((!maxSymbols || Size(resH) < maxSymbols) && _opts.tryRotate()) {', '''\tQRT("orientation-gate", qrt.number("horizontalCount", resH.size()); qrt.number("maxSymbols", maxSymbols);
\t\tqrt.boolean("tryRotate", _opts.tryRotate()); qrt.boolean("willRotate", (!maxSymbols || Size(resH) < maxSymbols) && _opts.tryRotate()););
\tif ((!maxSymbols || Size(resH) < maxSymbols) && _opts.tryRotate()) {''')

n = 'core/src/oned/ODMultiUPCEANReader.cpp'
once(n, '#define CHECK(A) if(!(A)) return _ret_false_debug_helper();', '''#define CHECK(A) if(!(A)) { QRT_EAN("candidate-check-reject", qrt.text("function", __func__); qrt.text("condition", #A); qrt.number("exitSite", __LINE__); qrt.text("partialText", res.txt);); return _ret_false_debug_helper(); }''')
once(n, '\tif (bestMatch == -1)\n', '''\tQRT_EAN("digit-return", qrt.view("runs", view); qrt.number("bestMatch", bestMatch);
\t\tqrt.boolean("leftLG", lgPattern != nullptr); qrt.text("partialTextBefore", txt););
\tif (bestMatch == -1)
''')
once(n, '\tint i = IndexOf(FIRST_DIGIT_ENCODINGS, lgPattern);', '''\tint i = IndexOf(FIRST_DIGIT_ENCODINGS, lgPattern);
\tQRT_EAN("ean13-parity", qrt.number("parity", lgPattern); qrt.number("leadingDigit", i); qrt.text("partialText", res.txt););''')
once(n, '\tconst int minSize = 3 + 6*4 + 6; // UPC-E', '''\tQRT_ONLY(QRGenTrace::EANScope qrtEAN;)
\tQRT_EAN("ean-dispatch", qrt.boolean("readEAN13", readEAN13); qrt.boolean("readUPCA", readUPCA);
\t\tqrt.boolean("readEAN8", readEAN8); qrt.boolean("readUPCE", readUPCE); qrt.view("initialRuns", next););
\tconst int minSize = 3 + 6*4 + 6; // UPC-E''')
once(n, '\tif (!next.isValid())\n\t\treturn {};', '''\tif (!next.isValid()) {
\t\tQRT_EAN("left-guard-not-found", qrt.number("minSize", minSize););
\t\treturn {};
\t}
\tQRT_ONLY(QRGenTrace::state.candidate = ++QRGenTrace::state.candidates;)
\tQRT_EAN("left-guard-found", qrt.view("runs", next););''')
once(n, '\tError error = !GTIN::IsCheckDigitValid(res.txt) ? ChecksumError() : Error();', '''\tError error = !GTIN::IsCheckDigitValid(res.txt) ? ChecksumError() : Error();
\tQRT_EAN("checksum", qrt.text("text", res.txt); qrt.number("formatBeforeAlias", res.format);
\t\tqrt.boolean("valid", !error); qrt.view("endGuardRuns", res.end););''')
once(n, '\t\telse\n\t\t\treturn {};\n\t}', '''\t\telse {
\t\t\tQRT_EAN("format-exclusion-reject", qrt.text("text", res.txt););
\t\t\treturn {};
\t\t}
\t}''')
once(n, '\tif (_opts.eanAddOnSymbol() == EanAddOnSymbol::Require && !addOnRes.isValid())\n\t\treturn {};', '''\tif (_opts.eanAddOnSymbol() == EanAddOnSymbol::Require && !addOnRes.isValid()) {
\t\tQRT_EAN("addon-required-reject", qrt.text("text", res.txt););
\t\treturn {};
\t}
\tQRT_EAN("ean-accepted-row", qrt.text("text", res.txt); qrt.number("format", res.format); qrt.boolean("error", static_cast<bool>(error));
\t\tqrt.number("x0", begin.pixelsInFront()); qrt.number("x1", next.pixelsTillEnd()); qrt.text("addon", addOnRes.txt););''')

n = 'core/src/oned/ODRowReader.h'
once(n, '\t\tint bestMatch = INVALID_MATCH;', '''\t\tint bestMatch = INVALID_MATCH;
\t\tQRT_ONLY(std::array<float, 20> qrtVariances{}; std::array<uint32_t, 20> qrtBits{};)''')
once(n, '\t\t\tfloat variance = PatternMatchVariance(counters, patterns[i], maxIndividualVariance);', '''\t\t\tfloat variance = PatternMatchVariance(counters, patterns[i], maxIndividualVariance);
\t\t\tQRT_ONLY(if (QRGenTrace::state.ean && i < 20) { qrtVariances[i] = variance; qrtBits[i] = std::bit_cast<uint32_t>(variance); })''')
once(n, '\t\treturn bestMatch;', '''\t\tQRT_EAN("digit-variances", qrt.array("runs", counters); qrt.number("patternCount", Size(patterns));
\t\t\tqrt.array("variances", qrtVariances); qrt.array("varianceFloat32Bits", qrtBits);
\t\t\tqrt.real("maxAverageVariance", maxAvgVariance); qrt.real("maxIndividualVariance", maxIndividualVariance);
\t\t\tqrt.real("bestVariance", bestVariance); qrt.number("selected", bestMatch); qrt.boolean("requireUnambiguous", requireUnambiguousMatch););
\t\treturn bestMatch;''')

n = 'core/src/Pattern.h'
# Log returned guard-test results without adding/repeating predicate evaluation.
start = files[n].index('template <bool E2E = false, int LEN, int SUM>\ndouble IsPattern')
stop = files[n].index('template <bool E2E = false, int N, int SUM, bool IS_SPARSE>\nbool IsRightGuard', start)
part = files[n][start:stop]
import re
part, count = re.subn(r'return ([^;\n]+);', lambda m: 'return QRT_GUARD(view, pattern, spaceInPixel, minQuietZone, moduleSizeRef, (' + m[1] + '), "IsPattern");', part)
assert count == 11, count
files[n] = files[n][:start] + part + files[n][stop:]
once(n, '\tauto window = view.subView(0, LEN);', '''\tauto window = view.subView(0, LEN);
\tQRT_EAN("left-guard-search", qrt.number("minSize", minSize); qrt.view("runs", view););''')

n = 'core/src/GlobalHistogramBinarizer.cpp'
once(n, '\tauto threshold = EstimateBlackPoint(histogram) - 1;', '''\tauto threshold = EstimateBlackPoint(histogram) - 1;
\tQRT("row-binarizer", qrt.number("rotation", rotation); qrt.number("threshold", threshold);
\t\tqrt.array("histogram", histogram); qrt.number("luminanceWidth", buffer.width());
\t\tqrt.number("luminanceHeight", buffer.height()););''')

# Every modified source file is retained; patch targets the exact upstream tree.
out = HERE / 'instrumented-source'
out.mkdir(exist_ok=True)
patch = []
records = []
for name in names:
    dest = out / name; dest.parent.mkdir(parents=True, exist_ok=True)
    raw = files[name].encode(); dest.write_bytes(raw)
    patch.extend(difflib.unified_diff(original[name].splitlines(True), files[name].splitlines(True), 'a/' + name, 'b/' + name))
    records.append({'path': name, 'baseSha256': pins[name], 'instrumentedSha256': sha(raw)})
headerName = 'core/src/QRGenRowTrace.h'
header = (HERE / 'QRGenRowTrace.h').read_bytes()
(out / headerName).write_bytes(header)
patch.extend(difflib.unified_diff([], header.decode().splitlines(True), '/dev/null', 'b/' + headerName))
patchBytes = ''.join(patch).encode()
(HERE / 'actual-row-trace.patch').write_bytes(patchBytes)
metadata = {'scope': 'Instrumentation only against unchanged release policy; no recognition/build performed by preparer.',
            'cppCommit': CPP, 'wrapperCommit': 'b7dcf63aefc7b94fb97ba09e9b1fb213d9399f54',
            'compileDefinition': 'ZXING_QRGEN_ROW_TRACE=1', 'patchSha256': sha(patchBytes),
            'files': records, 'newFiles': [{'path': headerName, 'sha256': sha(header)}],
            'bounds': {'maxEventsPerCall': 250000, 'maxBytesPerCall': 33554432, 'maxEventBytes': 16384,
                       'collectorIdCapacity': 8192, 'callEndOutsideCap': True},
            'verifiedPreparationChecks': ['original source byte hashes verified', 'all replacements asserted unique'],
            'designClaimsPendingBuildAndEquivalenceGate': ['no baseline candidate ambiguity guard included', 'all original comparisons and thresholds retained'],
            'limitations': ['Trace allocation/stdio costs change timing; no performance claim.',
                            'Call-end dropped or oversized >0 makes the trace incomplete.',
                            'Shared guard scores log returned values and float64 result bits; digit scores retain exact float32 bit patterns. Non-finite values are explicit JSON strings.',
                            'Fullres/invert-off protocol avoids scale/inversion mapping ambiguity; expanded modes are outside this study.']}
(HERE / 'patch-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf8')
print(json.dumps({'patchSha256': metadata['patchSha256'], 'files': len(records) + 1, 'recognitionCalls': 0}))
