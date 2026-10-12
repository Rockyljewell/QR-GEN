// Still-image diagnostic consumer. No camera, UI, renderer, or production source changes.
// An external runner must bind the checkout/build and enforce a process timeout.
import CoreGraphics
import CoreImage
import CoreMedia
import CryptoKit
import Darwin
import Foundation
import ImageIO
import QRGenKit
import Vision

private let savedInputSHA256 = "bdb3352f06392328c5c5f69369fbed5c2ebe06d4e3d37b0f39bae7672791c01c"
private let savedInputPayload = "qrgen-ios-native-highlight-capability-978214d"
private let null = NSNull()

private enum ProtocolError: Error, CustomStringConvertible {
    case invalid(String)
    var description: String {
        switch self { case .invalid(let message): return message }
    }
}

private struct Arguments {
    let input: URL
    let output: URL

    init(_ arguments: [String]) throws {
        let accepted = Set(["--input", "--input-sha256", "--expected-payload", "--output"])
        guard arguments.count == 8 else {
            throw ProtocolError.invalid("Expected exactly --input, --input-sha256, --expected-payload, and --output pairs.")
        }
        var values: [String: String] = [:]
        for index in stride(from: 0, to: arguments.count, by: 2) {
            let key = arguments[index]
            guard accepted.contains(key), values[key] == nil, !arguments[index + 1].isEmpty else {
                throw ProtocolError.invalid("Unknown, repeated, or empty CLI argument.")
            }
            values[key] = arguments[index + 1]
        }
        guard values["--input-sha256"] == savedInputSHA256,
              values["--expected-payload"] == savedInputPayload,
              let input = values["--input"], let output = values["--output"] else {
            throw ProtocolError.invalid("The immutable input hash/payload contract does not match.")
        }
        self.input = URL(fileURLWithPath: input).standardizedFileURL.resolvingSymlinksInPath()
        self.output = URL(fileURLWithPath: output).standardizedFileURL.resolvingSymlinksInPath()
    }
}

private struct LoadedImage {
    let image: CGImage
    let record: [String: Any]

    init(data: Data, id: String, fileName: String) throws {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let type = CGImageSourceGetType(source), type as String == "public.png",
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
              image.width > 0, image.height > 0 else {
            throw ProtocolError.invalid("\(id): input is not a single decodable PNG.")
        }
        self.image = image
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
        self.record = [
            "id": id, "fileName": fileName, "available": true,
            "sha256": sha256(data), "byteCount": data.count,
            "imageIOType": type as String,
            "width": image.width, "height": image.height,
            "bitsPerComponent": image.bitsPerComponent, "bitsPerPixel": image.bitsPerPixel,
            "bytesPerRow": image.bytesPerRow, "alphaInfoRawValue": image.alphaInfo.rawValue,
            "bitmapInfoRawValue": image.bitmapInfo.rawValue,
            "colorSpaceName": image.colorSpace?.name.map { $0 as String } as Any? ?? null,
            "imageIOProperties": properties.map { jsonSafe($0) } ?? null,
            "handlerInputKind": "CGImage decoded once with ImageIO, same object passed to both arms",
            "orientation": ["name": "up", "rawValue": CGImagePropertyOrientation.up.rawValue],
            "orientationPolicy": "Explicit .up in both arms; ImageIO orientation metadata is recorded but not applied.",
            "pixelMutation": "none: no crop, resize, color conversion, or normalization by this consumer"
        ]
    }
}

