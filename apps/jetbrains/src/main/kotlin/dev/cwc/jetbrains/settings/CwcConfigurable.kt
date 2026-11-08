package dev.cwc.jetbrains.settings

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel

class CwcConfigurable : Configurable {

    private var panel: JPanel? = null
    private val nodePath = JBTextField()
    private val sidecarPath = JBTextField()
    private val port = JBTextField()

    override fun getDisplayName(): String = "Code Web Chat"

    override fun createComponent(): JComponent {
        if (panel == null) {
            panel = FormBuilder.createFormBuilder()
                .addLabeledComponent(
                    JBLabel("Node path (leave empty to use the PATH):"),
                    nodePath
                )
                .addLabeledComponent(
                    JBLabel("Sidecar script (optional override):"),
                    sidecarPath
                )
                .addLabeledComponent(JBLabel("WebSocket port:"), port)
                .addComponentFillVertically(JPanel(), 0)
                .panel
        }
        reset()
        return panel!!
    }

    override fun isModified(): Boolean {
        val state = CwcSettings.getInstance().state
        return nodePath.text.trim() != state.nodePath ||
            sidecarPath.text.trim() != state.sidecarPath ||
            (port.text.trim().toIntOrNull() ?: 0) != state.port
    }

    override fun apply() {
        val state = CwcSettings.getInstance().state
        state.nodePath = nodePath.text.trim()
        state.sidecarPath = sidecarPath.text.trim()
        port.text.trim().toIntOrNull()?.let { state.port = it }
    }

    override fun reset() {
        val state = CwcSettings.getInstance().state
        nodePath.text = state.nodePath
        sidecarPath.text = state.sidecarPath
        port.text = state.port.toString()
    }

    override fun disposeUIResources() {
        panel = null
    }
}
