package dev.cwc.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "CwcSettings", storages = [Storage("code-web-chat.xml")])
class CwcSettings : PersistentStateComponent<CwcSettings.State> {

    data class State(
        var nodePath: String = "",
        var sidecarPath: String = "",
        var port: Int = 55155,
        var lastChatbot: String = "ChatGPT",
        var editFormat: String = "truncated"
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    companion object {
        fun getInstance(): CwcSettings =
            ApplicationManager.getApplication().getService(CwcSettings::class.java)
    }
}