private func sha256(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

// Preserve nil and non-finite values without a JSON encoding failure or a geometry substitute.
private func scalar(_ value: Double) -> Any {
    if value.isNaN { return "NaN" }
    if value == .infinity { return "Infinity" }
    if value == -.infinity { return "-Infinity" }
    return value
}

private func optional<T>(_ value: T?) -> Any {
    if let value { return value }
    return null
}

private func jsonSafe(_ value: Any) -> Any {
    if let value = value as? NSNumber {
        return value.doubleValue.isFinite ? value : scalar(value.doubleValue)
    }
    if let value = value as? String { return value }
    if let value = value as? Data { return ["encoding": "base64", "value": value.base64EncodedString()] }
    if let value = value as? NSDictionary {
        var result: [String: Any] = [:]
        for (key, item) in value { result[String(describing: key)] = jsonSafe(item) }
        return result
    }
    if let value = value as? NSArray { return value.map { jsonSafe($0) } }
    if value is NSNull { return null }
    return ["runtimeType": String(reflecting: type(of: value)), "description": String(describing: value)]
}

private func point(_ point: CGPoint) -> [String: Any] {
    ["x": scalar(Double(point.x)), "y": scalar(Double(point.y))]
}

private func rectangle(_ rect: CGRect) -> [String: Any] {
    ["x": scalar(Double(rect.origin.x)), "y": scalar(Double(rect.origin.y)),
     "width": scalar(Double(rect.size.width)), "height": scalar(Double(rect.size.height))]
}

private func mediaTime(_ time: CMTime) -> [String: Any] {
    ["value": time.value, "timescale": time.timescale, "flagsRawValue": time.flags.rawValue,
     "epoch": time.epoch, "seconds": scalar(CMTimeGetSeconds(time))]
}

private func errorRecord(_ error: Error) -> [String: Any] {
    let ns = error as NSError
    return ["runtimeType": String(reflecting: type(of: error)), "description": String(describing: error),
            "domain": ns.domain, "code": ns.code, "localizedDescription": ns.localizedDescription,
            "localizedFailureReason": optional(ns.localizedFailureReason),
            "localizedRecoverySuggestion": optional(ns.localizedRecoverySuggestion)]
}

private func effectivePayload(_ observation: VNBarcodeObservation) -> String? {
    if let text = observation.payloadStringValue { return text }
    if #available(macOS 14.0, *), let bytes = observation.payloadData {
        return String(data: bytes, encoding: .utf8)
    }
    return nil
}

private func rawObservation(_ observation: VNBarcodeObservation, index: Int) -> [String: Any] {
    var result: [String: Any] = [
        "index": index, "uuid": observation.uuid.uuidString,
        "requestRevision": observation.requestRevision,
        "confidence": scalar(Double(observation.confidence)),
        "timeRange": ["start": mediaTime(observation.timeRange.start), "duration": mediaTime(observation.timeRange.duration)],
        "symbologyRawValue": observation.symbology.rawValue,
        "payloadStringValue": optional(observation.payloadStringValue),
        "effectivePayloadForMatching": optional(effectivePayload(observation)),
        "boundingBox": rectangle(observation.boundingBox),
        "normalizedCorners": ["topLeft": point(observation.topLeft), "topRight": point(observation.topRight),
                              "bottomRight": point(observation.bottomRight), "bottomLeft": point(observation.bottomLeft)]
    ]
    if let descriptor = observation.barcodeDescriptor {
        var record: [String: Any] = ["runtimeType": String(reflecting: type(of: descriptor))]
        if let qr = descriptor as? CIQRCodeDescriptor {
            record["errorCorrectedPayloadBase64"] = qr.errorCorrectedPayload.base64EncodedString()
            record["symbolVersion"] = qr.symbolVersion
            record["maskPattern"] = qr.maskPattern
            record["errorCorrectionLevelRawValue"] = qr.errorCorrectionLevel.rawValue
        }
        result["barcodeDescriptor"] = record
    } else {
        result["barcodeDescriptor"] = null
    }
    // Apple availability metadata: all six fields below were introduced in macOS 14.
    // https://developer.apple.com/documentation/vision/vnbarcodeobservation
    if #available(macOS 14.0, *) {
        result["macOS14FieldsAvailable"] = true
        result["payloadDataBase64"] = optional(observation.payloadData?.base64EncodedString())
        result["payloadDataByteCount"] = optional(observation.payloadData?.count)
        result["isGS1DataCarrier"] = observation.isGS1DataCarrier
        result["isColorInverted"] = observation.isColorInverted
        result["supplementalPayloadString"] = optional(observation.supplementalPayloadString)
        result["supplementalPayloadDataBase64"] = optional(observation.supplementalPayloadData?.base64EncodedString())
        result["supplementalCompositeTypeRawValue"] = observation.supplementalCompositeType.rawValue
    } else {
        result["macOS14FieldsAvailable"] = false
    }
    return result
}

