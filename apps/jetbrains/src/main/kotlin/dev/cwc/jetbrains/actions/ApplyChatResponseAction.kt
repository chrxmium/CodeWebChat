package dev.cwc.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import dev.cwc.jetbrains.Runner

/**
 * Apply Chat Response (from clipboard). The Connector's Apply button only copies
 * the response, so this action is a thin wrapper over the clipboard.
 */
class ApplyChatResponseAction : AnAction() {

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        Runner.applyFromClipboard(project, preview = true)
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible = event.project != null
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
