Pod::Spec.new do |s|
  s.name             = 'QRGenKit'
  s.version          = '1.0.0'
  s.summary          = 'Open-source barcode, QR and ID scanning SDK for iOS and macOS.'
  s.description      = <<-DESC
    QRGenKit is the native Swift package of QRGen: a camera scanner engine built on
    AVFoundation and Vision (single, continuous and batch modes), a ready-made UIKit
    scanner screen with a SwiftUI wrapper, still-image scanning, Core Image code
    generation, and pure-Swift parsers for GS1 element strings, AAMVA driver licenses
    and common QR payloads (Wi-Fi, vCard, payments, ...).
  DESC
  s.homepage         = 'https://github.com/Rockyljewell/QR-GEN'
  s.license          = { :type => 'MIT', :file => 'LICENSE' }
  s.author           = 'QRGen contributors'
  s.source           = { :git => 'https://github.com/Rockyljewell/QR-GEN.git', :tag => "v#{s.version}" }
  s.documentation_url = 'https://github.com/Rockyljewell/QR-GEN/tree/main/packages/ios'

  s.ios.deployment_target = '15.0'
  s.osx.deployment_target = '12.0'
  s.swift_versions   = ['5.9', '5.10']

  s.source_files     = 'packages/ios/Sources/QRGenKit/**/*.swift'
  s.frameworks       = 'AVFoundation', 'Vision', 'CoreImage'
  s.ios.frameworks   = 'UIKit', 'AudioToolbox'
  s.osx.frameworks   = 'AppKit'
end