private func requestMetadata(_ request: VNDetectBarcodesRequest) -> [String: Any] {
    var record: [String: Any] = [
        "runtimeType": String(reflecting: type(of: request)), "revision": request.revision,
        "classDefaultRevision": VNDetectBarcodesRequest.defaultRevision,
        "classCurrentRevision": VNDetectBarcodesRequest.currentRevision,
        "classSupportedRevisions": VNDetectBarcodesRequest.supportedRevisions.map { $0 },
        "symbologies": request.symbologies.map { $0.rawValue },
        "regionOfInterest": rectangle(request.regionOfInterest),
        "revisionOverride": false, "regionOfInterestOverride": false,
        "executionDevicePolicy": "Unchanged request default; no CPU/GPU override.",
        "preferBackgroundProcessing": request.preferBackgroundProcessing
    ]
    if #available(macOS 14.0, *) {
        record["coalesceCompositeSymbologies"] = request.coalesceCompositeSymbologies
    } else {
        record["coalesceCompositeSymbologies"] = ["available": false, "requires": "macOS 14"]
    }
    return record
}

private func encodedSDKResults(_ results: [Barcode]) throws -> Any {
    let encoder = JSONEncoder()
    encoder.nonConformingFloatEncodingStrategy = .convertToString(
        positiveInfinity: "Infinity", negativeInfinity: "-Infinity", nan: "NaN"
    )
    return try JSONSerialization.jsonObject(with: encoder.encode(results))
}

private func quadSummary(_ points: [(x: Double, y: Double)], width: Double, height: Double) -> [String: Any] {
    let finitePoints = points.allSatisfy { $0.x.isFinite && $0.y.isFinite }
    let finiteFrame = width.isFinite && height.isFinite
    var area = 0.0
    for index in points.indices {
        let next = points[(index + 1) % points.count]
        area += points[index].x * next.y - next.x * points[index].y
    }
    area = abs(area) / 2
    return ["pointCount": points.count, "allPointsFinite": finitePoints,
            "frameSizeFinite": finiteFrame, "frameSizePositive": finiteFrame && width > 0 && height > 0,
            "absoluteShoelaceArea": scalar(area), "areaFinite": area.isFinite, "areaPositive": area.isFinite && area > 0,
            "allPointsWithinFrameInclusive": finitePoints && finiteFrame && width > 0 && height > 0
                && points.allSatisfy { $0.x >= 0 && $0.x <= width && $0.y >= 0 && $0.y <= height },
            "purpose": "Diagnostic only; does not filter results or establish renderer support."]
}

