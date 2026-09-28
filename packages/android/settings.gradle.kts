// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "qrgen-android-sdk"

// Pure Kotlin/JVM core: symbologies, result model, parsers, generator, tracker.
// Builds and tests everywhere, no Android SDK required.
include(":qrgen-core")

/**
 * The Android modules need an Android SDK. They are included when one is found
 * (ANDROID_HOME / ANDROID_SDK_ROOT / sdk.dir in local.properties) so that
 * `./gradlew :qrgen-core:test` keeps working on machines without it.
 * Force with `-Pqrgen.android=true` or `-Pqrgen.android=false`.
 */
fun androidSdkAvailable(): Boolean {
    val candidates = mutableListOf(System.getenv("ANDROID_HOME"), System.getenv("ANDROID_SDK_ROOT"))
    val localProperties = file("local.properties")
    if (localProperties.isFile) {
        val props = java.util.Properties()
        localProperties.inputStream().use { props.load(it) }
        candidates += props.getProperty("sdk.dir")
    }
    return candidates.any { !it.isNullOrBlank() && file(it).isDirectory }
}

val androidMode = providers.gradleProperty("qrgen.android").getOrElse("auto").lowercase()
val includeAndroid = when (androidMode) {
    "true" -> true
    "false" -> false
    else -> androidSdkAvailable()
}

if (includeAndroid) {
    include(":qrgen-android")
    include(":qrgen-compose")
    include(":sample")
} else {
    logger.lifecycle("QRGen: no Android SDK found; building :qrgen-core only (set ANDROID_HOME to include the Android modules).")
}
