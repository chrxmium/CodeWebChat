package dev.cwc.jetbrains.ui

/**
 * Context selection shared between the tool window (picker) and the host
 * handlers (`host.getSelectedFiles`). Absolute paths.
 */
class CwcContext {
    @Volatile
    var selectedFiles: List<String> = emptyList()
}
