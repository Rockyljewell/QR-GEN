// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if canImport(AVFoundation) && canImport(Vision) && (os(iOS) || os(macOS))
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import XCTest
@testable import QRGenKit

final class CameraFrameClockPipelineTests: XCTestCase {
    private final class PacketBox: @unchecked Sendable {
        private let lock = NSLock()
        private var packet: DecodedCameraFrame?
        func store(_ value: DecodedCameraFrame) {
            lock.lock()
            defer { lock.unlock() }
            packet = value
        }
        func read() -> DecodedCameraFrame? {
            lock.lock()
            defer { lock.unlock() }
            return packet
        }
    }

    func testActualVisionProducerEmitsThePairedDefaultClockSample() throws {
        var pixel: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault, 320, 240, kCVPixelFormatType_32BGRA, nil, &pixel), kCVReturnSuccess)
        let image = try XCTUnwrap(pixel)
        let lockStatus = CVPixelBufferLockBaseAddress(image, [])
        XCTAssertEqual(lockStatus, kCVReturnSuccess)
        guard lockStatus == kCVReturnSuccess else { return }
        do {
            defer { XCTAssertEqual(CVPixelBufferUnlockBaseAddress(image, []), kCVReturnSuccess) }
            let base = try XCTUnwrap(CVPixelBufferGetBaseAddress(image))
            base.initializeMemory(as: UInt8.self, repeating: 255, count: CVPixelBufferGetDataSize(image))
        }
        var description: CMVideoFormatDescription?
        XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image, formatDescriptionOut: &description), 0)
        let format = try XCTUnwrap(description)
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample), 0)
        let input = try XCTUnwrap(sample)
        var configuration = FrameProcessor.Configuration(
            options: ScannerOptions(symbologies: ["qr"], mode: .batch),
            regionOfInterest: CGRect(x: 0, y: 0, width: 1, height: 1)
        )
        configuration.minimumFrameInterval = 0
        let processor = FrameProcessor(configuration: configuration)
        let captured = PacketBox()
        processor.setOutputHandler { captured.store($0) }
        let source = processor.beginSource(resetDuplicateHistory: true)
        processor.setEnabled(true)
        processor.queue.sync {}
        let epoch = processor.sourceSession.processingEpoch
        defer {
            processor.setEnabled(false)
            processor.queue.sync {}
        }
        let before = CameraFrameClock.sample()
        processor.queue.sync { processor.captureOutput(input, source: source) }
        let after = CameraFrameClock.sample()
        let packet = try XCTUnwrap(captured.read())
        let elapsed = try XCTUnwrap(packet.elapsedTime)
        XCTAssertEqual(packet.source, source)
        XCTAssertEqual(packet.epoch, epoch)
        XCTAssertNil(packet.error)
        XCTAssertTrue(packet.detections.isEmpty)
        XCTAssertGreaterThanOrEqual(packet.timestamp, min(before.timestamp, after.timestamp))
        XCTAssertLessThanOrEqual(packet.timestamp, max(before.timestamp, after.timestamp))
        XCTAssertGreaterThanOrEqual(elapsed, before.elapsedTime)
        XCTAssertLessThanOrEqual(elapsed, after.elapsedTime)
        print("SWIFT_CAMERA_CLOCK_PRODUCER source=\(source) epoch=\(epoch) timestamp=\(packet.timestamp) elapsedTime=\(elapsed) detections=\(packet.detections.count)")
    }
}
#endif
