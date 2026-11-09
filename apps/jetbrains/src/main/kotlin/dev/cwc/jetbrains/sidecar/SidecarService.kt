package dev.cwc.jetbrains.sidecar

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import dev.cwc.jetbrains.Runner
import dev.cwc.jetbrains.settings.CwcSettings
import java.io.File
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class SidecarService(private val project: Project) : Disposable {

    private val log = Logger.getInstance(SidecarService::class.java)
    private var process: Process? = null
    private var client: JsonRpcClient? = null
    private var ready: CompletableFuture<Int> = CompletableFuture()

    @Synchronized
    fun getClient(): JsonRpcClient {
        client?.let { return it }
        return start()
    }

    private fun start(): JsonRpcClient {
        val state = CwcSettings.getInstance().state
        val script = resolveScript()
        val node = state.nodePath.ifBlank { "node" }

        log.info("Starting sidecar: $node $script --port ${state.port}")

        val builder = ProcessBuilder(
            node,
            script.absolutePath,
            "--port",
            state.port.toString()
        )
        builder.directory(project.basePath?.let { File(it) })
        builder.redirectErrorStream(false)
        builder.redirectError(ProcessBuilder.Redirect.INHERIT)

        val started = try {
            builder.start()
        } catch (e: Exception) {
            throw SidecarException(
                "Could not start Node ('$node'). Set the Node path in Settings → Tools → Code Web Chat. ${e.message}"
            )
        }

        val newClient = JsonRpcClient(started.outputStream, started.inputStream)
        IdeHostHandler(project).register(newClient)

        ready = CompletableFuture()
        newClient.notificationHandler = { method, params ->
            when (method) {
                "sidecar.ready" -> {
                    val port = params.get("port")?.asInt ?: state.port
                    ready.complete(port)
                    log.info("Sidecar ready on port $port")
                }

                "browsers.changed" -> log.debug("Browsers changed: $params")

                "chat.applyResponse" -> {
                    // The Apply button is an alias for copy-to-clipboard, so the
                    // response is already in the clipboard: apply it, with preview.
                    Runner.applyFromClipboard(project, preview = true, automatic = true)
                }

                "host.info" -> notify(params.get("message")?.asString ?: "", NotificationType.INFORMATION)
                "host.error" -> notify(params.get("message")?.asString ?: "", NotificationType.ERROR)
            }
        }

        process = started
        client = newClient

        try {
            ready.get(20, TimeUnit.SECONDS)
        } catch (e: Exception) {
            started.destroy()
            process = null
            client = null
            throw SidecarException(
                "The Code Web Chat sidecar did not become ready. See the IDE log for its stderr output."
            )
        }

        return newClient
    }

    /**
     * Resolution order: explicit setting, bundled sidecar next to the plugin,
     * then the repository build output (useful with `./gradlew runIde`).
     */
    private fun resolveScript(): File {
        val configured = CwcSettings.getInstance().state.sidecarPath
        if (configured.isNotBlank()) {
            val file = File(configured)
            if (file.isFile) return file
            throw SidecarException("Sidecar script not found: $configured")
        }

        val pluginPath: Path? = PluginManagerCore
            .getPlugin(PluginId.getId("dev.cwc.jetbrains"))
            ?.pluginPath

        val candidates = mutableListOf<File>()
        pluginPath?.let {
            candidates.add(it.resolve("sidecar").resolve("sidecar.js").toFile())
            candidates.add(it.resolve("sidecar").resolve("out").resolve("sidecar.js").toFile())
        }
        candidates.add(File("apps/sidecar/out/sidecar.js"))
        candidates.add(File("../sidecar/out/sidecar.js"))

        return candidates.firstOrNull { it.isFile }
            ?: throw SidecarException(
                "Sidecar bundle not found. Build it with `pnpm --filter @cwc/sidecar build`, " +
                    "or set its path in Settings → Tools → Code Web Chat."
            )
    }

    private fun notify(message: String, type: NotificationType) {
        if (message.isBlank()) return
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Code Web Chat")
                .createNotification(message, type)
                .notify(project)
        }
    }

    override fun dispose() {
        try {
            process?.destroy()
        } catch (_: Exception) {
        }
        process = null
        client = null
    }

    companion object {
        fun getInstance(project: Project): SidecarService =
            project.getService(SidecarService::class.java)
    }
}
