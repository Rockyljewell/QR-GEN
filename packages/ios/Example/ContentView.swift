// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

import QRGenKit
import SwiftUI

/// Home screen: a scan button, a full-screen single-scan camera, and a result sheet.
struct ContentView: View {
    @State private var isScanning = false
    @State private var pendingResult: Barcode?
    @State private var result: Barcode?
    @State private var errorMessage: String?

    private let teal = Color(red: 46 / 255, green: 193 / 255, blue: 206 / 255)

    var body: some View {
        NavigationView {
            VStack(spacing: 28) {
                Spacer()
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 88, weight: .light))
                    .foregroundColor(teal)
                VStack(spacing: 8) {
                    Text("QRGen")
                        .font(.largeTitle.bold())
                    Text("Scan QR codes, retail barcodes, PDF417 and more.")
                        .font(.callout)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                Button {
                    errorMessage = nil
                    isScanning = true
                } label: {
                    Label("Scan a code", systemImage: "camera.viewfinder")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                .tint(teal)
                .padding(.horizontal, 32)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
                Spacer()
                Text("QRGenKit \(QRGen.version)")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .padding()
            .navigationBarHidden(true)
        }
        .navigationViewStyle(.stack)
        .fullScreenCover(isPresented: $isScanning, onDismiss: showPendingResult) {
            QRGenScannerView(options: ScannerOptions(
                symbologies: ["qr", "data-matrix", "aztec", "pdf417", "retail", "code128", "code39"],
                mode: .single
            )) { barcodes in
                pendingResult = barcodes.first
                isScanning = false
            }
            .onError { error in
                errorMessage = error.message
                // On permission errors the scanner stays open: it shows an "Open Settings" prompt.
                if error != .cameraPermissionDenied { isScanning = false }
            }
            .onClose { isScanning = false }
            .ignoresSafeArea()
        }
        .sheet(item: $result) { barcode in
            ResultView(barcode: barcode)
        }
    }

    private func showPendingResult() {
        result = pendingResult
        pendingResult = nil
    }
}

/// Shows a scanned code, its parsed content and the cross-platform JSON.
struct ResultView: View {
    let barcode: Barcode
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            List {
                Section("Code") {
                    LabeledRow(title: "Symbology", value: barcode.symbologyName)
                    LabeledRow(title: "Data", value: barcode.data)
                    if !barcode.ecLevel.isEmpty {
                        LabeledRow(title: "EC level", value: barcode.ecLevel)
                    }
                }
                Section("Parsed as \(barcode.parsed.type)") {
                    Text(summary(of: barcode.parsed))
                        .textSelection(.enabled)
                    if case .url(let link) = barcode.parsed, let url = URL(string: link) {
                        Link("Open link", destination: url)
                    }
                }
                Section("JSON") {
                    Text(barcode.toJSON(prettyPrinted: true))
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
            .navigationTitle("Scanned")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func summary(of content: ParsedContent) -> String {
        switch content {
        case .url(let url): return url
        case .gs1DigitalLink(let url, let gs1): return "\(url)\n\(gs1.hri)"
        case .email(let email): return [email.to, email.subject, email.body].compactMap { $0 }.joined(separator: "\n")
        case .phone(let number): return number
        case .sms(let sms): return [sms.number, sms.body].compactMap { $0 }.joined(separator: "\n")
        case .wifi(let wifi): return "Network: \(wifi.ssid)\nSecurity: \(wifi.security)\nPassword: \(wifi.password ?? "none")"
        case .geo(let geo): return "\(geo.latitude), \(geo.longitude)"
        case .contact(let contact):
            return ([contact.name, contact.organization] + contact.phones.map(Optional.some) + contact.emails.map(Optional.some))
                .compactMap { $0 }.joined(separator: "\n")
        case .event(let event): return [event.summary, event.start, event.location].compactMap { $0 }.joined(separator: "\n")
        case .payment(let payment):
            return [payment.scheme.rawValue.uppercased(), payment.name, payment.iban ?? payment.address,
                    payment.amount.map { "\($0) \(payment.currency ?? "")" }].compactMap { $0 }.joined(separator: "\n")
        case .product(let product): return "GTIN \(product.gtin) (\(product.kind.rawValue))\nCheck digit \(product.checksumValid ? "valid" : "INVALID")"
        case .gs1(let gs1): return gs1.elements.map { "(\($0.ai)) \($0.title): \($0.value)" }.joined(separator: "\n")
        case .aamva(let id): return "\(id.fullName)\nDOB \(id.dateOfBirth)\nExpires \(id.expiryDate)\(id.isExpired ? " (expired)" : "")"
        case .text(let text): return text
        }
    }
}

private struct LabeledRow: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            Text(value)
                .textSelection(.enabled)
        }
    }
}
