package dev.cwc.jetbrains.sidecar

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.diff.DiffContentFactory
import com.intellij.diff.DiffManager
import com.intellij.diff.requests.SimpleDiffRequest
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import dev.cwc.jetbrains.ui.CwcContext
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Answers the sidecar's `host.*` requests. All writes go through
 * `WriteCommandAction`, so they are undoable with Ctrl+Z and the VFS keeps up.
 * Diffs are shown with `DiffManager` before the sidecar applies anything.
 */
class IdeHostHandler(private val project: Project) {

    private val skippedDirectories = setOf(
        "node_modules", ".git", "dist", "build", "target", "vendor", ".venv", "bin", "obj"
    )

    fun register(client: JsonRpcClient) {
        client.on("host.getWorkspaceRoots") { getWorkspaceRoots() }
        client.on("host.readFile") { params -> readFile(params) }
        client.on("host.writeFile") { params -> writeFile(params) }
        client.on("host.deleteFile") { params -> deleteFile(params) }
        client.on("host.renameFile") { params -> renameFile(params) }
        client.on("host.exists") { params -> exists(params) }
        client.on("host.listWorkspaceFiles") { params -> listWorkspaceFiles(params) }
        client.on("host.getSelectedFiles") {
            JsonObject().apply {
                add("files", toArray(project.getService(CwcContext::class.java).selectedFiles))
            }
        }
        client.on("host.confirmChanges") { params -> confirmChanges(params) }
    }

    private fun getWorkspaceRoots(): JsonObject {
        val roots = JsonArray()
        ProjectRootManager.getInstance(project).contentRoots.forEach { root ->
            roots.add(
                JsonObject().apply {
                    addProperty("name", root.name)
                    addProperty("path", root.path)
                }
            )
        }
        return JsonObject().apply { add("roots", roots) }
    }

    private fun readFile(params: JsonObject): JsonObject {
        val path = params.get("path").asString
        val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
        val content = if (file == null || file.isDirectory) null else readText(file)
        return JsonObject().apply {
            if (content == null) add("content", null) else addProperty("content", content)
        }
    }

    private fun writeFile(params: JsonObject): JsonElement {
        val path = Paths.get(params.get("path").asString)
        val content = params.get("content").asString

        onEdt {
            Files.createDirectories(path.parent)

            WriteCommandAction.runWriteCommandAction(project) {
                val vfs = LocalFileSystem.getInstance()
                val parent = VfsUtil.createDirectoryIfMissing(path.parent.toString())
                    ?: error("Cannot create ${path.parent}")
                val file = parent.findChild(path.fileName.toString())
                    ?: parent.createChildData(project, path.fileName.toString())

                val document = FileDocumentManager.getInstance().getDocument(file)
                if (document != null) {
                    document.setText(content)
                    FileDocumentManager.getInstance().saveDocument(document)
                } else {
                    VfsUtil.saveText(file, content)
                }
            }
        }

        return JsonObject()
    }

    private fun deleteFile(params: JsonObject): JsonElement {
        val path = params.get("path").asString
        onEdt {
            WriteCommandAction.runWriteCommandAction(project) {
                LocalFileSystem.getInstance()
                    .refreshAndFindFileByPath(path)
                    ?.delete(project)
            }
        }
        return JsonObject()
    }

    private fun renameFile(params: JsonObject): JsonElement {
        val from = Paths.get(params.get("from").asString)
        val to = Paths.get(params.get("to").asString)

        onEdt {
            Files.createDirectories(to.parent)
            WriteCommandAction.runWriteCommandAction(project) {
                val source = LocalFileSystem.getInstance()
                    .refreshAndFindFileByPath(from.toString()) ?: return@runWriteCommandAction
                val targetParent = VfsUtil.createDirectoryIfMissing(to.parent.toString())
                    ?: return@runWriteCommandAction

                source.move(project, targetParent)
                if (source.name != to.fileName.toString()) {
                    source.rename(project, to.fileName.toString())
                }
            }
        }
        return JsonObject()
    }

    private fun exists(params: JsonObject): JsonObject {
        val path = params.get("path").asString
        val file = LocalFileSystem.getInstance().refreshAndFindFileByPath(path)
        return JsonObject().apply { addProperty("exists", file != null) }
    }

    private fun listWorkspaceFiles(params: JsonObject): JsonObject {
        val rootPath = params.getAsJsonObject("root")?.get("path")?.asString
            ?: return JsonObject().apply { add("files", JsonArray()) }

        val root = LocalFileSystem.getInstance().refreshAndFindFileByPath(rootPath)
            ?: return JsonObject().apply { add("files", JsonArray()) }

        val files = mutableListOf<String>()
        VfsUtilCore.iterateChildrenRecursively(
            root,
            { child: VirtualFile ->
                child.isDirectory && child.name !in skippedDirectories && !child.name.startsWith(".")
            }
        ) { child: VirtualFile ->
            if (!child.isDirectory) {
                VfsUtilCore.getRelativePath(child, root, '/')?.let { files.add(it) }
            }
            true
        }

        files.sort()
        return JsonObject().apply { add("files", toArray(files)) }
    }

    /**
     * Shows each change with `DiffManager` and asks the user, mirroring the VS
     * Code preview: Apply / Skip / Cancel all.
     */
    private fun confirmChanges(params: JsonObject): JsonObject {
        val changes = params.getAsJsonArray("changes") ?: JsonArray()
        val accepted = JsonArray()

        for (element in changes) {
            val change = element.asJsonObject
            val id = change.get("id").asString
            val fileName = change.get("file_path").asString
            val original = change.get("content")?.asString ?: ""
            val proposed = change.get("proposed_content")?.asString ?: ""

            var choice = 0
            onEdt {
                val request = SimpleDiffRequest(
                    "Code Web Chat: $fileName",
                    DiffContentFactory.getInstance().create(original),
                    DiffContentFactory.getInstance().create(proposed),
                    "$fileName (original)",
                    "$fileName (proposed)"
                )
                DiffManager.getInstance().showDiff(project, request)

                choice = Messages.showDialog(
                    project,
                    "Apply the changes to $fileName?",
                    "Code Web Chat",
                    arrayOf("Apply", "Skip", "Cancel all"),
                    0,
                    Messages.getQuestionIcon()
                )
            }

            when (choice) {
                0 -> accepted.add(id)
                2 -> return JsonObject().apply { addProperty("cancel", true) }
                else -> Unit
            }
        }

        return JsonObject().apply { add("acceptedIds", accepted) }
    }

    private fun readText(file: VirtualFile): String? {
        val document = FileDocumentManager.getInstance().getDocument(file)
        if (document != null) return document.text
        return try {
            VfsUtilCore.loadText(file)
        } catch (_: Exception) {
            null
        }
    }

    private fun onEdt(action: () -> Unit) {
        if (ApplicationManager.getApplication().isDispatchThread) {
            action()
        } else {
            ApplicationManager.getApplication().invokeAndWait(action)
        }
    }

    private fun toArray(values: Collection<String>): JsonArray {
        val array = JsonArray()
        values.forEach { array.add(it) }
        return array
    }
}