private func comparison(_ sdk: [Barcode]?, _ raw: [VNBarcodeObservation]?, image: CGImage) -> [String: Any] {
    guard let sdk, let raw else {
        return ["status": "not_compared_arm_error_or_nil_raw_results"]
    }
    let sdkIndices = sdk.indices.filter { sdk[$0].symbology == .qr && sdk[$0].data == savedInputPayload }
    let rawIndices = raw.indices.filter { raw[$0].symbology == .qr && effectivePayload(raw[$0]) == savedInputPayload }
    var result: [String: Any] = [
        "sdkExpectedMatchIndices": sdkIndices, "visionExpectedMatchIndices": rawIndices,
        "sdkExpectedMatchCount": sdkIndices.count, "visionExpectedMatchCount": rawIndices.count,
        "expectedMatchRule": "QR and exact payloadStringValue; raw nil text may use UTF-8 payloadData on macOS 14+.",
        "interpretationLimit": "Separate sequential Vision requests; a one-pass difference does not prove mapper causation."
    ]
    guard sdkIndices.count == 1, rawIndices.count == 1 else {
        result["status"] = "not_compared_missing_or_ambiguous_expected_matches"
        return result
    }
    let barcode = sdk[sdkIndices[0]]
    let observation = raw[rawIndices[0]]
    let rawPoints = [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]
    let names = ["topLeft", "topRight", "bottomRight", "bottomLeft"]
    let pixelPoints = rawPoints.map { (x: Double($0.x) * Double(image.width), y: (1 - Double($0.y)) * Double(image.height)) }
    var deltas: [[String: Any]] = []
    for index in names.indices {
        let sdkPoint = barcode.location.points[index]
        let rawPoint = pixelPoints[index]
        deltas.append(["corner": names[index],
                       "sdkPixel": ["x": scalar(sdkPoint.x), "y": scalar(sdkPoint.y)],
                       "visionDerivedPixel": ["x": scalar(rawPoint.x), "y": scalar(rawPoint.y)],
                       "sdkMinusVisionDerivedPixel": ["x": scalar(sdkPoint.x - rawPoint.x), "y": scalar(sdkPoint.y - rawPoint.y)]])
    }
    result["status"] = "unique_expected_matches_numeric_observations_only"
    result["coordinateFormula"] = "Full-frame default ROI, .up: x*width, (1-y)*height; not renderer input."
    result["cornerObservations"] = deltas
    result["sdkFrameSize"] = ["width": scalar(barcode.frameSize.width), "height": scalar(barcode.frameSize.height)]
    result["decodedCGImageSize"] = ["width": image.width, "height": image.height]
    result["sdkQuadDiagnostics"] = quadSummary(barcode.location.points.map { (x: $0.x, y: $0.y) },
                                              width: barcode.frameSize.width, height: barcode.frameSize.height)
    result["visionDerivedQuadDiagnostics"] = quadSummary(pixelPoints, width: Double(image.width), height: Double(image.height))
    result["sdkFrameSizeMatchesDecodedCGImage"] = barcode.frameSize.width == Double(image.width)
        && barcode.frameSize.height == Double(image.height)
    return result
}

private func observe(_ input: LoadedImage, firstCallIndex: Int) async throws -> [String: Any] {
    var record = input.record
    var sdkResults: [Barcode]?
    var sdk: [String: Any] = [
        "arm": "public_QRGen_scan", "decodeCallIndex": firstCallIndex,
        "api": "QRGen.scan(image:orientation:symbologies:)",
        "arguments": ["orientation": "up", "symbologies": ["qr"]],
        "requestInternals": "Not exposed by public API; source/build binding is external."
    ]
    do {
        let results = try await QRGen.scan(image: input.image, orientation: .up, symbologies: ["qr"])
        sdkResults = results
        sdk["status"] = "returned"
        sdk["resultCount"] = results.count
        sdk["error"] = null
    } catch {
        sdk["status"] = "threw"
        sdk["resultCount"] = null
        sdk["orderedResults"] = null
        sdk["error"] = errorRecord(error)
    }
    if let sdkResults { sdk["orderedResults"] = try encodedSDKResults(sdkResults) }

    // The second decode always follows completion of the public SDK arm, even if it threw.
    let request = VNDetectBarcodesRequest()
    var support: [String: Any]
    do {
        let supported = try request.supportedSymbologies()
        support = ["status": "returned", "orderedSymbologies": supported.map { $0.rawValue },
                   "containsRequestedQR": supported.contains(.qr), "error": null]
    } catch {
        support = ["status": "threw", "orderedSymbologies": null, "error": errorRecord(error)]
    }
    request.symbologies = [.qr]
    var vision: [String: Any] = [
        "arm": "direct_Apple_Vision", "decodeCallIndex": firstCallIndex + 1,
        "handlerInputKind": "CGImage", "orientation": "up", "handlerOptions": [:] as [String: String],
        "supportedSymbologiesQuery": support, "requestBeforePerform": requestMetadata(request)
    ]
    let handler = VNImageRequestHandler(cgImage: input.image, orientation: .up, options: [:])
    do {
        try handler.perform([request])
        vision["status"] = "returned"
        vision["error"] = null
    } catch {
        vision["status"] = "threw"
        vision["error"] = errorRecord(error)
    }
    let raw = request.results
    vision["requestAfterPerform"] = requestMetadata(request)
    vision["resultsWereNil"] = raw == nil
    vision["resultCount"] = optional(raw?.count)
    vision["orderedResults"] = raw.map { values in values.enumerated().map { rawObservation($0.element, index: $0.offset) } } as Any? ?? null
    record["arms"] = [sdk, vision]
    // A throwing direct request may expose partial results; retain them but do not compare them.
    record["comparison"] = comparison(sdkResults, vision["status"] as? String == "returned" ? raw : nil, image: input.image)
    return record
}

