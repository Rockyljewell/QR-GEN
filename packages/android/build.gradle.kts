import org.gradle.api.publish.PublishingExtension
import org.gradle.api.publish.maven.MavenPublication

plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.application) apply false
}

// JitPack exports JITPACK=true plus GROUP (com.github.<user>), ARTIFACT (<repo>) and
// VERSION (<tag or commit>). Multi-module builds are served as
// com.github.<user>.<repo>:<module>:<version>, so inter-module POM dependencies must
// use the same coordinates.
val onJitPack = System.getenv("JITPACK") == "true"
val publishGroup: String = if (onJitPack && System.getenv("GROUP") != null && System.getenv("ARTIFACT") != null) {
    "${System.getenv("GROUP")}.${System.getenv("ARTIFACT")}"
} else {
    providers.gradleProperty("qrgen.group").get()
}
val publishVersion: String = if (onJitPack && !System.getenv("VERSION").isNullOrBlank()) {
    System.getenv("VERSION")
} else {
    providers.gradleProperty("qrgen.version").get()
}

allprojects {
    group = publishGroup
    version = publishVersion
}

subprojects {
    plugins.withId("maven-publish") {
        extensions.configure<PublishingExtension> {
            publications.withType<MavenPublication>().configureEach {
                pom {
                    name.set(project.name)
                    description.set(provider { project.description ?: "QRGen barcode, QR and ID scanning SDK" })
                    url.set("https://github.com/Rockyljewell/QR-GEN")
                    inceptionYear.set("2026")
                    licenses {
                        license {
                            name.set("MIT License")
                            url.set("https://opensource.org/licenses/MIT")
                            distribution.set("repo")
                        }
                    }
                    developers {
                        developer {
                            id.set("Rockyljewell")
                            name.set("QRGen contributors")
                            url.set("https://github.com/Rockyljewell/QR-GEN")
                        }
                    }
                    scm {
                        url.set("https://github.com/Rockyljewell/QR-GEN")
                        connection.set("scm:git:https://github.com/Rockyljewell/QR-GEN.git")
                        developerConnection.set("scm:git:ssh://git@github.com/Rockyljewell/QR-GEN.git")
                    }
                    issueManagement {
                        system.set("GitHub")
                        url.set("https://github.com/Rockyljewell/QR-GEN/issues")
                    }
                }
            }
        }
    }
}
