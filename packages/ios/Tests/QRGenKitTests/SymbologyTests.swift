import XCTest
@testable import QRGenKit

final class SymbologyTests: XCTestCase {
    func testRawValuesMatchSpecIds() {
        XCTAssertEqual(Symbology.allCases.count, 26)
        XCTAssertEqual(Symbology.microQR.rawValue, "micro-qr")
        XCTAssertEqual(Symbology.dataMatrix.rawValue, "data-matrix")
        XCTAssertEqual(Symbology.microPDF417.rawValue, "micro-pdf417")
        XCTAssertEqual(Symbology.databarExpanded.rawValue, "databar-expanded")
        XCTAssertEqual(Symbology.dxFilmEdge.rawValue, "dx-film-edge")
        XCTAssertEqual(Symbology.qr.displayName, "QR Code")
        XCTAssertEqual(Symbology.itf.displayName, "Interleaved 2 of 5")
    }

    func testNormalizationAndAliases() {
        for name in ["QRCode", "qr-code", "QR", "qr", "Qr_Code"] {
            XCTAssertEqual(Symbology.resolve([name]), [.qr], name)
        }
        XCTAssertEqual(Symbology.resolve(["micro-qr"]), [.microQR])
        XCTAssertEqual(Symbology.resolve(["MicroQRCode"]), [.microQR])
        XCTAssertEqual(Symbology.resolve(["dm"]), [.dataMatrix])
        XCTAssertEqual(Symbology.resolve(["Data Matrix"]), [.dataMatrix])
        XCTAssertEqual(Symbology.resolve(["ean", "jan", "gtin13"]), [.ean13])
        XCTAssertEqual(Symbology.resolve(["gtin8"]), [.ean8])
        XCTAssertEqual(Symbology.resolve(["upc"]), [.upca])
        XCTAssertEqual(Symbology.resolve(["UPC-E"]), [.upce])
        XCTAssertEqual(Symbology.resolve(["isbn13"]), [.isbn])
        XCTAssertEqual(Symbology.resolve(["GS1-128", "ean128"]), [.code128])
        XCTAssertEqual(Symbology.resolve(["code3of9"]), [.code39])
        XCTAssertEqual(Symbology.resolve(["NW-7"]), [.codabar])
        XCTAssertEqual(Symbology.resolve(["interleaved2of5", "i2of5"]), [.itf])
        XCTAssertEqual(Symbology.resolve(["ITF-14"]), [.itf14])
        XCTAssertEqual(Symbology.resolve(["rss14", "databaromni"]), [.databar])
        XCTAssertEqual(Symbology.resolve(["rssexpanded"]), [.databarExpanded])
        XCTAssertEqual(Symbology.resolve(["rsslimited"]), [.databarLimited])
        XCTAssertEqual(Symbology.resolve(["compactpdf417"]), [.pdf417])
        XCTAssertEqual(Symbology(name: "Aztec Code"), .aztec)
        XCTAssertNil(Symbology(name: "retail"), "groups are not single symbologies")
    }

    func testGroups() {
        XCTAssertEqual(Symbology.resolve(["all"]).count, 26)
        XCTAssertEqual(Symbology.resolve([]), Symbology.all, "empty list defaults to all")
        XCTAssertEqual(Symbology.resolve(["1d"]), Symbology.resolve(["linear"]))
        XCTAssertEqual(Symbology.resolve(["1D"]).count, 18)
        XCTAssertEqual(Symbology.resolve(["2d"]), [.qr, .microQR, .rmqr, .dataMatrix, .aztec, .pdf417, .microPDF417, .maxicode])
        XCTAssertEqual(Symbology.resolve(["retail"]), [.ean13, .ean8, .upca, .upce, .isbn, .databar, .databarExpanded, .databarLimited])
        XCTAssertEqual(Symbology.resolve(["industrial"]), [.code128, .code39, .code93, .codabar, .itf, .itf14, .dataMatrix])
        XCTAssertEqual(Symbology.resolve(["GS1"]), [.code128, .dataMatrix, .qr, .databar, .databarExpanded, .databarLimited])
        XCTAssertEqual(Symbology.resolve(["qr", "retail"]).count, 9)
        XCTAssertEqual(Symbology.linear.union(Symbology.matrix), Symbology.all)
        XCTAssertTrue(Symbology.linear.isDisjoint(with: Symbology.matrix))
    }

    func testUnknownNamesAreSkipped() {
        XCTAssertEqual(Symbology.resolve(["qr", "not-a-code", ""]), [.qr])
        XCTAssertEqual(Symbology.resolve(["nonsense"]), [])
    }

    func testAIMIdentifiers() {
        XCTAssertEqual(Symbology.qr.aimIdentifier(isGS1: false), "]Q1")
        XCTAssertEqual(Symbology.qr.aimIdentifier(isGS1: true), "]Q3")
        XCTAssertEqual(Symbology.code128.aimIdentifier(isGS1: true), "]C1")
        XCTAssertEqual(Symbology.dataMatrix.aimIdentifier(isGS1: true), "]d2")
        XCTAssertEqual(Symbology.databar.aimIdentifier(isGS1: true), "]e0")
    }

    func testScannerOptionDefaults() {
        let options = ScannerOptions()
        XCTAssertEqual(options.symbologies, ["all"])
        XCTAssertEqual(options.mode, .continuous)
        XCTAssertEqual(options.duplicateFilter, 1000)
        XCTAssertTrue(options.beep)
        XCTAssertTrue(options.vibrate)
        XCTAssertEqual(options.camera, .back)
        XCTAssertFalse(options.torch)
        XCTAssertEqual(options.resolvedViewfinder, .frame)
        XCTAssertEqual(options.resolvedMaxResults, 1)
        XCTAssertNil(options.normalizedScanArea)

        let linear = ScannerOptions(symbologies: ["ean13", "code128"], mode: .batch)
        XCTAssertEqual(linear.resolvedViewfinder, .line)
        XCTAssertEqual(linear.resolvedMaxResults, 20)

        let typed = ScannerOptions(symbologies: [Symbology.qr, .ean13], mode: .single)
        XCTAssertEqual(typed.resolvedSymbologies, [.qr, .ean13])

        let area = ScannerOptions(scanArea: CGRect(x: -0.5, y: 0.25, width: 1, height: 2))
        XCTAssertEqual(area.normalizedScanArea, CGRect(x: 0, y: 0.25, width: 0.5, height: 0.75))
        XCTAssertEqual(ScannerOptions.Camera(id: "front"), .front)
        XCTAssertEqual(ScannerOptions.Camera(id: "com.apple.avfoundation.avcapturedevice.built-in_video:0"),
                       .device(id: "com.apple.avfoundation.avcapturedevice.built-in_video:0"))
    }

    func testErrorCodes() {
        XCTAssertEqual(QRGenError.cameraPermissionDenied.code, "camera-permission-denied")
        XCTAssertEqual(QRGenError.cameraNotFound.code, "camera-not-found")
        XCTAssertEqual(QRGenError.cameraInUse.code, "camera-in-use")
        XCTAssertEqual(QRGenError.insecureContext.code, "insecure-context")
        XCTAssertEqual(QRGenError.engineLoadFailed("x").code, "engine-load-failed")
        XCTAssertEqual(QRGenError.unsupported("x").code, "unsupported")
        XCTAssertEqual(QRGenError.unknown("x").code, "unknown")
        XCTAssertEqual(QRGenError(code: "unsupported", message: "nope"), .unsupported("nope"))
    }
}
