@file:JvmName("QRGenCore")

package dev.qrgen

/** Version of the QRGen Kotlin SDK. */
public const val QRGEN_VERSION: String = "1.0.0"

/** SPEC §3.1 `parseContent(data)`. See [ContentParser]. */
public fun parseContent(data: String): ParsedContent = ContentParser.parse(data)

/** SPEC §3.2 `parseGS1(data)`. See [GS1]. */
public fun parseGS1(data: String): Gs1Result? = GS1.parse(data)

/** SPEC §3.3 `parseAAMVA(data)`. See [AAMVA]. */
public fun parseAAMVA(data: String): AamvaResult? = AAMVA.parse(data)

/** SPEC §7 `generate(data, { symbology, ... })` as SVG. See [Generator]. */
@JvmOverloads
public fun generateSvg(data: String, symbology: Symbology = Symbology.QR, options: GenerateOptions = GenerateOptions()): String =
    Generator.svg(data, symbology, options)

/** SPEC §7 `generate(data, { symbology, format: "png", ... })`. See [Generator]. */
@JvmOverloads
public fun generatePng(data: String, symbology: Symbology = Symbology.QR, options: GenerateOptions = GenerateOptions()): ByteArray =
    Generator.png(data, symbology, options)
