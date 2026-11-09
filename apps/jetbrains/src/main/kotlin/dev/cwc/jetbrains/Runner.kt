package dev.cwc.jetbrains

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import dev.cwc.jetbrains.sidecar.SidecarException
import dev.cwc.jetbrains.sidecar.SidecarService
import java.awt.datatransfer.DataFlavor

/**
 * All plugin operations funnel through here so the actions and the tool window
 * (and the automatic Apply-button flow) behave identically.
 */
object Runner {

    fun initialize(
        project: Project,
        instructions: String,
        paths: List<String>,
        chatbot: String,
        editFormat: String
    ) {
        run(project, "Initializing chat") {
            val client = SidecarService.getInstance(project).getClient()

            val buildParams = JsonObject().apply {
                addProperty("instructions", instructions)
                addProperty("prompt_type", "edit")
                addProperty("edit_format", editFormat)
                val array = JsonArray()
                paths.forEach { array.add(it) }
                add("paths", array)
            }

            val built = client.request("prompt.build", buildParams)
            val text = built.get("text")?.asString ?: ""

            val initParams = JsonObject().apply {
                addProperty("text", text)
                addProperty("chatbot", chatbot)
                addProperty("raw_instructions", instructions)
                addProperty("inject_apply_response_button", true)
            }

            val result = client.request("chat.initialize", initParams)
            val browser = result.getAsJsonObject("browser")
            val label = browser?.get("profile_name")?.takeIf { !it.isJsonNull }?.asString
                ?: "browser"

            notify(project, "Prompt sent to $label. Continue in the browser.", NotificationType.INFORMATION)
        }
    }

    fun applyFromClipboard(project: Project, preview: Boolean, automatic: Boolean = false) {
        val clipboard = CopyPasteManager.getInstance()
            .getContents<String>(DataFlavor.stringFlavor)

        if (clipboard.isNullOrBlank()) {
            notify(project, "The clipboard is empty.", NotificationType.WARNING)
            return
        }

        run(project, if (automatic) "Applying chat response" else "Applying clipboard") {
            val client = SidecarService.getInstance(project).getClient()

            val params = JsonObject().apply {
                addProperty("response", clipboard)
                addProperty("preview", preview)
            }

            val result = client.request("response.apply", params, timeoutSeconds = 600)
            val applied = result.getAsJsonArray("applied")?.size() ?: 0
            val error = result.get("error")?.takeIf { !it.isJsonNull }?.asString

            when {
                error != null -> notify(project, error, NotificationType.WARNING)
                applied == 0 -> notify(project, "No file changes were applied.", NotificationType.WARNING)
                else -> notify(
                    project,
                    "Applied changes to $applied file(s).",
                    NotificationType.INFORMATION
                )
            }
        }
    }

    fun revert(project: Project) {
        run(project, "Undoing last changes") {
            val client = SidecarService.getInstance(project).getClient()
            val result = client.request("response.revert")

            val error = result.get("error")?.takeIf { !it.isJsonNull }?.asString
            val reverted = result.getAsJsonArray("reverted")?.size() ?: 0
            val failed = result.getAsJsonArray("failed")?.size() ?: 0

            when {
                error != null -> notify(project, error, NotificationType.INFORMATION)
                failed > 0 -> notify(
                    project,
                    "Reverted $reverted file(s), $failed failed. See the IDE log.",
                    NotificationType.WARNING
                )
                else -> notify(project, "Reverted $reverted file(s).", NotificationType.INFORMATION)
            }
        }
    }

    /** File picker contents for the tool window. */
    fun listFiles(project: Project): List<Pair<String, String>> {
        val client = SidecarService.getInstance(project).getClient()
        val result = client.request("workspace.files", timeoutSeconds = 60)
        val files = result.getAsJsonArray("files") ?: return emptyList()

        return files.mapNotNull { element ->
            val file = element.asJsonObject
            val relative = file.get("relative")?.asString ?: return@mapNotNull null
            val absolute = file.get("absolute")?.asString ?: return@mapNotNull null
            relative to absolute
        }
    }

    private fun run(project: Project, title: String, action: () -> Unit) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, title, false) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    action()
                } catch (e: SidecarException) {
                    notify(project, e.message ?: "Code Web Chat failed.", NotificationType.ERROR)
                } catch (t: Throwable) {
                    notify(
                        project,
                        "Code Web Chat failed: ${t.message ?: t.toString()}",
                        NotificationType.ERROR
                    )
                }
            }
        })
    }

    private fun notify(project: Project, message: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Code Web Chat")
                .createNotification(message, type)
                .notify(project)
        }
    }
}
