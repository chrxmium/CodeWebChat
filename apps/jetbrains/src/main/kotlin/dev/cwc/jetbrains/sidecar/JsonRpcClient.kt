package dev.cwc.jetbrains.sidecar

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStream
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

class SidecarException(message: String) : RuntimeException(message)

/**
 * Newline-delimited JSON-RPC 2.0 client for the Node sidecar.
 * Requests are matched by id; notifications are handed to [notificationHandler].
 */
class JsonRpcClient(output: OutputStream, input: InputStream) {

    private val gson = Gson()
    private val out = output
    private val pending = ConcurrentHashMap<Long, CompletableFuture<JsonObject>>()
    private val handlers = ConcurrentHashMap<String, (JsonObject) -> JsonElement?>()
    private val nextId = AtomicLong(1)

    @Volatile
    var notificationHandler: ((String, JsonObject) -> Unit)? = null

    init {
        thread(isDaemon = true, name = "cwc-sidecar-reader") {
            try {
                BufferedReader(InputStreamReader(input)).forEachLine { handleLine(it) }
            } catch (_: Exception) {
                // stream closed
            } finally {
                pending.values.forEach {
                    it.completeExceptionally(SidecarException("The sidecar process ended."))
                }
                pending.clear()
            }
        }
    }

    fun on(method: String, handler: (JsonObject) -> JsonElement?) {
        handlers[method] = handler
    }

    fun request(method: String, params: JsonObject? = null, timeoutSeconds: Long = 180): JsonObject {
        val id = nextId.getAndIncrement()
        val future = CompletableFuture<JsonObject>()
        pending[id] = future

        val message = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            addProperty("method", method)
            if (params != null) add("params", params)
        }
        send(message)

        return try {
            future.get(timeoutSeconds, TimeUnit.SECONDS)
        } catch (e: Exception) {
            pending.remove(id)
            throw SidecarException(
                e.cause?.message ?: "Timed out waiting for '$method' from the sidecar."
            )
        }
    }

    fun notify(method: String, params: JsonObject? = null) {
        val message = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("method", method)
            if (params != null) add("params", params)
        }
        send(message)
    }

    private fun send(message: JsonObject) {
        synchronized(out) {
            out.write((gson.toJson(message) + "\n").toByteArray(Charsets.UTF_8))
            out.flush()
        }
    }

    private fun handleLine(line: String) {
        if (line.isBlank()) return

        val message = try {
            gson.fromJson(line, JsonObject::class.java)
        } catch (_: Exception) {
            return
        } ?: return

        val method = message.get("method")?.takeIf { it.isJsonPrimitive }?.asString
        val id = message.get("id")?.takeIf { it.isJsonPrimitive }?.asLong
        val params = message.get("params")?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()

        when {
            method != null && id == null -> notificationHandler?.invoke(method, params)

            method != null -> handleRequest(id!!, method, params)

            id != null -> {
                val future = pending.remove(id) ?: return
                val error = message.get("error")
                if (error != null && error.isJsonObject) {
                    future.completeExceptionally(
                        SidecarException(
                            error.asJsonObject.get("message")?.asString ?: "Sidecar error"
                        )
                    )
                } else {
                    val result = message.get("result")
                    future.complete(
                        if (result != null && result.isJsonObject) result.asJsonObject else JsonObject()
                    )
                }
            }
        }
    }

    private fun handleRequest(id: Long, method: String, params: JsonObject) {
        val handler = handlers[method]

        val response = JsonObject().apply {
            addProperty("jsonrpc", "2.0")
            addProperty("id", id)
            if (handler == null) {
                add(
                    "error",
                    JsonObject().apply {
                        addProperty("code", -32601)
                        addProperty("message", "Unknown method: $method")
                    }
                )
            } else {
                try {
                    val result = handler(params)
                    if (result != null) add("result", result) else add("result", JsonObject())
                } catch (t: Throwable) {
                    add(
                        "error",
                        JsonObject().apply {
                            addProperty("code", -32000)
                            addProperty("message", t.message ?: t.toString())
                        }
                    )
                }
            }
        }

        send(response)
    }
}