private func createFreshOutput(_ output: URL, input: URL) throws {
    let fm = FileManager.default
    let parent = output.deletingLastPathComponent()
    var isDirectory: ObjCBool = false
    guard fm.fileExists(atPath: parent.path, isDirectory: &isDirectory), isDirectory.boolValue,
          !fm.fileExists(atPath: output.path), output != input else {
        throw ProtocolError.invalid("Output must be a fresh, nonexisting directory with an existing parent.")
    }
    let consumerRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().resolvingSymlinksInPath()
    let protectedRoots = [consumerRoot, consumerRoot.appendingPathComponent("QRGenSource").resolvingSymlinksInPath()]
    guard !protectedRoots.contains(where: { output.path == $0.path || output.path.hasPrefix($0.path + "/") }) else {
        throw ProtocolError.invalid("Output cannot be inside the consumer or linked production checkout.")
    }
    let result = output.path.withCString { Darwin.mkdir($0, 0o700) }
    guard result == 0 else { throw ProtocolError.invalid("Could not exclusively create output directory (errno \(errno)).") }
}

private func architecture() -> String {
    #if arch(arm64)
    return "arm64"
    #elseif arch(x86_64)
    return "x86_64"
    #else
    return "other"
    #endif
}

@main
private struct AppleStillImageProbe {
    static func main() async {
        do { try await run() }
        catch {
            let message = "AppleStillImageProbe protocol failure: \(error)\n"
            FileHandle.standardError.write(Data(message.utf8))
            exit(1)
        }
    }

