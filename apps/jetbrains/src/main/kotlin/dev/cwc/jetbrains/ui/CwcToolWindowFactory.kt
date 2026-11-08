package dev.cwc.jetbrains.ui

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import dev.cwc.jetbrains.Runner
import dev.cwc.jetbrains.settings.CwcSettings
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JPanel
import javax.swing.ListSelectionModel

class CwcToolWindowFactory : ToolWindowFactory {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val content = ContentFactory.getInstance()
            .createContent(CwcPanel(project), "", false)
        content.isCloseable = false
        toolWindow.contentManager.addContent(content)
    }

    override fun shouldBeAvailable(project: Project): Boolean = true
}

/**
 * Tool window: context file picker, instructions box, chatbot and edit-format
 * selectors, and the Initialize button, plus the apply/undo entry points.
 */
class CwcPanel(private val project: Project) : JPanel(BorderLayout()) {

    private val instructions = JBTextArea(5, 40).apply {
        lineWrap = true
        wrapStyleWord = true
        emptyText.text = "Instructions (optional)"
    }

    private val chatbots = JComboBox(
        arrayOf("ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek", "Mistral", "Copilot")
    )

    private val editFormats = JComboBox(arrayOf("truncated", "whole", "diff", "search-replace"))

    private val filesModel = DefaultListModel<String>()
    private val filesList = JBList(filesModel)
    private val absoluteByRelative = mutableMapOf<String, String>()
    private val status = JBLabel("Ready")

    init {
        border = JBUI.Borders.empty(8)

        val settings = CwcSettings.getInstance().state
        chatbots.selectedItem = settings.lastChatbot
        editFormats.selectedItem = settings.editFormat

        filesList.selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
        filesList.addListSelectionListener {
            if (!it.valueIsAdjusting) {
                project.getService(CwcContext::class.java).selectedFiles =
                    filesList.selectedValuesList.mapNotNull { name -> absoluteByRelative[name] }
            }
        }

        val selectors = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply {
            add(JBLabel("Chatbot:"))
            add(chatbots)
            add(JBLabel("Format:"))
            add(editFormats)
        }

        val top = JPanel(BorderLayout(0, 4)).apply {
            add(JBLabel("Instructions"), BorderLayout.NORTH)
            add(JBScrollPane(instructions), BorderLayout.CENTER)
            add(selectors, BorderLayout.SOUTH)
        }

        val filesPane = JBScrollPane(filesList).apply {
            preferredSize = Dimension(320, 240)
            border = JBUI.Borders.emptyTop(6)
        }

        val fileButtons = JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply {
            add(JButton("Refresh").apply { addActionListener { refreshFiles() } })
            add(JButton("Select all").apply {
                addActionListener {
                    if (filesModel.size() > 0) filesList.setSelectionInterval(0, filesModel.size() - 1)
                }
            })
            add(JButton("Clear").apply { addActionListener { filesList.clearSelection() } })
        }

        val center = JPanel(BorderLayout(0, 4)).apply {
            add(JBLabel("Context files"), BorderLayout.NORTH)
            add(filesPane, BorderLayout.CENTER)
            add(fileButtons, BorderLayout.SOUTH)
        }

        val actions = JPanel(FlowLayout(FlowLayout.LEFT, 4, 4)).apply {
            add(JButton("Initialize").apply { addActionListener { initialize() } })
            add(JButton("Apply response").apply {
                addActionListener { Runner.applyFromClipboard(project, preview = true) }
            })
            add(JButton("Undo last changes").apply {
                addActionListener { Runner.revert(project) }
            })
        }

        val bottom = JPanel(BorderLayout()).apply {
            add(actions, BorderLayout.NORTH)
            add(status, BorderLayout.SOUTH)
        }

        add(top, BorderLayout.NORTH)
        add(center, BorderLayout.CENTER)
        add(bottom, BorderLayout.SOUTH)
    }

    private fun initialize() {
        val paths = filesList.selectedValuesList.mapNotNull { absoluteByRelative[it] }

        if (paths.isEmpty()) {
            Messages.showWarningDialog(
                project,
                "Select at least one context file.",
                "Code Web Chat"
            )
            return
        }

        val settings = CwcSettings.getInstance().state
        settings.lastChatbot = chatbots.selectedItem as String
        settings.editFormat = editFormats.selectedItem as String

        status.text = "Building prompt…"
        Runner.initialize(
            project,
            instructions.text,
            paths,
            settings.lastChatbot,
            settings.editFormat
        )
        status.text = "Prompt sent to the browser."
    }

    private fun refreshFiles() {
        status.text = "Loading workspace files…"

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val files = Runner.listFiles(project)
                ApplicationManager.getApplication().invokeLater {
                    absoluteByRelative.clear()
                    filesModel.clear()
                    files.forEach { (relative, absolute) ->
                        absoluteByRelative[relative] = absolute
                        filesModel.addElement(relative)
                    }
                    status.text = "${files.size} files — select the context"
                }
            } catch (t: Throwable) {
                ApplicationManager.getApplication().invokeLater {
                    status.text = t.message ?: "Could not list workspace files"
                }
            }
        }
    }
}
