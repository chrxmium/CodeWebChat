import org.gradle.api.tasks.bundling.Zip
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.3.10"
    id("org.jetbrains.intellij.platform") version "2.20.0"
}

group = "dev.cwc"
version = "0.1.0"

val platformVersion = providers.gradleProperty("platformVersion").get()
val platformSinceBuild = providers.gradleProperty("platformSinceBuild").get()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // WebStorm 2026.2.3 (WS-262.10968.77) is the target: the plugin is built
        // and packaged against the IDE it ships for. `runIde` needs an activated
        // WebStorm licence, but compiling and packaging do not.
        webstorm(platformVersion)
        pluginVerifier()
        zipSigner()
    }
    implementation("com.google.code.gson:gson:2.11.0")
}

kotlin {
    // The 262 platform requires Java 21 bytecode for plugins.
    jvmToolchain(21)

    // Deprecations against the 262 platform must break the build, not scroll by.
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
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
            // No untilBuild: the plugin stays installable in every later 262+ build.
            sinceBuild = platformSinceBuild
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
val bundleSidecar = tasks.register<Copy>("bundleSidecar") {
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
val installSidecar = tasks.register<Copy>("installSidecar") {
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
