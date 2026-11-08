import org.gradle.api.tasks.bundling.Zip
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.6.0"
}

group = "dev.cwc"
version = "0.1.0"

val platformVersion: String by project
val platformSinceBuild: String by project
val platformUntilBuild: String by project
val cwcWebStorm: String by project

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        if (cwcWebStorm.toBoolean()) {
            // WebStorm requires a licence for runIde, but produces a plugin that
            // is installable in WebStorm and all other 2025.2 IDEs.
            webstorm(platformVersion)
        } else {
            // The plugin only uses platform APIs, so the free community platform
            // is enough to compile and run the sandbox.
            intellijIdeaCommunity(platformVersion)
        }
        pluginVerifier()
        zipSigner()
    }
    implementation("com.google.code.gson:gson:2.11.0")
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    // Deterministic sandbox/plugin directory name, also used by installSidecar.
    projectName = "code-web-chat"

    pluginConfiguration {
        name = "Code Web Chat"
        version = project.version.toString()

        description = """
            Autofill markdown prompts into web chatbots (ChatGPT, Claude, Gemini, …)
            and apply their responses with one click, for WebStorm and other
            JetBrains IDEs.

            Unofficial fork of robertpiosik/CodeWebChat by Robert Piosik
            (https://github.com/CodeWebChat/CWC). Not affiliated with, endorsed by
            or supported by the upstream author.
        """.trimIndent()

        vendor {
            name = "Code Web Chat fork contributors"
            url = "https://github.com/chrxmium/CodeWebChat"
        }

        ideaVersion {
            sinceBuild = platformSinceBuild
            untilBuild = platformUntilBuild
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

/**
 * Copies the built sidecar next to the plugin so it is bundled in the archive.
 * `pnpm --filter @cwc/sidecar build` must run first.
 */
val bundleSidecar by tasks.registering(Copy::class) {
    val source = layout.projectDirectory.dir("../sidecar/out")
    from(source)
    into(layout.buildDirectory.dir("sidecar"))
    doFirst {
        if (!source.asFile.exists()) {
            throw GradleException(
                "Sidecar build not found at ${source.asFile}. Run `pnpm --filter @cwc/sidecar build` first."
            )
        }
    }
}

/**
 * Places the sidecar next to the plugin in the sandbox so `runIde` can spawn it
 * and `buildPlugin` picks it up when zipping the distribution.
 */
val installSidecar by tasks.registering(Copy::class) {
    dependsOn(bundleSidecar)
    from(layout.buildDirectory.dir("sidecar"))
    into(layout.buildDirectory.dir("sandbox").map { it.dir("code-web-chat/sidecar") })
}

tasks.named<PrepareSandboxTask>("prepareSandbox") {
    finalizedBy(installSidecar)
}

/**
 * The packaged distribution must carry the sidecar too, so the ZIP is
 * self-contained: `<plugin>/sidecar/sidecar.js`.
 */
tasks.named<Zip>("buildPlugin") {
    dependsOn(bundleSidecar)
    from(layout.buildDirectory.dir("sidecar")) {
        into("sidecar")
    }
}

tasks.build {
    dependsOn(bundleSidecar)
}

/**
 * `buildSearchableOptions` starts a full IDE to index the plugin's settings for
 * the IDE's Settings search. That needs a display, and headless CI (this
 * environment included) has none, so it is disabled. Only the settings-search
 * entry is affected; the plugin itself is unaffected.
 */
tasks.matching { it.name == "buildSearchableOptions" }.configureEach {
    enabled = false
}