    private static func run() async throws {
        let arguments = try Arguments(Array(CommandLine.arguments.dropFirst()))
        let inputBytes = try Data(contentsOf: arguments.input, options: .mappedIfSafe)
        guard sha256(inputBytes) == savedInputSHA256 else { throw ProtocolError.invalid("Saved PNG SHA-256 mismatch.") }
        let saved = try LoadedImage(data: inputBytes, id: "immutable_saved_png", fileName: arguments.input.lastPathComponent)
        guard saved.image.width == 720, saved.image.height == 1280 else {
            throw ProtocolError.invalid("Saved PNG dimensions differ from the immutable 720x1280 contract.")
        }
        try createFreshOutput(arguments.output, input: arguments.input)

        let process = ProcessInfo.processInfo
        let version = process.operatingSystemVersion
        var record: [String: Any] = [
            "schemaVersion": 1, "status": "observations_recorded",
            "protocol": "two_inputs_two_arms_single_pass_sdk_then_vision_v1",
            "expectedPayload": savedInputPayload, "expectedSymbology": "qr", "immutableInputSHA256": savedInputSHA256,
            "decodeCallLimit": 4, "decodeCallCount": 0, "availableInputs": [String](),
            "decodeCallCountDefinition": "Attempted public QRGen.scan calls plus direct VNImageRequestHandler.perform calls; not an SDK-internal instrumentation count.",
            "generatedControlPlan": ["api": "QRGen.generatePNG(_:symbology:scale:ecLevel:)",
                                     "arguments": ["data": savedInputPayload, "symbology": "qr", "scale": 8, "ecLevel": "M"],
                                     "fileName": "generated-control.png", "saveAndHashBeforeItsDecode": true],
            "environment": ["operatingSystemVersionString": process.operatingSystemVersionString,
                            "operatingSystemVersion": ["major": version.majorVersion, "minor": version.minorVersion, "patch": version.patchVersion],
                            "compiledArchitecture": architecture(),
                            "visionBundleIdentifier": optional(Bundle(for: VNDetectBarcodesRequest.self).bundleIdentifier),
                            "visionBundleVersion": jsonSafe(Bundle(for: VNDetectBarcodesRequest.self).infoDictionary?["CFBundleVersion"] ?? null)],
            "limitations": ["Protocol completion is not recognition success or SDK/direct-Vision conformance.",
                            "Separate one-pass requests do not establish mapper causation.",
                            "macOS still-image observations do not establish Simulator/UIKit preview or physical-device capability.",
                            "No camera, UI, renderer, retry, accuracy benchmark, or generated-geometry substitution."]
        ]
        var inputs: [[String: Any]] = []
        var availableInputs = ["immutable_saved_png"]
        inputs.append(try await observe(saved, firstCallIndex: 1))
        var calls = 2

        // Generate once, save/hash the exact new PNG before either decode, and never substitute it for the saved input.
        var generatedPNG: Data?
        do {
            generatedPNG = try QRGen.generatePNG(savedInputPayload, symbology: .qr, scale: 8, ecLevel: "M")
        } catch {
            inputs.append(["id": "new_generated_control_png", "available": false,
                           "status": "generation_failed", "error": errorRecord(error),
                           "generationArguments": ["data": savedInputPayload, "symbology": "qr", "scale": 8, "ecLevel": "M"]])
        }
        if let png = generatedPNG {
            let generatedURL = arguments.output.appendingPathComponent("generated-control.png")
            try png.write(to: generatedURL, options: .withoutOverwriting)
            var generated: LoadedImage?
            do {
                generated = try LoadedImage(data: png, id: "new_generated_control_png", fileName: "generated-control.png")
            } catch {
                inputs.append(["id": "new_generated_control_png", "available": false,
                               "stage": "ImageIO_preparation", "status": "generated_png_image_preparation_failed",
                               "fileName": "generated-control.png", "sha256": sha256(png), "byteCount": png.count,
                               "generationStatus": "returned", "error": errorRecord(error)])
            }
            if let generated {
                var observed = try await observe(generated, firstCallIndex: 3)
                observed["generation"] = ["api": "QRGen.generatePNG(_:symbology:scale:ecLevel:)",
                                          "arguments": ["data": savedInputPayload, "symbology": "qr", "scale": 8, "ecLevel": "M"],
                                          "status": "returned", "error": null]
                inputs.append(observed)
                availableInputs.append("new_generated_control_png")
                calls += 2
            }
        }
        record["inputs"] = inputs
        record["decodeCallCount"] = calls
        record["availableInputs"] = availableInputs
        record["availableInputCount"] = availableInputs.count
        let bytes = try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys])
        try bytes.write(to: arguments.output.appendingPathComponent("observations.json"), options: .withoutOverwriting)
        FileHandle.standardOutput.write(Data("observations_recorded decodeCallCount=\(calls) availableInputs=\(availableInputs.count)\n".utf8))
    }
}
