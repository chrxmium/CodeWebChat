// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let fs = require("fs");
fs = __toESM(fs);
let readline = require("readline");
readline = __toESM(readline);
let crypto = require("crypto");
crypto = __toESM(crypto);
let http = require("http");
http = __toESM(http);
let os = require("os");
os = __toESM(os);
let path = require("path");
path = __toESM(path);
let ws = require("ws");
// src/json-rpc.ts
/**
* Minimal JSON-RPC 2.0 peer over a newline-delimited stream. Used instead of a
* heavier framework so the Kotlin side can speak it with three lines of code.
*/
var JsonRpcPeer = class {
	constructor(send_line) {
		this.send_line = send_line;
		this.next_id = 1;
		this.pending = /* @__PURE__ */ new Map();
		this.handlers = /* @__PURE__ */ new Map();
	}
	register(method, handler) {
		this.handlers.set(method, handler);
	}
	request(method, params) {
		const id = this.next_id++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve,
				reject
			});
			this.send_line(JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params
			}));
		});
	}
	notify(method, params) {
		this.send_line(JSON.stringify({
			jsonrpc: "2.0",
			method,
			params
		}));
	}
	handle_line(line) {
		const trimmed = line.trim();
		if (!trimmed) return;
		let message;
		try {
			message = JSON.parse(trimmed);
		} catch {
			return;
		}
		if (message?.method && message.id === void 0) {
			this.on_notification?.(message.method, message.params);
			return;
		}
		if (message?.method && message.id !== void 0) {
			this.handle_request(message);
			return;
		}
		if (message?.id !== void 0 && this.pending.has(message.id)) {
			const entry = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) entry.reject(new Error(message.error.message ?? "JSON-RPC request failed"));
			else entry.resolve(message.result);
		}
	}
	async handle_request(message) {
		const handler = this.handlers.get(message.method);
		if (!handler) {
			this.send_line(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				error: {
					code: -32601,
					message: `Unknown method: ${message.method}`
				}
			}));
			return;
		}
		try {
			const result = await handler(message.params);
			this.send_line(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				result
			}));
		} catch (error) {
			this.send_line(JSON.stringify({
				jsonrpc: "2.0",
				id: message.id,
				error: {
					code: -32e3,
					message: error.message
				}
			}));
		}
	}
};
// ../../packages/shared/src/constants/websocket.ts
var DEFAULT_PORT = 55155;
var CLIENT_TYPE = {
	BROWSER: "browser",
	EDITOR: "editor"
};
// src/websocket-server.ts
var CHROME_EXTENSION_ID = "ljookipcanaglfaocjbgdicfbdhhjffp";
var get_or_create_shared_token = () => {
	const token_dir = path.join(os.homedir(), ".cwc");
	const token_path = path.join(token_dir, ".websocket-token");
	if (fs.existsSync(token_path)) return fs.readFileSync(token_path, "utf8").trim();
	const token = crypto.randomBytes(32).toString("hex");
	if (!fs.existsSync(token_dir)) fs.mkdirSync(token_dir, {
		recursive: true,
		mode: 448
	});
	fs.writeFileSync(token_path, token, { mode: 384 });
	return token;
};
/**
* Same handshake, authentication and routing as the VS Code extension's
* `websocket-server-process.ts`, so the unmodified Connector (Chrome MV3 and
* Firefox MV2) keeps working. The plugin is the "editor": it never connects as a
* WebSocket client, it speaks JSON-RPC with this process instead.
*/
var ConnectorServer = class {
	constructor(options) {
		this.options = options;
		this.vscode_clients = /* @__PURE__ */ new Map();
		this.browser_clients = /* @__PURE__ */ new Map();
		this.connections = /* @__PURE__ */ new Set();
		this.ping_timer = null;
		this.editor_client_id = `jetbrains-${crypto.randomUUID()}`;
		this.http_server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "", "http://localhost");
			if (url.pathname === "/health") {
				const challenge = url.searchParams.get("challenge");
				const token = get_or_create_shared_token();
				const body = { status: "ok" };
				if (challenge) body.signature = crypto.createHmac("sha256", token).update(challenge).digest("hex");
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(body));
				return;
			}
			res.writeHead(404);
			res.end();
		});
		this.wss = new ws.WebSocketServer({
			server: this.http_server,
			maxPayload: 10485760,
			verifyClient: (info, cb) => this.verify_client(info, cb)
		});
		this.wss.on("connection", (ws, request) => this.handle_connection(ws, request));
	}
	verify_client(info, cb) {
		const client_type = new URL(info.req.url ?? "", "http://localhost").searchParams.get("client_type");
		if (client_type === CLIENT_TYPE.BROWSER) {
			const origin = info.req.headers.origin;
			if (origin === `chrome-extension://${CHROME_EXTENSION_ID}`) return cb(true);
			const dev_id = process.env.DEV_CHROME_EXTENSION_ID;
			if (dev_id && origin === `chrome-extension://${dev_id}`) return cb(true);
			if (origin && origin.startsWith("moz-extension://")) return cb(true);
			return cb(false, 403, "Forbidden: Invalid Origin");
		}
		if (client_type === CLIENT_TYPE.EDITOR) {
			const header = info.req.headers.authorization;
			const provided = header?.startsWith("Bearer ") ? header.substring(7) : null;
			if (provided && provided === get_or_create_shared_token()) return cb(true);
			return cb(false, 401, "Unauthorized: Invalid token");
		}
		cb(false, 400, "Bad Request");
	}
	handle_connection(ws, request) {
		const url = new URL(request.url ?? "", "http://localhost");
		const client_type = url.searchParams.get("client_type");
		if (client_type !== CLIENT_TYPE.BROWSER && client_type !== CLIENT_TYPE.EDITOR) {
			ws.close(1008, "Invalid client type");
			return;
		}
		const is_browser = client_type === CLIENT_TYPE.BROWSER;
		if (is_browser) {
			const id = url.searchParams.get("browser_id") || crypto.randomUUID();
			this.browser_clients.set(id, {
				id,
				version: url.searchParams.get("version") || "unknown",
				user_agent: url.searchParams.get("user_agent") || "unknown",
				profile_name: url.searchParams.get("profile_name") || void 0,
				ws,
				is_alive: true
			});
			this.notify_browsers_changed();
			ws.send(JSON.stringify({
				action: "connected",
				id
			}));
		} else {
			const client_id = crypto.randomUUID();
			this.vscode_clients.set(client_id, {
				ws,
				client_id,
				is_alive: true
			});
			ws.send(JSON.stringify({
				action: "client-id-assignment",
				client_id
			}));
			ws.send(JSON.stringify({
				action: "browser-connection-status",
				connected_browsers: this.get_browsers()
			}));
			for (const browser of this.browser_clients.values()) browser.ws.send(JSON.stringify({
				action: "vscode-client-connected",
				client_id
			}));
		}
		this.connections.add(ws);
		ws.on("error", () => {});
		ws.on("message", (data) => this.handle_message(data.toString(), ws));
		ws.on("close", () => this.handle_disconnection(ws, is_browser, url));
	}
	handle_message(raw, ws$1) {
		let message;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (!message || typeof message !== "object") return;
		if (message.action === "pong") {
			this.mark_alive(ws$1);
			return;
		}
		if (message.action === "initialize-chat") {
			const target = message.target_browser_id ? this.browser_clients.get(message.target_browser_id) : Array.from(this.browser_clients.values()).pop();
			if (target && target.ws.readyState === ws.WebSocket.OPEN) target.ws.send(raw);
			return;
		}
		if (message.action === "apply-response") {
			this.options.on_apply_response(message);
			const editor = this.vscode_clients.get(message.client_id);
			if (editor && editor.ws.readyState === ws.WebSocket.OPEN) editor.ws.send(raw);
			return;
		}
		if (message.action === "forwarded-ports") for (const browser of this.browser_clients.values()) browser.ws.send(raw);
	}
	mark_alive(ws) {
		for (const client of this.browser_clients.values()) if (client.ws === ws) {
			client.is_alive = true;
			return;
		}
		for (const client of this.vscode_clients.values()) if (client.ws === ws) {
			client.is_alive = true;
			return;
		}
	}
	handle_disconnection(ws, is_browser, _url) {
		if (is_browser) {
			for (const [id, client] of this.browser_clients.entries()) if (client.ws === ws) {
				this.browser_clients.delete(id);
				break;
			}
			this.notify_browsers_changed();
		} else for (const [id, client] of this.vscode_clients.entries()) if (client.ws === ws) {
			this.vscode_clients.delete(id);
			break;
		}
		this.connections.delete(ws);
	}
	get_browsers() {
		return Array.from(this.browser_clients.values()).map((client) => ({
			id: client.id,
			version: client.version,
			user_agent: client.user_agent,
			profile_name: client.profile_name
		}));
	}
	notify_browsers_changed() {
		this.options.on_browsers_changed(this.get_browsers());
	}
	send_initialize_chat(message) {
		const target = message.target_browser_id ? this.browser_clients.get(message.target_browser_id) : Array.from(this.browser_clients.values()).pop();
		if (!target || target.ws.readyState !== ws.WebSocket.OPEN) return { sent: false };
		const payload = {
			...message,
			client_id: this.editor_client_id
		};
		target.ws.send(JSON.stringify(payload));
		return {
			sent: true,
			browser: {
				id: target.id,
				version: target.version,
				user_agent: target.user_agent,
				profile_name: target.profile_name
			}
		};
	}
	start(port = this.options.port ?? 55155) {
		return new Promise((resolve, reject) => {
			const on_error = (error) => {
				this.http_server.off("listening", on_listening);
				reject(error);
			};
			const on_listening = () => {
				this.http_server.off("error", on_error);
				this.ping_timer = setInterval(() => this.ping_clients(), 1e4);
				const address = this.http_server.address();
				resolve(typeof address === "object" && address ? address.port : port);
			};
			this.http_server.once("error", on_error);
			this.http_server.once("listening", on_listening);
			this.http_server.listen(port, "127.0.0.1");
		});
	}
	ping_clients() {
		const ping = JSON.stringify({ action: "ping" });
		for (const client of this.browser_clients.values()) {
			if (!client.is_alive) {
				client.ws.terminate();
				continue;
			}
			client.is_alive = false;
			if (client.ws.readyState === ws.WebSocket.OPEN) client.ws.send(ping);
		}
		for (const client of this.vscode_clients.values()) {
			if (!client.is_alive) {
				client.ws.terminate();
				continue;
			}
			client.is_alive = false;
			if (client.ws.readyState === ws.WebSocket.OPEN) client.ws.send(ping);
		}
	}
	async stop() {
		if (this.ping_timer) clearInterval(this.ping_timer);
		for (const ws of this.connections) try {
			ws.close(1001, "Server is shutting down");
		} catch {}
		this.wss.close();
		await new Promise((resolve) => this.http_server.close(() => resolve()));
	}
};
// src/hosts/fs-host.ts
/**
* File-system host used when the sidecar runs standalone (`--workspace`), and by
* the sidecar tests. The JetBrains plugin uses `RpcHost` instead so that writes
* and diffs go through the IDE.
*/
var FsHost = class {
	constructor(roots, logger = () => {}) {
		this.roots = roots;
		this.logger = logger;
		this.selected = [];
	}
	async get_workspace_roots() {
		return this.roots;
	}
	async read_file(absolute_path) {
		try {
			return await fs.promises.readFile(absolute_path, "utf8");
		} catch {
			return null;
		}
	}
	async write_file(absolute_path, content) {
		await fs.promises.mkdir(path.dirname(absolute_path), { recursive: true });
		await fs.promises.writeFile(absolute_path, content, "utf8");
	}
	async delete_file(absolute_path) {
		await fs.promises.rm(absolute_path, { force: true });
	}
	async rename_file(from_absolute_path, to_absolute_path) {
		await fs.promises.mkdir(path.dirname(to_absolute_path), { recursive: true });
		await fs.promises.rename(from_absolute_path, to_absolute_path);
	}
	async exists(absolute_path) {
		try {
			await fs.promises.stat(absolute_path);
			return true;
		} catch {
			return false;
		}
	}
	async list_workspace_files(root) {
		const result = [];
		const skip = /* @__PURE__ */ new Set([
			"node_modules",
			".git",
			"dist",
			"build",
			"target",
			"vendor",
			".venv",
			"bin",
			"obj"
		]);
		const walk = async (dir, prefix) => {
			let entries;
			try {
				entries = await fs.promises.readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
				const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
				else result.push(relative);
			}
		};
		await walk(root.path, "");
		return result;
	}
	async get_selected_files() {
		return this.selected;
	}
	set_selected_files(paths) {
		this.selected = paths;
	}
	async confirm_changes(params) {
		this.logger(`Applying ${params.changes.length} change(s) without preview (no editor attached)`);
		return params.changes.map((change) => change.id);
	}
	info(message) {
		this.logger(message);
	}
	error(message) {
		this.logger(message);
	}
};
// src/hosts/rpc-host.ts
/**
* Host that delegates every operation to the editor plugin over JSON-RPC.
* This is what keeps the IDE in charge of writes (undo/VFS) and of the diff
* preview, while the sidecar keeps the parsing and apply logic.
*/
var RpcHost = class {
	constructor(peer) {
		this.peer = peer;
	}
	async get_workspace_roots() {
		return (await this.peer.request("host.getWorkspaceRoots"))?.roots ?? [];
	}
	async read_file(absolute_path) {
		return (await this.peer.request("host.readFile", { path: absolute_path }))?.content ?? null;
	}
	async write_file(absolute_path, content) {
		await this.peer.request("host.writeFile", {
			path: absolute_path,
			content
		});
	}
	async delete_file(absolute_path) {
		await this.peer.request("host.deleteFile", { path: absolute_path });
	}
	async rename_file(from_absolute_path, to_absolute_path) {
		await this.peer.request("host.renameFile", {
			from: from_absolute_path,
			to: to_absolute_path
		});
	}
	async exists(absolute_path) {
		return (await this.peer.request("host.exists", { path: absolute_path }))?.exists ?? false;
	}
	async list_workspace_files(root) {
		return (await this.peer.request("host.listWorkspaceFiles", { root }))?.files ?? [];
	}
	async get_selected_files() {
		return (await this.peer.request("host.getSelectedFiles"))?.files ?? [];
	}
	async confirm_changes(params) {
		const result = await this.peer.request("host.confirmChanges", params);
		if (result?.cancel) return null;
		return result?.acceptedIds ?? [];
	}
	info(message) {
		this.peer.notify("host.info", { message });
	}
	error(message) {
		this.peer.notify("host.error", { message });
	}
};
// ../../packages/core/src/utils/normalize-path.ts
var normalize_path = (file_path) => {
	return file_path.replace(/\\/g, "/");
};
// ../../packages/core/src/prompt/diff-placeholders.ts
var DIFF_PLACEHOLDERS = {
	FILE_CREATED: "File created",
	FILE_DELETED: "File deleted",
	FILE_RENAMED: "File renamed",
	FILE_MODIFIED: "File modified",
	BINARY_FILE_CREATED: "Binary file created",
	BINARY_FILE_DELETED: "Binary file deleted",
	BINARY_FILE_MODIFIED: "Binary file modified",
	BINARY_FILE_ADDED: "Binary file added"
};
// ../../packages/core/src/utils/get-markdown-backticks.ts
var get_markdown_backticks = (content) => {
	const match = content.match(/`{3,}/g);
	return "`".repeat(Math.max(3, (match ? match.reduce((max, m) => Math.max(max, m.length), 0) : 0) + 1));
};
// ../../packages/core/src/prompt/prompt-builder.ts
var PromptBuilder;
(function(_PromptBuilder) {
	const build_file_context = _PromptBuilder.build_file_context = (params) => {
		const display_path = normalize_path(params.filepath);
		if (params.is_binary || params.content === void 0) return `### File: \`${display_path}\`\n\nBinary file\n\n`;
		const backticks = get_markdown_backticks(params.content);
		return `### File: \`${display_path}\`\n\n${backticks}\n${params.content}\n${backticks}\n\n`;
	};
	_PromptBuilder.build_diff_file_context = (params) => {
		let result = "";
		const display_path = normalize_path(params.filepath);
		if (params.status === "created") result += `### New file: \`${display_path}\`\n\n`;
		else if (params.status === "deleted") result += `### Deleted file: \`${display_path}\`\n\n`;
		else if (params.status === "renamed" && params.old_filepath) {
			const old_display_path = normalize_path(params.old_filepath);
			result += `### Renamed file: \`${old_display_path}\` (old) \`${display_path}\` (new)\n\n`;
		} else result += `### Updated file: \`${display_path}\`\n\n`;
		if (params.diff_content?.trimEnd()) {
			const diff_content = params.diff_content.trimEnd();
			if (Object.values(DIFF_PLACEHOLDERS).includes(diff_content)) result += `${diff_content}\n\n`;
			else {
				const backticks = get_markdown_backticks(diff_content);
				result += `${backticks}diff\n${diff_content}\n${backticks}\n\n`;
			}
		}
		if (params.full_content?.trimEnd()) {
			const full_content = params.full_content.trimEnd();
			const backticks = get_markdown_backticks(full_content);
			result += `${backticks}\n${full_content}\n${backticks}\n\n`;
		}
		return result;
	};
	_PromptBuilder.build_prompt = (params) => {
		let part1 = "";
		let part2 = "";
		let full_prompt = "";
		let active_file_context = "";
		if (params.active_file) active_file_context = build_file_context(params.active_file);
		let top_sys = "";
		if (params.accuracy_boost) {
			if (params.user_instructions) top_sys += `# Task\n\n${params.user_instructions}\n\n`;
			if (params.output_formatting) top_sys += `# Output formatting\n\n${params.output_formatting.trimEnd()}\n\n`;
			if (params.requirements && params.requirements.length > 0) {
				const req_str = params.requirements.map((r) => `- ${r}`).join("\n");
				top_sys += `# Requirements\n\n${req_str}\n\n`;
			}
			if (params.completed_tasks && params.completed_tasks.length > 0) {
				const tasks_str = params.completed_tasks.map((t) => `- [x] ${t}`).join("\n");
				top_sys += `# Completed tasks\n\n${tasks_str}\n\n`;
			}
		}
		if (params.files_context !== void 0) {
			if (params.files_context || active_file_context) {
				if (top_sys) full_prompt += top_sys;
				full_prompt += `# Files\n\n`;
				if (params.files_context) full_prompt += params.files_context;
				if (active_file_context) full_prompt += active_file_context;
			} else if (top_sys) full_prompt += top_sys;
		} else if (!!(params.files_context_part1 || params.files_context_part2 || active_file_context)) {
			if (params.files_context_part1) {
				part1 = (top_sys ? top_sys : "") + `# Files\n\n${params.files_context_part1}`;
				part2 += `${params.files_context_part2 || ""}${active_file_context}`;
			} else part2 += (top_sys ? top_sys : "") + `# Files\n\n${params.files_context_part2 || ""}${active_file_context}`;
			full_prompt = part1 + part2;
		} else if (top_sys) {
			part1 += top_sys;
			full_prompt += top_sys;
		}
		if (params.skill_definitions) {
			part2 += params.skill_definitions;
			full_prompt += params.skill_definitions;
		}
		let sys = "";
		if (params.output_formatting) sys += `# Output formatting\n\n${params.output_formatting.trimEnd()}\n\n`;
		if (params.requirements && params.requirements.length > 0) {
			const req_str = params.requirements.map((r) => `- ${r}`).join("\n");
			sys += `# Requirements\n\n${req_str}\n\n`;
		}
		sys = sys.trimEnd();
		if (sys) {
			part2 += `${sys}\n\n`;
			full_prompt += `${sys}\n\n`;
		}
		if (params.completed_tasks && params.completed_tasks.length > 0) {
			const tasks_str = params.completed_tasks.map((t) => `- [x] ${t}`).join("\n");
			part2 += `# Completed tasks\n\n${tasks_str}\n\n`;
			full_prompt += `# Completed tasks\n\n${tasks_str}\n\n`;
		}
		if (part1.length > 0 || part2.length > 0 || full_prompt.length > 0) {
			part2 = part2.trimEnd() + "\n\n# Task\n\n";
			full_prompt = full_prompt.trimEnd() + "\n\n# Task\n\n";
		}
		if (params.user_instructions) {
			part2 += params.user_instructions;
			full_prompt += params.user_instructions;
		}
		return {
			part1,
			part2,
			full_prompt
		};
	};
})(PromptBuilder || (PromptBuilder = {}));
// ../../packages/core/src/prompt/edit-format-instructions.ts
var intro = `Whenever showing a new, updated, renamed, or deleted file, provide a brief explanation, then print the path in a markdown heading (e.g. ### New file: \`src/examples/hello.py\`, ### Updated file: \`src/examples/hello.py\`, ### Renamed file: \`src/examples/hello.py\` (old) \`src/welcome.py\` (new), ### Deleted file: \`src/examples/hello.py\`)`;
var EDIT_FORMAT_INSTRUCTIONS_WHOLE = `${intro}, followed by a markdown code block with the file's FULL (from cover to cover) contents. Example:
Updated the greeting text.

### Updated file: \`src/examples/hello.py\`

\`\`\`python
GREETING = "Hello, World!"

def show_greeting():
  print(GREETING)
\`\`\`

Created a simple calculator with addition and subtraction.

### Created file: \`src/examples/calculator.py\`

\`\`\`python
def add(a, b):
  return a + b

def subtract(a, b):
  return a - b
\`\`\`

### Deleted file: \`src/examples/weekdays.py\`

### Renamed file: \`src/examples/math_utils.py\` (old) \`src/examples/calculator.py\` (new)`;
var EDIT_FORMAT_INSTRUCTIONS_SEARCH_REPLACE = `${intro}, followed by a markdown code block showing the original and updated code snippets with Git-style merge conflict syntax. Example:
Changed greeting to wishes.

### Updated file: \`src/examples/hello.py\`

\`\`\`python
<<<<<<< SEARCH
GREETING = "Welcome everyone!"
=======
WISHES = "Have a nice day!"
>>>>>>> REPLACE
<<<<<<< SEARCH
 def show_greeting():
   print(GREETING)
=======
 def show_wishes():
   print(WISHES)
>>>>>>> REPLACE
\`\`\`

Created a simple calculator with addition and subtraction.

### Created file: \`src/examples/calculator.py\`

\`\`\`python
def add(a, b):
  return a + b

def subtract(a, b):
  return a - b
\`\`\`

### Deleted file: \`src/examples/weekdays.py\`

### Renamed file: \`src/examples/math_utils.py\` (old) \`src/examples/calculator.py\` (new)`;
var EDIT_FORMAT_INSTRUCTIONS_DIFF = `${intro}, followed by a unified diff within a markdown code block. Example:
Updated the greeting text.

### Updated file: \`src/examples/hello.py\`

\`\`\`diff
--- a/src/examples/hello.py
+++ b/src/examples/hello.py
@@ -1,5 +1,5 @@
 # A simple greeting script
-GREETING = "Welcome everyone!"
+GREETING = "Hello, World!"

 def show_greeting():
   print(GREETING)
\`\`\`

Created a simple calculator with addition and subtraction.

### Created file: \`src/examples/calculator.py\`

\`\`\`python
def add(a, b):
  return a + b

def subtract(a, b):
  return a - b
\`\`\`

### Deleted file: \`src/examples/weekdays.py\`

### Renamed file: \`src/examples/math_utils.py\` (old) \`src/examples/calculator.py\` (new)`;
// ../../packages/core/src/prompt/build-prompt.ts
var EDIT_FORMAT_INSTRUCTIONS = {
	whole: EDIT_FORMAT_INSTRUCTIONS_WHOLE,
	truncated: `${intro}, followed by a markdown code block with file's contents. As a space saving measure, truncate blocks like unchanged function bodies (code inside {}) by replacing with ellipsis comments. Example:
Updated the greeting text.

### Updated file: \`src/examples/hello.js\`

\`\`\`javascript
const DURATION = 5;
const GREETING = "Hello, World!";

function getDuration() {
  // ...
}

function showGreeting() {
  // ...
}
\`\`\`

Updated the purpose text.

### Updated file: \`src/README.md\`

\`\`\`markdown
## Purpose

Greet user saying "Hello, World!", for a duration of 5 seconds.

## License

<!-- ... --->

## Author

<!-- ... --->
\`\`\`

Created a simple calculator with addition and subtraction.

### Created file: \`src/examples/calculator.js\`

\`\`\`javascript
function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}
\`\`\`

### Deleted file: \`src/examples/weekdays.js\`

### Renamed file: \`src/examples/math-tools.js\` (old) \`src/examples/calculator.js\` (new)`,
	"search-replace": EDIT_FORMAT_INSTRUCTIONS_SEARCH_REPLACE,
	diff: EDIT_FORMAT_INSTRUCTIONS_DIFF
};
var RECENT_WINDOW_MS = 54e5;
/**
* Splits context files the way the editor does for prompt caching: files that
* changed in the last 1.5 hours go last, everything else keeps a stable order.
*/
var split_context_files = (params) => {
	const now = params.now ?? Date.now();
	const other_files = [];
	const recent_files = [];
	for (const file of params.files) if (typeof file.modified_at === "number" && now - file.modified_at < RECENT_WINDOW_MS) recent_files.push(file);
	else other_files.push(file);
	recent_files.sort((a, b) => (a.modified_at ?? 0) - (b.modified_at ?? 0));
	return {
		other_files,
		recent_files
	};
};
var build_files_context = (files) => files.map((file) => PromptBuilder.build_file_context({
	filepath: file.path,
	content: file.content,
	is_binary: file.is_binary
})).join("");
/**
* Builds the full markdown prompt that is autofilled into a chatbot.
* Mirrors the VS Code extension: `# Files`, output formatting (edit format),
* completed tasks, then `# Task` with the user instructions.
*/
var build_chatbot_prompt = (params) => {
	const { other_files, recent_files } = split_context_files({
		files: params.files,
		now: params.now
	});
	const other_context = build_files_context(other_files);
	const recent_context = build_files_context(recent_files);
	const is_edit = params.prompt_type === "edit";
	const output_formatting = is_edit && params.edit_format ? EDIT_FORMAT_INSTRUCTIONS[params.edit_format] : void 0;
	const { part1, part2, full_prompt } = PromptBuilder.build_prompt({
		files_context_part1: other_context,
		files_context_part2: recent_context,
		skill_definitions: params.skill_definitions,
		output_formatting,
		requirements: void 0,
		completed_tasks: is_edit ? params.completed_tasks : void 0,
		user_instructions: params.instructions,
		accuracy_boost: params.accuracy_boost
	});
	return {
		text: full_prompt.trim(),
		prompt_part1: part1,
		prompt_part2: part2
	};
};
// ../../packages/core/src/utils/cleanup-api-response/cleanup-api-response.ts
var cleanup_api_response = (params) => {
	let content = params.content.trim();
	if (content.startsWith("<think>")) {
		const end_index = content.indexOf("</think>");
		if (end_index !== -1) content = content.substring(end_index + 8).trim();
	} else if (content.startsWith("<thought>")) {
		const end_index = content.indexOf("</thought>");
		if (end_index !== -1) content = content.substring(end_index + 10).trim();
	}
	const first_backticks = content.indexOf("```");
	const last_backticks = content.lastIndexOf("```");
	if (first_backticks !== -1 && first_backticks < last_backticks) {
		const before = content.substring(0, first_backticks).trim();
		const after = content.substring(last_backticks + 3).trim();
		if (before || after) {
			const end_of_first_line = content.indexOf("\n", first_backticks);
			if (end_of_first_line > -1 && end_of_first_line < last_backticks) content = content.substring(end_of_first_line + 1, last_backticks).trimEnd();
		}
	}
	for (const pattern of [
		/^```[^\n]*\n/,
		/^<files[^>]*>\s*\n?/,
		/^<file[^>]*>\s*\n?/,
		/^<!DOCTYPE[^>]*>\s*\n?/
	]) {
		const match = content.match(pattern);
		if (match && match.index === 0) {
			content = content.substring(match[0].length);
			break;
		}
	}
	for (const pattern of [
		/\s*```\s*$/,
		/\s*<\/files>\s*$/,
		/\s*<\/file>\s*$/,
		/\s*\]\]>\s*$/
	]) {
		const match = content.match(pattern);
		if (match && match.index !== void 0 && match.index + match[0].length === content.length) {
			content = content.substring(0, match.index);
			break;
		}
	}
	content = content.trim();
	return content;
};
// ../../packages/core/src/response-parser/parsers/code-at-cursor-parser/code-at-cursor-parser.ts
var extract_path_and_position = (line) => {
	const match = line.match(/###\s+Code at cursor:\s+`?([^`]+)`?\s+\((\d+):(\d+)\)/);
	if (match) {
		const path = match[1].trim();
		const line_num_str = match[2];
		const char_num_str = match[3];
		if (path && line_num_str && char_num_str) return {
			path,
			line: parseInt(line_num_str, 10),
			character: parseInt(char_num_str, 10)
		};
	}
	return null;
};
var parse_code_at_cursor = (params) => {
	const lines = params.response.split("\n");
	let code_block_start_index = -1;
	let code_block_end_index = -1;
	for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith("```")) {
		code_block_start_index = i;
		for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().startsWith("```")) {
			code_block_end_index = j;
			break;
		}
		break;
	}
	if (code_block_start_index === -1) return null;
	if (code_block_end_index === -1) code_block_end_index = lines.length - 1;
	let header_index = -1;
	let completion_info = null;
	for (let k = code_block_start_index - 1; k >= 0; k--) {
		if (lines[k].trim() === "") continue;
		const info = extract_path_and_position(lines[k]);
		if (info) {
			header_index = k;
			completion_info = info;
		}
		break;
	}
	if (!completion_info) return null;
	const results = [];
	const text_before = lines.slice(0, header_index).join("\n").trim();
	if (text_before) results.push({
		type: "text",
		content: text_before
	});
	const { workspace_name, relative_path } = extract_workspace_and_path({
		raw_file_path: completion_info.path,
		is_single_root_folder_workspace: params.is_single_root_folder_workspace
	});
	const content_lines = lines.slice(code_block_start_index + 1, code_block_end_index);
	results.push({
		type: "code-at-cursor",
		file_path: relative_path,
		content: cleanup_api_response({ content: content_lines.join("\n") }),
		line: completion_info.line,
		character: completion_info.character,
		workspace_name
	});
	const text_after = lines.slice(code_block_end_index + 1).join("\n").trim();
	if (text_after) results.push({
		type: "text",
		content: text_after
	});
	return results;
};
// ../../packages/shared/src/utils/extract-path-from-line-of-code/extract-path-from-line-of-code.ts
var extract_path_from_line_of_code = (line) => {
	const xml_path_match = line.match(/<file\s+path=["']([^"']+)["']/);
	if (xml_path_match) return xml_path_match[1];
	if (!/^(\s*)(\/\/|#|--|\/\*|\*|<!--)/.test(line)) return null;
	const path_match = line.trim().replace(/^(?:\/\/|#|--|\/\*|\*|<!--)\s*/, "").trim().match(/(?:^|\s)((?:\.|[./\\\w\-[\]()]+\.)[\w-]{1,10})(?:\s|$)/);
	if (path_match) return path_match[1].replace(/\\/g, "/");
	return null;
};
// ../../packages/core/src/response-parser/parsers/standard-parser/helpers/process-conflict-markers.ts
var process_conflict_markers = (content) => {
	const lines = content.split("\n");
	const result_lines = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const startMatch = line.match(/^<<<<<<<\s*(.*)$/);
		if (startMatch) {
			const labelStart = startMatch[1];
			let j = i + 1;
			let middleIndex = -1;
			let endIndex = -1;
			let labelEnd = "";
			while (j < lines.length) {
				if (lines[j].match(/^=======\s*$/)) middleIndex = j;
				else if (lines[j].match(/^>>>>>>>\s*(.*)$/)) {
					endIndex = j;
					labelEnd = lines[j].match(/^>>>>>>>\s*(.*)$/)[1];
					break;
				}
				j++;
			}
			if (middleIndex !== -1 && endIndex !== -1) {
				const leftContentLines = lines.slice(i + 1, middleIndex);
				const rightContentLines = lines.slice(middleIndex + 1, endIndex);
				const splitByDots = (blockLines) => {
					const parts = [];
					let currentPart = [];
					for (const l of blockLines) if (l.trim() === "...") {
						parts.push(currentPart);
						currentPart = [];
					} else currentPart.push(l);
					parts.push(currentPart);
					return parts;
				};
				const leftParts = splitByDots(leftContentLines);
				const rightParts = splitByDots(rightContentLines);
				if (leftParts.length > 1 && leftParts.length === rightParts.length) {
					for (let k = 0; k < leftParts.length; k++) {
						result_lines.push(`<<<<<<< ${labelStart}`);
						result_lines.push(...leftParts[k]);
						result_lines.push(`=======`);
						result_lines.push(...rightParts[k]);
						result_lines.push(`>>>>>>> ${labelEnd}`);
					}
					i = endIndex + 1;
					continue;
				}
			}
		}
		result_lines.push(line);
		i++;
	}
	return result_lines.join("\n");
};
// ../../packages/core/src/response-parser/parsers/standard-parser/helpers/create-or-update-file-item.ts
var create_or_update_file_item = (params) => {
	if (!params.file_name) return;
	const processed_content = process_conflict_markers(params.content);
	const file_key = `${params.workspace_name || ""}:${params.file_name}`;
	if (params.file_ref_map.has(file_key)) {
		const existing_file = params.file_ref_map.get(file_key);
		if (params.mode === "append") {
			existing_file.content = existing_file.content + "\n" + processed_content;
			const file_index = params.results.indexOf(existing_file);
			if (file_index >= 0) {
				const text_indices = [];
				for (let i = file_index + 1; i < params.results.length; i++) if (params.results[i].type === "text") text_indices.push(i);
				if (text_indices.length > 0) {
					const text_contents = text_indices.map((idx) => params.results[idx].content.trim()).filter((c) => c);
					for (let i = text_indices.length - 1; i >= 0; i--) params.results.splice(text_indices[i], 1);
					if (text_contents.length > 0) {
						const combined = text_contents.join("\n");
						const updated_file_index = params.results.indexOf(existing_file);
						if (updated_file_index > 0 && params.results[updated_file_index - 1].type === "text") {
							const prev_text = params.results[updated_file_index - 1];
							prev_text.content = prev_text.content.trim() + "\n" + combined;
						} else params.results.splice(updated_file_index, 0, {
							type: "text",
							content: combined
						});
					}
				}
			}
		} else existing_file.content = processed_content;
		if (params.renamed_from) existing_file.renamed_from = params.renamed_from;
		if (params.renamed_from_workspace !== void 0) existing_file.renamed_from_workspace = params.renamed_from_workspace;
		if (params.is_deleted !== void 0) existing_file.is_deleted = params.is_deleted;
	} else {
		const new_file = {
			type: "file",
			file_path: params.file_name,
			content: processed_content,
			workspace_name: params.workspace_name,
			renamed_from: params.renamed_from,
			renamed_from_workspace: params.renamed_from_workspace,
			is_deleted: params.is_deleted
		};
		params.file_ref_map.set(file_key, new_file);
		params.results.push(new_file);
	}
};
// ../../packages/core/src/response-parser/parsers/standard-parser/helpers/flush-text-block.ts
var flush_text_block = (params) => {
	if (!params.text_block.trim()) return;
	const content = params.results.length === 0 ? params.text_block.trim() : params.text_block.trimEnd();
	params.results.push({
		type: "text",
		content
	});
};
// ../../packages/core/src/response-parser/parsers/standard-parser/helpers/extract-and-set-workspace-path.ts
var extract_and_set_workspace_path = (params) => {
	const { workspace_name, relative_path } = extract_workspace_and_path({
		raw_file_path: params.raw_file_path.trim(),
		is_single_root_folder_workspace: params.is_single_root_folder_workspace
	});
	return {
		workspace_name,
		relative_path
	};
};
// ../../packages/core/src/response-parser/parsers/standard-parser/standard-parser.ts
var file_blocks_parser = (params) => {
	const results = [];
	const file_ref_map = /* @__PURE__ */ new Map();
	let current_text_block = "";
	let state = "TEXT";
	let renamed_from_path = void 0;
	let renamed_from_workspace = void 0;
	let current_file_name = "";
	let current_content = "";
	let current_workspace_name = void 0;
	let backtick_nesting_level = 0;
	let last_seen_file_path_comment = null;
	let last_seen_file_path_was_header = false;
	let header_path_already_used = false;
	let current_block_mode = "overwrite";
	let is_markdown_container_block = false;
	let current_language = "";
	const lines = params.response.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (state === "TEXT") {
			const backtick_index = line.indexOf("```");
			if (backtick_index !== -1) {
				const before_backticks = line.substring(0, backtick_index);
				current_block_mode = "overwrite";
				current_text_block += before_backticks;
				flush_text_block({
					text_block: current_text_block,
					results
				});
				current_text_block = "";
				const after_backticks = line.substring(backtick_index + 3).trim();
				const is_conflict_marker_on_opening_line = after_backticks.startsWith("<<<<<<<");
				if (is_conflict_marker_on_opening_line) current_language = "";
				else current_language = after_backticks.split(/[:\s{]/)[0];
				state = "CONTENT";
				backtick_nesting_level = 1;
				current_workspace_name = void 0;
				current_file_name = "";
				if (last_seen_file_path_comment) {
					const { workspace_name, relative_path } = extract_and_set_workspace_path({
						raw_file_path: last_seen_file_path_comment,
						is_single_root_folder_workspace: params.is_single_root_folder_workspace
					});
					current_file_name = relative_path;
					if (workspace_name) current_workspace_name = workspace_name;
					const file_key = `${current_workspace_name || ""}:${current_file_name}`;
					const existing_file = file_ref_map.get(file_key);
					const has_conflict_markers = existing_file && existing_file.content.includes("<<<<<<<") && existing_file.content.includes(">>>>>>>") && existing_file.content.includes("=======");
					if (header_path_already_used) {
						if (has_conflict_markers) current_block_mode = "append";
						else {
							current_file_name = "";
							current_workspace_name = void 0;
							last_seen_file_path_comment = null;
							current_block_mode = "overwrite";
						}
					} else {
						if (has_conflict_markers) current_block_mode = "append";
						else current_block_mode = "overwrite";
						header_path_already_used = true;
					}
				}
				current_content = is_conflict_marker_on_opening_line ? after_backticks : "";
				is_markdown_container_block = false;
				continue;
			}
			const renamed_file_match = line.trim().match(/^###\s+Renamed file:\s*`([^`]+)`.*?`([^`]+)`/i);
			if (renamed_file_match && renamed_file_match[1] && renamed_file_match[2]) {
				flush_text_block({
					text_block: current_text_block,
					results
				});
				current_text_block = "";
				const { relative_path, workspace_name: old_workspace_name } = extract_and_set_workspace_path({
					raw_file_path: renamed_file_match[1],
					is_single_root_folder_workspace: params.is_single_root_folder_workspace
				});
				renamed_from_path = relative_path;
				renamed_from_workspace = old_workspace_name;
				const { relative_path: new_relative_path, workspace_name: new_workspace_name } = extract_and_set_workspace_path({
					raw_file_path: renamed_file_match[2],
					is_single_root_folder_workspace: params.is_single_root_folder_workspace
				});
				create_or_update_file_item({
					file_name: new_relative_path,
					content: "",
					workspace_name: new_workspace_name,
					file_ref_map,
					results,
					renamed_from: renamed_from_path,
					renamed_from_workspace
				});
				last_seen_file_path_comment = renamed_file_match[2];
				last_seen_file_path_was_header = true;
				header_path_already_used = false;
				continue;
			}
			const deleted_file_match = line.trim().match(/^###\s+Deleted file:\s*`([^`]+)`$/i);
			if (deleted_file_match && deleted_file_match[1]) {
				renamed_from_path = void 0;
				renamed_from_workspace = void 0;
				flush_text_block({
					text_block: current_text_block,
					results
				});
				current_text_block = "";
				const { workspace_name, relative_path } = extract_and_set_workspace_path({
					raw_file_path: deleted_file_match[1],
					is_single_root_folder_workspace: params.is_single_root_folder_workspace
				});
				create_or_update_file_item({
					file_name: relative_path,
					content: "",
					workspace_name,
					file_ref_map,
					results,
					is_deleted: true
				});
				continue;
			}
			let extracted_filename = extract_path_from_line_of_code(line);
			const is_header_line = line.trim().startsWith("###");
			if (!extracted_filename) {
				if (is_header_line) {
					const cleaned = line.trim().replace(/^###\s+/, "").replace(/^[`*]+|[`*]+$/g, "");
					const extracted = extract_path_from_line_of_code(cleaned);
					if (extracted) extracted_filename = extracted;
					else if ((cleaned.includes("/") || cleaned.includes(".") || cleaned.includes("\\")) && !cleaned.includes(" ")) extracted_filename = cleaned;
				}
			}
			if (!extracted_filename) {
				const match = line.match(/`([^`]+)`/);
				if (match && match[1]) {
					const potential_path = match[1];
					if ((potential_path.includes("/") || potential_path.includes("\\") || potential_path.includes(".")) && !potential_path.includes("${") && !potential_path.includes(" ") && /[a-zA-Z0-9]/.test(potential_path)) {
						const before = line.substring(0, match.index);
						const after = line.substring(match.index + match[0].length);
						if (is_header_line || !(/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after))) {
							const trimmed_line = line.trim();
							const is_comment_or_header = trimmed_line.startsWith("#") || trimmed_line.startsWith("//") || trimmed_line.startsWith("--");
							let is_followed_by_code_block = false;
							for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().startsWith("```")) {
								if (is_comment_or_header) is_followed_by_code_block = true;
								else {
									let all_intermediate_lines_empty = true;
									for (let k = i + 1; k < j; k++) if (lines[k].trim() !== "") {
										all_intermediate_lines_empty = false;
										break;
									}
									if (all_intermediate_lines_empty) is_followed_by_code_block = true;
								}
								break;
							}
							if (is_followed_by_code_block) extracted_filename = potential_path;
						}
					}
				}
			}
			if (extracted_filename) {
				if (last_seen_file_path_was_header && !is_header_line) current_text_block += line + "\n";
				else {
					flush_text_block({
						text_block: current_text_block,
						results
					});
					current_text_block = "";
					last_seen_file_path_comment = extracted_filename;
					if (!line.trim().match(/^###\s+Renamed file:/i)) {
						renamed_from_path = void 0;
						renamed_from_workspace = void 0;
					}
					last_seen_file_path_was_header = is_header_line;
					header_path_already_used = false;
				}
			} else {
				let is_lone_path_on_this_line = false;
				if (!last_seen_file_path_comment) {
					let trimmed = line.trim();
					for (const marker of [
						"***",
						"**",
						"*"
					]) if (trimmed.startsWith(marker) && trimmed.endsWith(marker)) {
						trimmed = trimmed.slice(marker.length, -marker.length);
						break;
					}
					if (trimmed.endsWith(":")) trimmed = trimmed.slice(0, -1);
					if (trimmed && (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(".")) && !trimmed.endsWith(".") && /^[a-zA-Z0-9_./@-]+$/.test(trimmed)) {
						let is_followed_by_code_block = false;
						for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().startsWith("```")) {
							is_followed_by_code_block = true;
							break;
						}
						if (is_followed_by_code_block) {
							renamed_from_path = void 0;
							renamed_from_workspace = void 0;
							last_seen_file_path_comment = trimmed;
							last_seen_file_path_was_header = false;
							header_path_already_used = false;
							is_lone_path_on_this_line = true;
						}
					}
				}
				if (!is_lone_path_on_this_line) current_text_block += line + "\n";
			}
		} else if (state === "CONTENT") {
			const trimmed_line = line.trim();
			if (trimmed_line.startsWith("```") && trimmed_line !== "```") {
				if (backtick_nesting_level === 1 && current_file_name && current_content.trim() === "") {
					state = "TEXT";
					last_seen_file_path_comment = current_file_name;
					current_file_name = "";
					current_content = "";
					current_workspace_name = void 0;
					i--;
					continue;
				}
				backtick_nesting_level++;
				if ((current_language === "markdown" || current_language === "md") && backtick_nesting_level > 1) is_markdown_container_block = true;
			} else if (trimmed_line === "```" && backtick_nesting_level === 1 && current_content.trim() === "" && i > 0 && lines[i - 1].trim() !== "" && lines[i - 1].trim().startsWith("```") && (() => {
				for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return true;
				return false;
			})()) backtick_nesting_level++;
			else if (trimmed_line === "```" && backtick_nesting_level === 1 && (current_language === "markdown" || current_language === "md") && !last_seen_file_path_was_header && (current_content.trim() === "" && i > 0 && lines[i - 1].trim() !== "" || i > 0 && (lines[i - 1].trim() === "" || current_file_name.endsWith(".md") && lines[i - 1].trim().endsWith("```"))) && (() => {
				for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return true;
				return false;
			})()) {
				is_markdown_container_block = true;
				backtick_nesting_level++;
			} else if (trimmed_line.endsWith("```")) {
				let should_close = true;
				if (trimmed_line === "```" && backtick_nesting_level === 1 && current_file_name && current_content.trim() === "" && i + 1 < lines.length && lines[i + 1].trim() !== "" && !lines[i + 1].trim().startsWith("```")) should_close = false;
				if (should_close) backtick_nesting_level--;
				else backtick_nesting_level++;
			}
			if (backtick_nesting_level <= 0) {
				let content_on_closing_line = "";
				const last_backticks_index = line.lastIndexOf("```");
				if (last_backticks_index !== -1) content_on_closing_line = line.substring(0, last_backticks_index);
				if (content_on_closing_line.trim() !== "") {
					if (current_content) current_content += "\n" + content_on_closing_line;
					else current_content = content_on_closing_line;
				}
				state = "TEXT";
				const cleaned_content = current_content;
				if (current_block_mode === "append" && current_file_name) {
					const file_key = `${current_workspace_name || ""}:${current_file_name}`;
					const existing_file = file_ref_map.get(file_key);
					if (existing_file && existing_file.content.includes("<<<<<<<") && !cleaned_content.includes("<<<<<<<")) {
						current_file_name = "";
						current_workspace_name = void 0;
					}
				}
				create_or_update_file_item({
					file_name: current_file_name,
					content: cleaned_content,
					workspace_name: current_workspace_name,
					file_ref_map,
					results,
					mode: current_block_mode,
					renamed_from: renamed_from_path,
					renamed_from_workspace
				});
				renamed_from_path = void 0;
				renamed_from_workspace = void 0;
				if (!current_file_name) results.push({
					type: "inline-file",
					content: current_content,
					language: current_language
				});
				if (current_file_name && !current_content.trim()) {
					last_seen_file_path_comment = current_file_name;
					last_seen_file_path_was_header = false;
					header_path_already_used = false;
				}
				current_file_name = "";
				current_content = "";
				current_workspace_name = void 0;
				if (last_backticks_index !== -1) current_text_block = line.substring(last_backticks_index + 3);
			} else {
				const lang_is_markdown = current_language === "markdown" || current_language === "md";
				const is_markdown_file = current_file_name.endsWith(".md");
				if (is_markdown_file || !(lang_is_markdown && current_file_name && line.trim().startsWith("```"))) {
					if (!lang_is_markdown || is_markdown_file || backtick_nesting_level > 1 || current_file_name && !is_markdown_container_block || !current_file_name) {
						if (current_content) current_content += "\n" + line;
						else current_content = line;
					}
				}
			}
		}
	}
	if (state === "CONTENT" && current_file_name) create_or_update_file_item({
		file_name: current_file_name,
		content: current_content,
		workspace_name: current_workspace_name,
		file_ref_map,
		results,
		mode: current_block_mode,
		renamed_from: renamed_from_path,
		renamed_from_workspace
	});
	else if (state === "TEXT" && current_text_block.trim()) {
		renamed_from_path = void 0;
		renamed_from_workspace = void 0;
		flush_text_block({
			text_block: current_text_block,
			results
		});
	}
	const merged_results = [];
	for (const result of results) {
		if (merged_results.length > 0) {
			const last = merged_results[merged_results.length - 1];
			if (last.type === "text" && result.type === "text") {
				last.content += "\n" + result.content;
				continue;
			}
		}
		merged_results.push(result);
	}
	for (const result of merged_results) if (result.type === "text") result.content = result.content.trim();
	return merged_results;
};
// ../../packages/shared/src/utils/logger.ts
var Logger;
(function(_Logger) {
	const LOG_PREFIX = "[CWC]";
	const sanitize_data = (data, seen = /* @__PURE__ */ new WeakSet()) => {
		if (data === null || data === void 0) return data;
		if (typeof data === "string") return data.replace(/(Authorization:\s*Bearer\s+)[^\r\n]+/gi, "$1[REDACTED]").replace(/(x-api-key:\s*)[^\r\n]+/gi, "$1[REDACTED]");
		if (typeof data !== "object") return data;
		if (seen.has(data)) return "[Circular]";
		seen.add(data);
		if (Array.isArray(data)) return data.map((item) => sanitize_data(item, seen));
		const sanitized = {};
		if (data instanceof Error) {
			sanitized.name = data.name;
			sanitized.message = data.message;
			sanitized.stack = data.stack;
		}
		for (const key of Object.keys(data)) {
			const lower_key = key.toLowerCase();
			if (lower_key === "authorization" || lower_key === "x-api-key") sanitized[key] = "[REDACTED]";
			else sanitized[key] = sanitize_data(data[key], seen);
		}
		return sanitized;
	};
	function info(params) {
		const function_name = params.function_name ? `[${params.function_name}] ` : "";
		if (params.data !== void 0) console.log(`${LOG_PREFIX}${function_name}${params.message}`, sanitize_data(params.data));
		else console.log(`${LOG_PREFIX}${function_name}${params.message}`);
	}
	_Logger.info = info;
	function warn(params) {
		const prefix = params.function_name ? `[${params.function_name}] ` : "";
		if (params.data !== void 0) console.warn(`${LOG_PREFIX}${prefix}${params.message}`, sanitize_data(params.data));
		else console.warn(`${LOG_PREFIX}${prefix}${params.message}`);
	}
	_Logger.warn = warn;
	function error(params) {
		const prefix = params.function_name ? `[${params.function_name}] ` : "";
		if (params.data !== void 0) console.error(`${LOG_PREFIX}${prefix}${params.message}`, sanitize_data(params.data));
		else console.error(`${LOG_PREFIX}${prefix}${params.message}`);
	}
	_Logger.error = error;
})(Logger || (Logger = {}));
// ../../packages/core/src/response-parser/parsers/diff-parser/helpers/path-utils.ts
var strip_quotes = (path) => {
	const trimmed = path.trim();
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.substring(1, trimmed.length - 1).trim();
	return trimmed;
};
var extract_path_from_potential_string = (line) => {
	let extracted = extract_path_from_line_of_code(line);
	if (extracted) extracted = extracted.trim();
	if (!extracted) {
		const xml_match = line.match(/^<[^>]+>([^<]+)<\/[^>]+>$/);
		if (xml_match && xml_match[1]) {
			const potential_path = xml_match[1].trim();
			if (potential_path && (potential_path.includes("/") || potential_path.includes("\\") || potential_path.includes(".")) && !potential_path.includes(" ") && !potential_path.includes("...")) extracted = potential_path;
		}
	}
	if (!extracted) {
		let potential_path = line.trim();
		if (potential_path.endsWith(":")) potential_path = potential_path.slice(0, -1).trim();
		const backtick_match = potential_path.match(/`([^`]+)`/);
		if (backtick_match && backtick_match[1]) potential_path = backtick_match[1].trim();
		if (potential_path && (potential_path.includes("/") || potential_path.includes("\\") || potential_path.includes(".")) && !potential_path.endsWith(".") && !potential_path.includes("...") && /^[a-zA-Z0-9_./@-]+$/.test(potential_path)) extracted = potential_path;
	}
	return extracted ? extracted.trim() : extracted;
};
var extract_path_with_xml_fallback = (line) => {
	let extracted = extract_path_from_line_of_code(line);
	if (extracted) extracted = extracted.trim();
	if (!extracted) {
		const xml_match = line.match(/^<[^>]+>([^<]+)<\/[^>]+>$/);
		if (xml_match && xml_match[1]) {
			const potential_path = xml_match[1].trim();
			if (potential_path && (potential_path.includes("/") || potential_path.includes("\\") || potential_path.includes(".")) && !potential_path.includes(" ") && !potential_path.includes("...")) extracted = potential_path;
		}
	}
	if (!extracted) {
		const match = line.match(/`([^`]+)`/);
		if (match && match[1]) {
			const potential_path = match[1].trim();
			if ((potential_path.includes("/") || potential_path.includes("\\") || potential_path.includes(".")) && !potential_path.includes("...")) extracted = potential_path;
		}
	}
	return extracted ? extracted.trim() : extracted;
};
// ../../packages/core/src/response-parser/parsers/diff-parser/helpers/patch-utils.ts
var normalize_header_line = (params) => {
	const processed_line = params.line.replace(/\s\d{4}-\d{2}-\d{2}.*$/, "");
	if (processed_line.startsWith("--- ")) {
		let path_part = strip_quotes(processed_line.substring(4).trim());
		if (path_part.startsWith("a/")) path_part = path_part.substring(2);
		if (params.is_single_root === false) path_part = extract_workspace_and_path({
			raw_file_path: path_part,
			is_single_root_folder_workspace: params.is_single_root
		}).relative_path;
		if (path_part === "/dev/null") return "--- /dev/null";
		return `--- a/${path_part}`;
	}
	if (processed_line.startsWith("+++ ")) {
		let path_part = strip_quotes(processed_line.substring(4).trim());
		if (path_part.startsWith("b/")) path_part = path_part.substring(2);
		if (params.is_single_root === false) path_part = extract_workspace_and_path({
			raw_file_path: path_part,
			is_single_root_folder_workspace: params.is_single_root
		}).relative_path;
		if (path_part === "/dev/null") return "+++ /dev/null";
		return `+++ b/${path_part}`;
	}
	return processed_line;
};
var extract_paths_from_lines = (lines) => {
	let from_path;
	let to_path;
	for (const line of lines) {
		const git_diff_match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
		if (git_diff_match) {
			if (git_diff_match[2]) to_path = git_diff_match[2].trim();
			if (git_diff_match[1]) from_path = git_diff_match[1].trim();
		}
		const from_match = line.match(/^--- (?:a\/|"a\/)?([^\t"]+)"?(?:\t.*)?$/);
		if (from_match && from_match[1]) from_path = from_match[1].trim();
		const to_match = line.match(/^\+\+\+ (?:b\/|"b\/)?([^\t"]+)"?(?:\t.*)?$/);
		if (to_match && to_match[1]) to_path = to_match[1].trim();
	}
	return {
		from_path,
		to_path
	};
};
var find_patch_start_index = (lines) => {
	for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("+++ ")) {
		for (let j = i - 1; j >= 0; j--) if (lines[j].startsWith("--- ")) {
			if (j > 0 && lines[j - 1].startsWith("diff --git")) return j;
			return j;
		}
		break;
	}
	for (let i = 0; i < lines.length; i++) if (lines[i].startsWith("diff --git")) for (let j = i + 1; j < lines.length; j++) {
		if (lines[j].startsWith("--- ")) return j;
		if (lines[j].startsWith("diff --git") || lines[j].startsWith("@@")) break;
	}
	return -1;
};
var format_hunk_headers = (lines) => {
	const formatted_lines = [];
	for (const line of lines) {
		const hunk_match = line.match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)(.*)$/);
		if (hunk_match && hunk_match[2].trim() !== "") {
			formatted_lines.push(hunk_match[1]);
			if (hunk_match[2].length > 0) formatted_lines.push(hunk_match[2]);
		} else if (line.startsWith("@@") && !hunk_match) {
			const context = line.substring(2).trim();
			formatted_lines.push("@@ -0,0 +0,0 @@");
			if (context) formatted_lines.push(" " + context);
		} else formatted_lines.push(line);
	}
	return formatted_lines;
};
// ../../packages/core/src/response-parser/parsers/diff-parser/helpers/block-utils.ts
var find_file_path_before_block = (params) => {
	const max_back = params.max_lines_back || 5;
	let candidate;
	for (let j = params.block_start - 1; j >= Math.max(0, params.block_start - max_back); j--) {
		const prev_line = params.lines[j].trim();
		if (!prev_line) continue;
		const extracted = extract_path_with_xml_fallback(prev_line);
		if (extracted) {
			if (extracted.endsWith("/") || extracted.endsWith("\\")) continue;
			if (!prev_line.startsWith("###")) {
				if (prev_line.replace("`" + extracted + "`", "").replace(extracted, "").trim().split(/\s+/).filter((w) => /[a-zA-Z]{2,}/.test(w)).length >= 5) continue;
			}
			const { workspace_name } = extract_workspace_and_path({
				raw_file_path: extracted,
				is_single_root_folder_workspace: params.is_single_root
			});
			if (prev_line.startsWith("###")) return {
				file_path: extracted,
				workspace_name
			};
			if (!candidate) candidate = {
				file_path: extracted,
				workspace_name
			};
		}
	}
	return candidate || {};
};
var remove_path_line_from_text_block = (params) => {
	const content_lines = params.text_item.content.split("\n");
	let path_line_index = -1;
	for (let i = content_lines.length - 1; i >= 0; i--) {
		const line = content_lines[i].trim();
		if (line === "") continue;
		const extracted = extract_path_from_potential_string(line);
		if (extracted) {
			const { relative_path } = extract_workspace_and_path({
				raw_file_path: extracted,
				is_single_root_folder_workspace: params.is_single_root
			});
			if (relative_path === params.target_file_path || params.target_new_file_path && relative_path === params.target_new_file_path) {
				if (line.startsWith("###")) path_line_index = i;
				break;
			}
		}
	}
	if (path_line_index > -1) {
		const new_content_lines = content_lines.filter((_, index) => index !== path_line_index);
		const collapsed_lines = [];
		for (const line of new_content_lines) {
			if (line.trim() === "" && collapsed_lines.length > 0 && collapsed_lines[collapsed_lines.length - 1].trim() === "") continue;
			collapsed_lines.push(line);
		}
		const new_content = collapsed_lines.join("\n").trim();
		params.text_item.content = new_content;
	}
};
// ../../packages/core/src/response-parser/parsers/diff-parser/diff-parser.ts
var process_collected_patch_lines = (params) => {
	let lines = [...params.patch_lines_array];
	lines = lines.filter((l) => l.length > 0);
	const joined_patch_text_for_checks = lines.join("\n");
	if (joined_patch_text_for_checks.trim() === "") return null;
	const { from_path, to_path } = extract_paths_from_lines(lines);
	const is_rename = from_path && to_path && from_path !== to_path && !(from_path === "/dev/null") && !(to_path === "/dev/null");
	const file_path = from_path && from_path !== "/dev/null" ? from_path : to_path;
	if (!file_path || file_path === "/dev/null") {
		Logger.info({
			function_name: "process_collected_patch_lines",
			message: "Could not extract file path from collected patch lines.",
			data: {
				response_start: joined_patch_text_for_checks.substring(0, 200),
				lines_count: lines.length
			}
		});
		return null;
	}
	const patch_start_idx = find_patch_start_index(lines);
	let content_str = build_patch_content({
		lines,
		file_path,
		patch_start_index: patch_start_idx,
		is_single_root: params.is_single_root
	});
	if (is_rename) {
		const normalized_to_path_line = normalize_header_line({
			line: `+++ ${to_path}`,
			is_single_root: params.is_single_root
		});
		const normalized_from_path_line = normalize_header_line({
			line: `+++ ${from_path}`,
			is_single_root: params.is_single_root
		});
		content_str = content_str.replace(normalized_to_path_line, normalized_from_path_line);
	}
	const { workspace_name, relative_path } = extract_workspace_and_path({
		raw_file_path: file_path,
		is_single_root_folder_workspace: params.is_single_root
	});
	const patch = {
		type: "diff",
		file_path: relative_path,
		workspace_name,
		content: content_str.endsWith("\n") ? content_str : content_str + "\n"
	};
	if (is_rename && to_path) {
		const { workspace_name: new_workspace, relative_path: new_relative } = extract_workspace_and_path({
			raw_file_path: to_path,
			is_single_root_folder_workspace: params.is_single_root
		});
		patch.new_file_path = new_relative;
		if (new_workspace && new_workspace !== workspace_name) patch.new_workspace_name = new_workspace;
	}
	return patch;
};
var convert_code_block_to_new_file_diff = (params) => {
	if (params.lines.length === 0 && !params.file_path_hint) return null;
	const xml_path_regex = /<([\w-]+)\s+path=(?:["']([^"']+)["']|([^>\s]+))/;
	let file_path = params.file_path_hint;
	let content_lines = [];
	const xml_match = (params.lines.length > 0 ? params.lines[0].trim() : "").match(xml_path_regex);
	if (xml_match && xml_match[1] && (xml_match[2] || xml_match[3])) {
		const xml_tag_name = xml_match[1];
		const potential_path = normalize_path(xml_match[2] || xml_match[3]);
		if (potential_path.endsWith("/")) return null;
		file_path = potential_path;
		const file_tag_start = params.lines.findIndex((l) => l.trim().startsWith(`<${xml_tag_name}`));
		let file_tag_end = -1;
		for (let i = params.lines.length - 1; i >= 0; i--) if (params.lines[i].trim().startsWith(`</${xml_tag_name}>`)) {
			file_tag_end = i;
			break;
		}
		if (file_tag_start !== -1 && file_tag_end !== -1 && file_tag_end > file_tag_start) content_lines = params.lines.slice(file_tag_start + 1, file_tag_end);
		else content_lines = params.lines.slice(1);
	} else for (let i = 0; i < Math.min(params.lines.length, 5); i++) {
		const line = params.lines[i].trim();
		if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff --git ")) {
			const { from_path, to_path } = extract_paths_from_lines([line]);
			const potential_path = to_path || from_path;
			if (potential_path && potential_path !== "/dev/null") {
				file_path = normalize_path(potential_path);
				break;
			}
			continue;
		}
	}
	if (!file_path) file_path = params.file_path_hint;
	if (file_path && content_lines.length === 0) content_lines = params.lines;
	if (!file_path) return null;
	const first_real_content_line = content_lines.find((l) => l.trim() !== "");
	if (first_real_content_line && (first_real_content_line.trim().match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)/) || first_real_content_line.startsWith("diff --git ") || first_real_content_line.startsWith("--- "))) {
		const { workspace_name, relative_path } = extract_workspace_and_path({
			raw_file_path: file_path,
			is_single_root_folder_workspace: params.is_single_root
		});
		let patch_content = "";
		if (first_real_content_line.startsWith("diff --git ") || first_real_content_line.startsWith("--- ")) patch_content = content_lines.join("\n");
		else patch_content = [
			first_real_content_line.trim().startsWith("@@ -0,0") ? "--- /dev/null" : `--- a/${relative_path}`,
			`+++ b/${relative_path}`,
			...content_lines
		].join("\n");
		return {
			type: "diff",
			file_path: relative_path,
			workspace_name,
			content: patch_content + "\n"
		};
	}
	const { workspace_name, relative_path } = extract_workspace_and_path({
		raw_file_path: file_path,
		is_single_root_folder_workspace: params.is_single_root
	});
	const patch_lines = content_lines.map((line) => `+${line}`);
	return {
		type: "diff",
		file_path: relative_path,
		workspace_name,
		content: [
			`--- /dev/null`,
			`+++ b/${relative_path}`,
			`@@ -0,0 +1,${content_lines.length} @@`,
			...patch_lines
		].join("\n") + "\n"
	};
};
var process_text_for_file_operations = (params) => {
	const items = [];
	let current_text_lines = [];
	const deleted_file_header_regex = /^###\s+Deleted file:\s*`([^`]+)`/;
	const renamed_file_header_regex = /^###\s+Renamed file:\s*`([^`]+)`\s*\(old\)\s*`([^`]+)`\s*\(new\)/;
	for (const line of params.lines) {
		const trimmed_line = line.trim();
		if (trimmed_line === "<files>" || trimmed_line === "</files>") continue;
		const deleted_match = trimmed_line.match(deleted_file_header_regex);
		const renamed_match = trimmed_line.match(renamed_file_header_regex);
		if (deleted_match && deleted_match[1]) {
			const text_content = current_text_lines.join("\n").trim();
			if (text_content) items.push({
				type: "text",
				content: text_content
			});
			current_text_lines = [];
			const { workspace_name, relative_path } = extract_workspace_and_path({
				raw_file_path: normalize_path(deleted_match[1]),
				is_single_root_folder_workspace: params.is_single_root
			});
			const content = `--- a/${relative_path}\n+++ /dev/null\n@@ +0,0 +0,0 @@\n`;
			items.push({
				type: "diff",
				file_path: relative_path,
				workspace_name,
				content
			});
		} else if (renamed_match && renamed_match[1] && renamed_match[2]) {
			const text_content = current_text_lines.join("\n").trim();
			if (text_content) items.push({
				type: "text",
				content: text_content
			});
			current_text_lines = [];
			const raw_old_path = normalize_path(renamed_match[1]);
			const raw_new_path = normalize_path(renamed_match[2]);
			const old_info = extract_workspace_and_path({
				raw_file_path: raw_old_path,
				is_single_root_folder_workspace: params.is_single_root
			});
			const new_info = extract_workspace_and_path({
				raw_file_path: raw_new_path,
				is_single_root_folder_workspace: params.is_single_root
			});
			const content = `--- a/${old_info.relative_path}\n+++ b/${old_info.relative_path}\n`;
			const patch = {
				type: "diff",
				file_path: old_info.relative_path,
				workspace_name: old_info.workspace_name,
				new_file_path: new_info.relative_path,
				content
			};
			if (new_info.workspace_name && new_info.workspace_name !== old_info.workspace_name) patch.new_workspace_name = new_info.workspace_name;
			items.push(patch);
		} else current_text_lines.push(line);
	}
	const text_content = current_text_lines.join("\n").trim();
	if (text_content) items.push({
		type: "text",
		content: text_content
	});
	return items;
};
var extract_all_code_block_patches = (params) => {
	const items = [];
	const lines = params.normalized_text.split("\n");
	const code_block_regex = /^```(\w*)/;
	const code_blocks = [];
	const stack = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed_line = line.trim();
		const match = trimmed_line.match(code_block_regex);
		if (!match) continue;
		const lang = match[1] || "";
		if (stack.length > 0 && (stack[stack.length - 1].type === "diff" || stack[stack.length - 1].type === "patch")) {
			if (line.match(/^[+\- ]/)) continue;
		}
		if (lang === "" && stack.length > 0 && trimmed_line === "```") {
			const open_block = stack.pop();
			code_blocks.push({
				start: open_block.start,
				end: i,
				type: open_block.type
			});
		} else stack.push({
			start: i,
			type: lang
		});
	}
	const closed_blocks = [...code_blocks].sort((a, b) => a.start - b.start);
	for (const open_block of stack) {
		let end_line = lines.length;
		for (const closed_block of closed_blocks) if (closed_block.start > open_block.start) {
			end_line = closed_block.start;
			break;
		}
		code_blocks.push({
			start: open_block.start,
			end: end_line,
			type: open_block.type
		});
	}
	code_blocks.sort((a, b) => a.start - b.start);
	const xml_blocks = [];
	const xml_file_tag_start_regex = /^\s*<([\w-]+)\s+path=(?:["']([^"']+)["']|([^>\s]+))/;
	let in_xml_block = false;
	let xml_start = -1;
	let xml_tag_name = "";
	for (let i = 0; i < lines.length; i++) {
		const trimmed_line = lines[i].trim();
		if (code_blocks.some((b) => i >= b.start && i < b.end)) continue;
		if (!in_xml_block) {
			const match = trimmed_line.match(xml_file_tag_start_regex);
			if (match) {
				in_xml_block = true;
				xml_start = i;
				xml_tag_name = match[1];
			}
		} else if (new RegExp(`^\\s*<\\/${xml_tag_name}>`).test(trimmed_line)) {
			xml_blocks.push({
				start: xml_start,
				end: i,
				type: "xml_file"
			});
			in_xml_block = false;
		}
	}
	if (in_xml_block) xml_blocks.push({
		start: xml_start,
		end: lines.length - 1,
		type: "xml_file"
	});
	code_blocks.push(...xml_blocks);
	code_blocks.sort((a, b) => a.start - b.start);
	const diff_block_patches = /* @__PURE__ */ new Map();
	for (let i = 0; i < code_blocks.length; i++) {
		const block = code_blocks[i];
		if (block.type === "diff" || block.type === "patch") {
			let file_path_hint;
			let is_new_file_from_hint = false;
			if (i > 0) {
				const prev_block_lines = lines.slice(code_blocks[i - 1].start + 1, code_blocks[i - 1].end);
				const xml_path_regex = /<[\w-]+\s+path=["']([^"']+)["']([^>]*)>/;
				const non_empty_lines = prev_block_lines.filter((l) => l.trim() !== "");
				if (non_empty_lines.length === 1) {
					const match = non_empty_lines[0].match(xml_path_regex);
					if (match && match[1]) {
						file_path_hint = match[1];
						const attributes = match[2] || "";
						if (/\snew\b/.test(attributes)) is_new_file_from_hint = true;
					}
				}
			}
			if (!file_path_hint) file_path_hint = find_file_path_before_block({
				lines,
				block_start: block.start,
				is_single_root: params.is_single_root
			}).file_path;
			const block_lines = lines.slice(block.start + 1, block.end);
			if (file_path_hint) {
				const { from_path, to_path } = extract_paths_from_lines(block_lines);
				if (!from_path && !to_path) block_lines.unshift(is_new_file_from_hint ? "--- /dev/null" : `--- a/${file_path_hint}`, `+++ b/${file_path_hint}`);
			}
			const parsed_patches = parse_multiple_raw_patches({
				all_lines: block_lines,
				is_single_root: params.is_single_root
			});
			if (parsed_patches.length > 0) diff_block_patches.set(block.start, parsed_patches);
		}
	}
	let last_block_end = -1;
	for (let i = 0; i < code_blocks.length; i++) {
		const block = code_blocks[i];
		const block_lines = block.type === "xml_file" ? lines.slice(block.start, block.end + 1) : lines.slice(block.start + 1, block.end);
		if (block.type === "diff" || block.type === "patch") {
			const preceding_items = process_text_for_file_operations({
				lines: lines.slice(last_block_end + 1, block.start),
				is_single_root: params.is_single_root
			});
			items.push(...preceding_items);
			const patches = diff_block_patches.get(block.start) || [];
			if (patches.length > 0) {
				const last_item = items.length > 0 ? items[items.length - 1] : void 0;
				if (last_item && last_item.type === "text") {
					remove_path_line_from_text_block({
						text_item: last_item,
						target_file_path: patches[0].file_path,
						is_single_root: params.is_single_root,
						target_new_file_path: patches[0].new_file_path
					});
					if (!last_item.content) items.pop();
				}
			}
			items.push(...patches);
			last_block_end = block.end;
		} else {
			if (i < code_blocks.length - 1) {
				const next_block = code_blocks[i + 1];
				if (next_block.type === "diff" || next_block.type === "patch") {
					const xml_path_regex = /<[\w-]+\s+path=["']([^"']+)["']/;
					const non_empty_lines = block_lines.filter((l) => l.trim() !== "");
					if (non_empty_lines.length === 1) {
						const match = non_empty_lines[0].match(xml_path_regex);
						if (match && match[1]) {
							const text_before_lines = lines.slice(last_block_end + 1, block.start);
							items.push(...process_text_for_file_operations({
								lines: text_before_lines,
								is_single_root: params.is_single_root
							}));
							last_block_end = block.end;
							continue;
						}
					}
				}
			}
			const hint_result = find_file_path_before_block({
				lines,
				block_start: block.start,
				is_single_root: params.is_single_root
			});
			const patch = convert_code_block_to_new_file_diff({
				lines: block_lines,
				is_single_root: params.is_single_root,
				file_path_hint: hint_result.file_path
			});
			if (patch) {
				const text_before_lines = lines.slice(last_block_end + 1, block.start);
				items.push(...process_text_for_file_operations({
					lines: text_before_lines,
					is_single_root: params.is_single_root
				}));
				const last_item = items.length > 0 ? items[items.length - 1] : void 0;
				if (last_item && last_item.type === "text") {
					remove_path_line_from_text_block({
						text_item: last_item,
						target_file_path: patch.file_path,
						is_single_root: params.is_single_root
					});
					if (!last_item.content) items.pop();
				}
				if (hint_result.workspace_name && !patch.workspace_name) patch.workspace_name = hint_result.workspace_name;
				items.push(patch);
				last_block_end = block.end;
			} else {
				const text_before_lines = lines.slice(last_block_end + 1, block.start);
				items.push(...process_text_for_file_operations({
					lines: text_before_lines,
					is_single_root: params.is_single_root
				}));
				const content = block_lines.join("\n");
				if (content.trim() !== "") items.push({
					type: "inline-file",
					content,
					language: block.type
				});
				last_block_end = block.end;
			}
		}
	}
	if (last_block_end < lines.length - 1) {
		const remaining_lines = lines.slice(last_block_end + 1);
		items.push(...process_text_for_file_operations({
			lines: remaining_lines,
			is_single_root: params.is_single_root
		}));
	}
	if (items.length > 0) {
		const last_item = items[items.length - 1];
		if (last_item.type === "text" && last_item.content.trim() === "```") items.pop();
	}
	return items;
};
var parse_multiple_raw_patches = (params) => {
	const patches = [];
	let current_patch_lines = [];
	for (const line of params.all_lines) {
		if ((line.startsWith("--- ") || line.startsWith("diff --git ")) && current_patch_lines.length > 0) {
			const contains_main_header = current_patch_lines.some((l) => l.startsWith("--- ") || l.startsWith("diff --git "));
			const contains_plus_plus_plus = current_patch_lines.some((l) => l.startsWith("+++ "));
			if (contains_main_header && contains_plus_plus_plus) {
				let should_split = false;
				if (line.startsWith("diff --git ")) should_split = true;
				else if (line.startsWith("--- ")) {
					if (current_patch_lines.some((l) => l.startsWith("@@"))) should_split = true;
				}
				if (should_split) {
					const patch_info = process_collected_patch_lines({
						patch_lines_array: current_patch_lines,
						is_single_root: params.is_single_root
					});
					if (patch_info) patches.push(patch_info);
					current_patch_lines = [line];
					continue;
				}
			}
		}
		current_patch_lines.push(line);
	}
	if (current_patch_lines.length > 0) {
		const patch_info = process_collected_patch_lines({
			patch_lines_array: current_patch_lines,
			is_single_root: params.is_single_root
		});
		if (patch_info) patches.push(patch_info);
	}
	return patches;
};
var merge_diffs_per_file = (items) => {
	const result = [];
	const file_diff_map = /* @__PURE__ */ new Map();
	for (const item of items) if (item.type === "diff") {
		const file_key = `${item.workspace_name || ""}:${item.file_path}`;
		if (file_diff_map.has(file_key)) {
			const existing_diff = file_diff_map.get(file_key);
			const existing_lines = existing_diff.content.replace(/\n$/, "").split("\n");
			const existing_has_real_hunks = existing_lines.some((l) => l.startsWith("+") && !l.startsWith("+++ ") || l.startsWith("-") && !l.startsWith("--- ") || l.startsWith(" ") && !l.startsWith("  "));
			const existing_is_new_file = existing_lines.some((l) => l === "--- /dev/null");
			const incoming_is_modification = !item.content.includes("--- /dev/null") && item.content.includes("@@");
			if (!existing_has_real_hunks || existing_is_new_file && incoming_is_modification) existing_diff.content = item.content;
			else {
				const new_lines = item.content.replace(/\n$/, "").split("\n");
				let start_idx = new_lines.findIndex((l) => l.startsWith("@@"));
				if (start_idx === -1) start_idx = new_lines.findIndex((l) => !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("diff --git") && l.trim() !== "");
				if (start_idx !== -1) {
					const content_to_add = new_lines.slice(start_idx).join("\n") + "\n";
					existing_diff.content = existing_diff.content.endsWith("\n") ? existing_diff.content + content_to_add : existing_diff.content + "\n" + content_to_add;
				}
			}
			if (result.length > 0 && result[result.length - 1].type === "text") {
				const orphaned_text = result.pop();
				const diff_index = result.indexOf(existing_diff);
				if (diff_index > 0 && result[diff_index - 1].type === "text") result[diff_index - 1].content += "\n" + orphaned_text.content;
				else result.splice(diff_index, 0, orphaned_text);
			}
		} else {
			file_diff_map.set(file_key, item);
			result.push(item);
		}
	} else result.push(item);
	return result;
};
var extract_diffs = (params) => {
	const normalized_text = params.response_text.replace(/\r\n/g, "\n");
	const lines = normalized_text.split("\n");
	const code_block_regex = /^```(\w*)/;
	const uses_code_blocks = lines.some((line) => code_block_regex.test(line.trim()));
	const xml_file_tag_start_regex = /^\s*<([\w-]+)\s+path=(?:["']([^"']+)["']|([^>\s]+))/;
	const uses_xml_blocks = lines.some((line) => xml_file_tag_start_regex.test(line.trim()));
	let items;
	if (uses_code_blocks || uses_xml_blocks) items = extract_all_code_block_patches({
		normalized_text,
		is_single_root: params.is_single_root
	});
	else items = parse_multiple_raw_patches({
		all_lines: lines,
		is_single_root: params.is_single_root
	});
	return merge_diffs_per_file(items);
};
var build_patch_content = (params) => {
	let patch_content;
	if (params.patch_start_index >= 0) {
		let patch_lines = params.lines.slice(params.patch_start_index);
		const hunk_start_idx = patch_lines.findIndex((line) => line.startsWith("@@"));
		if (hunk_start_idx >= 0) {
			const header_lines = patch_lines.slice(0, hunk_start_idx);
			const formatted_body_lines = format_hunk_headers(patch_lines.slice(hunk_start_idx));
			let from_line;
			let to_line;
			let diff_git_line;
			const is_new_file_based_on_empty = formatted_body_lines.length > 0 && formatted_body_lines.some((line) => line.startsWith("+")) && formatted_body_lines.some((line) => line.trim() === "-") && formatted_body_lines.every((line) => line.startsWith("+") || line.startsWith("@@") || line.trim() === "-" || line === "\\ No newline at end of file") && formatted_body_lines.some((line) => line.startsWith("@@ -1") || line.startsWith("@@ -0"));
			for (const line of header_lines) if (line.startsWith("--- ")) from_line = is_new_file_based_on_empty ? "--- /dev/null" : line;
			else if (line.startsWith("+++ ")) to_line = line;
			else if (line.startsWith("diff --git ")) diff_git_line = line;
			if (is_new_file_based_on_empty && !from_line) from_line = "--- /dev/null";
			const final_header = [];
			if (diff_git_line) final_header.push(diff_git_line);
			if (from_line) final_header.push(from_line);
			if (to_line) final_header.push(to_line);
			patch_lines = [...final_header, ...formatted_body_lines];
		} else {
			const content_start_index = patch_lines.findIndex((line) => !line.startsWith("--- ") && !line.startsWith("+++ ") && !line.startsWith("diff --git"));
			if (content_start_index !== -1) {
				const header_lines = patch_lines.slice(0, content_start_index);
				const content_lines = patch_lines.slice(content_start_index);
				if (content_lines.length > 0 && content_lines.every((line) => line.startsWith("+") || line.trim() === "")) {
					const hunk_header = `@@ -0,0 +1,${content_lines.length} @@`;
					patch_lines = [
						...header_lines,
						hunk_header,
						...content_lines
					];
				}
			}
		}
		patch_content = patch_lines.map((line) => {
			if (line.startsWith("--- ") || line.startsWith("+++ ")) return normalize_header_line({
				line,
				is_single_root: params.is_single_root
			});
			return line;
		}).join("\n");
	} else {
		const content_start_index = params.lines.findIndex((line) => line.startsWith("@@"));
		if (content_start_index === -1) {
			Logger.info({
				function_name: "build_patch_content",
				message: "No @@ content found, constructing minimal patch headers based on file_path.",
				data: { file_path: params.file_path }
			});
			const relative_file_path = params.is_single_root === false ? extract_workspace_and_path({
				raw_file_path: params.file_path,
				is_single_root_folder_workspace: false
			}).relative_path : params.file_path;
			const content_lines = params.lines;
			const is_new_file = content_lines.length > 0 && content_lines.every((l) => l.startsWith("+") || l.trim() === "");
			let body = params.lines.join("\n");
			if (is_new_file) body = `${`@@ -0,0 +1,${content_lines.length} @@`}\n${body}`;
			patch_content = `--- a/${relative_file_path}\n+++ b/${relative_file_path}\n${body}`;
		} else {
			const formatted_patch_body_lines = format_hunk_headers(params.lines.slice(content_start_index));
			const relative_file_path = params.is_single_root === false ? extract_workspace_and_path({
				raw_file_path: params.file_path,
				is_single_root_folder_workspace: params.is_single_root
			}).relative_path : params.file_path;
			patch_content = `--- a/${relative_file_path}\n+++ b/${relative_file_path}\n${formatted_patch_body_lines.join("\n")}`;
		}
	}
	return patch_content;
};
// ../../packages/core/src/utils/extract-paths-from-bullet-list.ts
var extract_paths_from_bullet_list = (params) => {
	const found_paths = /* @__PURE__ */ new Set();
	const lines = params.text.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
			let path_str = trimmed.substring(1).trim();
			if (path_str.startsWith("`") && path_str.endsWith("`")) path_str = path_str.substring(1, path_str.length - 1).trim();
			if (path_str) found_paths.add(path_str.replace(/[.?!]+$/, ""));
		}
	}
	const matched_files_with_index = /* @__PURE__ */ new Map();
	for (const original_p of found_paths) {
		let p = original_p;
		if (p.startsWith("./")) p = p.substring(2);
		else if (p.startsWith("/")) p = p.substring(1);
		while (p.startsWith("/")) p = p.substring(1);
		if (!p || p === "." || p === "..") continue;
		let idx = params.text.indexOf(original_p);
		if (idx === -1) idx = params.text.indexOf(p);
		const safe_idx = idx !== -1 ? idx : Infinity;
		for (const file of params.workspace_files) if (file === p || file.endsWith("/" + p)) {
			const current_idx = matched_files_with_index.get(file) ?? Infinity;
			matched_files_with_index.set(file, Math.min(current_idx, safe_idx));
		}
	}
	return Array.from(matched_files_with_index.keys()).sort((a, b) => {
		const idx_a = matched_files_with_index.get(a) ?? Infinity;
		const idx_b = matched_files_with_index.get(b) ?? Infinity;
		if (idx_a === idx_b) return a.localeCompare(b);
		return idx_a - idx_b;
	});
};
// ../../packages/core/src/response-parser/parsers/intelligent-file-search-results-parser/intelligent-file-search-results-parser.ts
var parse_intelligent_file_search_results = (params) => {
	const match = params.response.trim().match(/^\*\*Intelligent file search results(.*?):\*\*/);
	if (!match) return null;
	const metadata = match[1];
	let is_search_in_selected = false;
	let folder_path = void 0;
	if (metadata.includes("selected files")) is_search_in_selected = true;
	const folder_match = metadata.match(/folder `([^`]+)`/);
	if (folder_match) folder_path = folder_match[1];
	const valid_paths = extract_paths_from_bullet_list({
		text: params.response,
		workspace_files: params.workspace_files
	});
	if (valid_paths.length === 0) return null;
	return {
		type: "intelligent-file-search-results",
		file_paths: valid_paths,
		is_search_in_selected,
		folder_path
	};
};
// ../../packages/core/src/response-parser/parsers/commit-message-parser/commit-message-parser.ts
var parse_commit_message = (response) => {
	const trimmed = response.trim();
	if (trimmed.startsWith("**Commit message:**")) return {
		type: "commit-message",
		message: trimmed.substring(19).trim()
	};
	return null;
};
// ../../packages/core/src/response-parser/parsers/patch-repair-parser/patch-repair-parser.ts
var extract_path = (line) => {
	const match = line.match(/^###\s+Patch(?:ed)?\s+(?:repair|file):\s*`?([^`]+)`?/i);
	if (match && match[1]) return match[1].trim();
	return null;
};
var parse_patch_repair = (params) => {
	const lines = params.response.split("\n");
	const results = [];
	let found_any = false;
	let current_text = [];
	let i = 0;
	while (i < lines.length) {
		const extracted = extract_path(lines[i]);
		if (extracted) {
			let code_block_start_index = -1;
			let code_block_end_index = -1;
			for (let j = i + 1; j < lines.length; j++) if (lines[j].trim().startsWith("```")) {
				code_block_start_index = j;
				for (let k = j + 1; k < lines.length; k++) if (lines[k].trim().startsWith("```")) {
					code_block_end_index = k;
					break;
				}
				break;
			}
			if (code_block_start_index !== -1) {
				if (code_block_end_index === -1) code_block_end_index = lines.length - 1;
				found_any = true;
				if (current_text.length > 0) {
					const text_content = current_text.join("\n").trim();
					if (text_content) results.push({
						type: "text",
						content: text_content
					});
					current_text = [];
				}
				const { workspace_name, relative_path } = extract_workspace_and_path({
					raw_file_path: extracted,
					is_single_root_folder_workspace: params.is_single_root_folder_workspace
				});
				const content_lines = lines.slice(code_block_start_index + 1, code_block_end_index);
				results.push({
					type: "patch-repair",
					file_path: relative_path,
					content: cleanup_api_response({ content: content_lines.join("\n") }),
					workspace_name
				});
				i = code_block_end_index + 1;
				continue;
			}
		}
		current_text.push(lines[i]);
		i++;
	}
	if (!found_any) return null;
	if (current_text.length > 0) {
		const text_content = current_text.join("\n").trim();
		if (text_content) results.push({
			type: "text",
			content: text_content
		});
	}
	return results;
};
// ../../packages/core/src/response-parser/response-parser.ts
var extract_workspace_and_path = (params) => {
	let file_path = normalize_path(params.raw_file_path);
	if (file_path.startsWith("/")) file_path = file_path.substring(1);
	if (params.is_single_root_folder_workspace || !file_path.includes("/")) return { relative_path: file_path };
	const first_slash_index = file_path.indexOf("/");
	if (first_slash_index > 0) return {
		workspace_name: file_path.substring(0, first_slash_index),
		relative_path: file_path.substring(first_slash_index + 1)
	};
	return { relative_path: file_path };
};
var parse_response = (params) => {
	const commit_message = parse_commit_message(params.response);
	if (commit_message) return [commit_message];
	const is_single_root_folder_workspace = params.is_single_root_folder_workspace ?? true;
	if (params.workspace_files) {
		const search_results = parse_intelligent_file_search_results({
			response: params.response,
			workspace_files: params.workspace_files
		});
		if (search_results) return [search_results];
	}
	const code_at_cursor_items = parse_code_at_cursor({
		response: params.response,
		is_single_root_folder_workspace
	});
	if (code_at_cursor_items && code_at_cursor_items.length > 0) return code_at_cursor_items;
	const patch_repair_items = parse_patch_repair({
		response: params.response,
		is_single_root_folder_workspace
	});
	if (patch_repair_items && patch_repair_items.length > 0) return patch_repair_items;
	const processed_response = params.response.replace(/``````/g, "```\n```");
	if (!(processed_response.includes("<<<<<<<") && processed_response.includes("=======") && processed_response.includes(">>>>>>>")) && (/^(@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@)/m.test(processed_response) || /^---\s+.+\n\+\+\+\s+.+/m.test(processed_response) || /^diff --git /m.test(processed_response) || processed_response.includes("```diff") || processed_response.includes("```patch"))) {
		const patches_or_text = extract_diffs({
			response_text: processed_response,
			is_single_root: is_single_root_folder_workspace
		});
		if (patches_or_text.length) return patches_or_text;
	}
	return file_blocks_parser({
		response: processed_response,
		is_single_root_folder_workspace
	});
};
// ../../packages/core/src/changes/diff-processor/utils/empty-file-handler.ts
var handle_empty_file = (diff_patch) => {
	const patch_lines = diff_patch.replace(/\r\n/g, "\n").split("\n");
	let has_additions = false;
	let in_hunk = false;
	const result_lines = [];
	let seen_content = false;
	for (const line of patch_lines) {
		if (line.startsWith("@@")) {
			in_hunk = true;
			continue;
		}
		if (!in_hunk) continue;
		let line_to_add = null;
		let is_addition = false;
		if (line.startsWith("+")) {
			line_to_add = line.substring(1);
			is_addition = true;
			has_additions = true;
		} else if (line.startsWith(" ")) line_to_add = line.substring(1);
		else if (line === "") line_to_add = "";
		if (line_to_add !== null) {
			if (!seen_content) {
				if (!is_addition && line_to_add.trim() === "") continue;
				seen_content = true;
			}
			result_lines.push(line_to_add);
		}
	}
	if (has_additions) {
		let final_string = result_lines.join("\n");
		if (final_string.length > 0 && !final_string.endsWith("\n")) final_string += "\n";
		return final_string;
	}
	return null;
};
// ../../packages/core/src/changes/diff-processor/utils/normalize.ts
var normalize_original_code = (params) => {
	const original_code_lines_normalized = [];
	let line_count = 0;
	for (let i = 0; i < params.original_code_lines.length; i++) {
		let line = params.original_code_lines[i];
		if (line.trim() === "") line = "~nnn";
		const clean_invisibles = line.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "").replace(/[\u200B-\u200F\uFEFF]/g, "");
		let line_normalized_processed = clean_invisibles.replace(/\s+/g, "");
		if (params.use_strict_whitespace) line_normalized_processed = clean_invisibles;
		original_code_lines_normalized.push({
			key: line_count,
			value: line_normalized_processed
		});
		line_count++;
	}
	return original_code_lines_normalized;
};
var normalize_patch_lines = (params) => {
	const patch_lines_original = [];
	const patch_lines_normalized = [];
	for (let i = 0; i < params.patch_lines.length; i++) {
		let line = params.patch_lines[i];
		if (line.startsWith("diff --git") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) continue;
		if (line.trim() === "") line = "~nnn";
		else if (line.trim() === "+") line = "+~nnn";
		else if (line.trim() === "-") line = "-~nnn";
		const cleaned_line = line.replace(/[\u200B-\u200F\uFEFF]/g, "");
		patch_lines_original.push(cleaned_line.startsWith(" ") ? cleaned_line.substring(1, cleaned_line.length) : cleaned_line);
		let line_normalized = cleaned_line.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "");
		let line_normalized_processed = "";
		if (params.use_strict_whitespace) {
			if (line_normalized.startsWith(" ")) line_normalized_processed = "~" + line_normalized.substring(1);
			else line_normalized_processed = line_normalized;
		} else {
			if (line_normalized.startsWith(" ")) line_normalized = line_normalized.replace(/^\s+/, "~");
			line_normalized_processed = line_normalized.replace(/\s+/g, "");
		}
		patch_lines_normalized.push(line_normalized_processed);
	}
	return {
		patch_lines_original,
		patch_lines_normalized
	};
};
// ../../packages/core/src/changes/diff-processor/utils/parse-blocks.ts
var parse_patch_blocks = (params) => {
	const search_replace_blocks = [];
	let search_chunks = [];
	let replace_chunks = [];
	let after_search_chunks = [];
	let inside_replace_block = false;
	let current_block_has_changes = false;
	let current_search_index_tracker = -1;
	const push_block = () => {
		while (search_chunks.length > 0 && search_chunks[search_chunks.length - 1] === "~nnn" && replace_chunks.length > 0 && replace_chunks[replace_chunks.length - 1].search_index === search_chunks.length - 1) {
			search_chunks.pop();
			replace_chunks.pop();
			if (after_search_chunks.length > 0 && after_search_chunks[after_search_chunks.length - 1] === "~nnn") after_search_chunks.pop();
		}
		if (search_chunks.length > 0 || replace_chunks.length > 0) {
			if (current_block_has_changes) search_replace_blocks.push({
				search_lines: search_chunks,
				replace_lines: replace_chunks,
				after_search_lines: after_search_chunks,
				search_block_start_index: -1,
				actual_original_line_count: 0,
				search_to_original_map: /* @__PURE__ */ new Map()
			});
		}
		search_chunks = [];
		replace_chunks = [];
		after_search_chunks = [];
		inside_replace_block = false;
		current_block_has_changes = false;
		current_search_index_tracker = -1;
	};
	for (let i = 0; i < params.patch_lines_normalized.length; i++) {
		const line = params.patch_lines_normalized[i];
		const line_original = params.patch_lines_original[i];
		if (line.startsWith("@@")) {
			push_block();
			continue;
		}
		if (line.startsWith("-") || line.startsWith("~")) {
			if (inside_replace_block && line.startsWith("-")) push_block();
			inside_replace_block = false;
			if (line.startsWith("-")) current_block_has_changes = true;
			if (line.startsWith("~nnn") || line.startsWith("-~nnn")) search_chunks.push("~nnn");
			else search_chunks.push(line.replace(/^-/, "").replace(/^~/, ""));
			current_search_index_tracker = search_chunks.length - 1;
			if (!line.startsWith("-")) {
				if (line.startsWith("~nnn")) after_search_chunks.push("~nnn");
				else after_search_chunks.push(line.replace(/^~/, ""));
			}
			if (line.startsWith("~nnn")) replace_chunks.push({
				content: line_original.replace(/^~nnn/, "") + "\n",
				search_index: search_chunks.length - 1,
				insert_after_search_index: current_search_index_tracker
			});
			else if (line.startsWith("~")) replace_chunks.push({
				content: line_original + "\n",
				search_index: search_chunks.length - 1,
				insert_after_search_index: current_search_index_tracker
			});
			continue;
		}
		if (line.startsWith("+")) {
			inside_replace_block = true;
			current_block_has_changes = true;
			if (line.startsWith("+~nnn")) {
				replace_chunks.push({
					content: line_original.replace(/^\+~nnn/, "") + "\n",
					search_index: null,
					insert_after_search_index: current_search_index_tracker
				});
				after_search_chunks.push("~nnn");
			} else {
				replace_chunks.push({
					content: line_original.replace(/^\+/, "") + "\n",
					search_index: null,
					insert_after_search_index: current_search_index_tracker
				});
				after_search_chunks.push(line.replace(/^\+/, ""));
			}
		}
	}
	push_block();
	return search_replace_blocks;
};
// ../../packages/core/src/changes/diff-processor/utils/match-blocks.ts
var match_blocks = (params) => {
	let previous_found_index = 0;
	for (let i = 0; i < params.search_replace_blocks.length; i++) {
		const block = params.search_replace_blocks[i];
		if (block.search_lines.length === 0 && previous_found_index === 0) {
			block.search_block_start_index = -1;
			continue;
		}
		const safe_trim_indices = [];
		for (const replace_line of block.replace_lines) {
			if (replace_line.search_index === null) break;
			safe_trim_indices.push(replace_line.search_index);
		}
		let max_trim_top = 0;
		for (let k = 0; k < safe_trim_indices.length; k++) if (safe_trim_indices[k] === k) max_trim_top = k + 1;
		else break;
		if (max_trim_top > 0 && safe_trim_indices.length === max_trim_top) {
			if (max_trim_top < block.replace_lines.length && block.replace_lines[max_trim_top].search_index === null) {
				let has_deletion = true;
				for (let r = max_trim_top + 1; r < block.replace_lines.length; r++) if (block.replace_lines[r].search_index === max_trim_top) {
					has_deletion = false;
					break;
				}
				if (!has_deletion) max_trim_top -= 1;
			}
		}
		let found = false;
		let matched_info = null;
		let used_trim_top = 0;
		for (let trim_cnt = 0; trim_cnt <= max_trim_top; trim_cnt++) {
			const current_search_lines = block.search_lines.slice(trim_cnt);
			if (current_search_lines.length === 0) continue;
			for (let j = previous_found_index; j < params.original_code_lines_normalized.length; j++) {
				let search_ptr = 0;
				let original_ptr = j;
				const matched_indices = [];
				const current_search_to_original = /* @__PURE__ */ new Map();
				while (search_ptr < current_search_lines.length && original_ptr < params.original_code_lines_normalized.length) {
					const s_val = current_search_lines[search_ptr];
					const o_val = params.original_code_lines_normalized[original_ptr].value;
					if (s_val === o_val) {
						current_search_to_original.set(search_ptr + trim_cnt, params.original_code_lines_normalized[original_ptr].key);
						matched_indices.push(params.original_code_lines_normalized[original_ptr].key);
						search_ptr++;
						original_ptr++;
					} else if (o_val === "~nnn") original_ptr++;
					else if (s_val === "~nnn") search_ptr++;
					else break;
				}
				if (search_ptr === current_search_lines.length) {
					matched_info = {
						start_index: matched_indices.length > 0 ? matched_indices[0] : params.original_code_lines_normalized[j].key,
						actual_count: matched_indices.length > 0 ? matched_indices[matched_indices.length - 1] - matched_indices[0] + 1 : 0,
						map: current_search_to_original
					};
					found = true;
					break;
				}
			}
			if (found) {
				used_trim_top = trim_cnt;
				break;
			}
		}
		if (!found) for (let trim_cnt = 0; trim_cnt <= max_trim_top; trim_cnt++) {
			const current_search_lines = block.search_lines.slice(trim_cnt);
			if (current_search_lines.length === 0) continue;
			for (let j = previous_found_index; j < params.original_code_lines_normalized.length; j++) {
				let search_ptr = 0;
				let original_ptr = j;
				const matched_indices = [];
				const current_search_to_original = /* @__PURE__ */ new Map();
				let match_failed = false;
				while (search_ptr < current_search_lines.length && original_ptr < params.original_code_lines_normalized.length) {
					const s_val = current_search_lines[search_ptr];
					const o_val = params.original_code_lines_normalized[original_ptr].value;
					if (s_val === o_val) {
						current_search_to_original.set(search_ptr + trim_cnt, params.original_code_lines_normalized[original_ptr].key);
						matched_indices.push(params.original_code_lines_normalized[original_ptr].key);
						search_ptr++;
						original_ptr++;
					} else if (o_val === "~nnn") original_ptr++;
					else if (s_val === "~nnn") search_ptr++;
					else {
						let found_ahead = false;
						const max_lookahead = 50;
						for (let k = 1; k <= max_lookahead && original_ptr + k < params.original_code_lines_normalized.length; k++) if (params.original_code_lines_normalized[original_ptr + k].value === s_val) {
							found_ahead = true;
							original_ptr += k;
							break;
						}
						if (!found_ahead) {
							match_failed = true;
							break;
						}
					}
				}
				if (!match_failed && search_ptr === current_search_lines.length) {
					matched_info = {
						start_index: matched_indices.length > 0 ? matched_indices[0] : params.original_code_lines_normalized[j].key,
						actual_count: matched_indices.length > 0 ? matched_indices[matched_indices.length - 1] - matched_indices[0] + 1 : 0,
						map: current_search_to_original
					};
					found = true;
					break;
				}
			}
			if (found) {
				used_trim_top = trim_cnt;
				break;
			}
		}
		if (found && matched_info) {
			block.search_block_start_index = matched_info.start_index;
			block.actual_original_line_count = matched_info.actual_count;
			block.search_to_original_map = matched_info.map;
			if (used_trim_top > 0) {
				block.search_lines = block.search_lines.slice(used_trim_top);
				block.replace_lines = block.replace_lines.filter((l) => l.search_index === null || l.search_index >= used_trim_top);
			}
			const has_additions = block.replace_lines.some((l) => l.search_index === null);
			const is_noop = block.search_lines.length === block.after_search_lines.length && block.search_lines.every((v, i) => v === block.after_search_lines[i]);
			if (has_additions && block.after_search_lines.length > 0 && !is_noop) {
				const check_start = Math.max(0, matched_info.start_index - block.after_search_lines.length);
				const check_end = Math.min(params.original_code_lines_normalized.length - 1, matched_info.start_index + matched_info.actual_count);
				let already_applied = false;
				for (let j = check_start; j <= check_end; j++) {
					let after_ptr = 0;
					let orig_ptr = j;
					while (after_ptr < block.after_search_lines.length && orig_ptr < params.original_code_lines_normalized.length) {
						const a_val = block.after_search_lines[after_ptr];
						const o_val = params.original_code_lines_normalized[orig_ptr].value;
						if (a_val === o_val) {
							after_ptr++;
							orig_ptr++;
						} else if (o_val === "~nnn") orig_ptr++;
						else if (a_val === "~nnn") after_ptr++;
						else break;
					}
					if (after_ptr === block.after_search_lines.length) {
						already_applied = true;
						break;
					}
				}
				if (already_applied) block.search_block_start_index = -2;
			}
			if (block.search_block_start_index !== -2) {
				const indices = Array.from(matched_info.map.values());
				previous_found_index = Math.max(...indices) + 1;
			}
		} else block.search_block_start_index = -2;
	}
};
// ../../packages/core/src/changes/diff-processor/utils/apply-blocks.ts
var apply_blocks = (params) => {
	const result_lines = [...params.original_code_lines];
	for (const block of params.valid_blocks) {
		const start_index = block.search_block_start_index === -1 ? 0 : block.search_block_start_index;
		const replacement_content = [];
		let last_original_idx = start_index - 1;
		const matched_original_indices = new Set(block.search_to_original_map.values());
		const search_count = block.actual_original_line_count || block.search_lines.length;
		const end_original_idx = start_index + search_count - 1;
		for (let i = 0; i < block.replace_lines.length; i++) {
			const line = block.replace_lines[i];
			const is_last_replace_line = i === block.replace_lines.length - 1;
			if (line.search_index !== null) {
				const original_idx = block.search_to_original_map.get(line.search_index);
				if (original_idx !== void 0) {
					for (let skip = last_original_idx + 1; skip < original_idx; skip++) if (!matched_original_indices.has(skip)) replacement_content.push(params.original_code_lines[skip]);
					let content = params.original_code_lines[original_idx];
					if (!content.endsWith("\n") && (original_idx < params.original_code_lines.length - 1 || !is_last_replace_line)) content += "\n";
					replacement_content.push(content);
					last_original_idx = original_idx;
				}
			} else {
				let target_original_idx = last_original_idx;
				if (line.insert_after_search_index >= 0) {
					const mapped_idx = block.search_to_original_map.get(line.insert_after_search_index);
					if (mapped_idx !== void 0) target_original_idx = mapped_idx;
				}
				for (let skip = last_original_idx + 1; skip <= target_original_idx; skip++) if (!matched_original_indices.has(skip)) replacement_content.push(params.original_code_lines[skip]);
				if (target_original_idx > last_original_idx) last_original_idx = target_original_idx;
				let content = line.content;
				if (is_last_replace_line && params.original_code_lines.length > 0 && end_original_idx === params.original_code_lines.length - 1 && !params.original_code_lines[params.original_code_lines.length - 1].endsWith("\n")) content = content.replace(/\n$/, "");
				replacement_content.push(content);
			}
		}
		for (let skip = last_original_idx + 1; skip <= end_original_idx; skip++) if (!matched_original_indices.has(skip)) replacement_content.push(params.original_code_lines[skip]);
		if (start_index >= 0 && start_index <= result_lines.length) result_lines.splice(start_index, search_count, ...replacement_content);
	}
	return result_lines.join("");
};
// ../../packages/core/src/changes/diff-processor/diff-processor.ts
var apply_diff = (params) => {
	const original_code_normalized = params.original_code.replace(/\r\n/g, "\n");
	if (original_code_normalized.trim() === "") {
		const empty_file_result = handle_empty_file(params.diff_patch);
		if (empty_file_result !== null) return empty_file_result;
	}
	const original_code_lines = original_code_normalized.split(/^/m);
	const original_code_lines_normalized = normalize_original_code({
		original_code_lines,
		use_strict_whitespace: params.use_strict_whitespace
	});
	const { patch_lines_original, patch_lines_normalized } = normalize_patch_lines({
		patch_lines: params.diff_patch.replace(/\r\n/g, "\n").split("\n"),
		use_strict_whitespace: params.use_strict_whitespace
	});
	const search_replace_blocks = parse_patch_blocks({
		patch_lines_normalized,
		patch_lines_original
	});
	match_blocks({
		search_replace_blocks,
		original_code_lines_normalized
	});
	const invalid_blocks = search_replace_blocks.filter((block) => block.search_block_start_index === -2);
	if (invalid_blocks.length > 0) throw new Error(`Failed to apply ${invalid_blocks.length} hunk(s). Aborting diff application for this file.`);
	const valid_blocks = search_replace_blocks;
	valid_blocks.sort((a, b) => b.search_block_start_index - a.search_block_start_index);
	return apply_blocks({
		valid_blocks,
		original_code_lines
	});
};
// ../../packages/core/src/changes/truncations-processor/utils/find-line-sequence.ts
var find_line_sequence = (params) => {
	if (params.sequence.length === 0) return -1;
	if (params.start_idx >= params.lines.length) return -1;
	for (let i = params.start_idx; i <= params.lines.length - params.sequence.length; i++) {
		let match = true;
		for (let j = 0; j < params.sequence.length; j++) if (params.lines[i + j].replace(/[\u200B-\u200F\uFEFF]/g, "") !== params.sequence[j]) {
			match = false;
			break;
		}
		if (match) return i;
	}
	for (let i = params.start_idx; i <= params.lines.length - params.sequence.length; i++) {
		let match = true;
		for (let j = 0; j < params.sequence.length; j++) if (params.lines[i + j].replace(/[\u200B-\u200F\uFEFF]/g, "").trim() !== params.sequence[j].trim()) {
			match = false;
			break;
		}
		if (match) return i;
	}
	return -1;
};
// ../../packages/core/src/changes/truncations-processor/utils/is-truncation-line.ts
var TRUNCATION_REGEX = /^\s*(\/\/|#|<!--|;|"|'|\{\/\*|\/\*)\s*\.{3,}.*\s*$/;
var is_truncation_line = (line) => TRUNCATION_REGEX.test(line);
// ../../packages/core/src/changes/truncations-processor/truncations-processor.ts
var process_truncations = (new_text, original_text) => {
	const new_lines = new_text.replace(/[\u200B-\u200F\uFEFF]/g, "").split(/\r?\n/);
	const original_lines = original_text.split(/\r?\n/);
	const blocks = [];
	let buffer = [];
	for (const line of new_lines) if (is_truncation_line(line)) {
		if (buffer.length > 0) {
			blocks.push({
				type: "code",
				lines: buffer
			});
			buffer = [];
		}
		blocks.push({
			type: "truncation",
			lines: [line]
		});
	} else buffer.push(line);
	if (buffer.length > 0) blocks.push({
		type: "code",
		lines: buffer
	});
	const output_lines = [];
	let current_original_idx = 0;
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (block.type === "code") {
			output_lines.push(...block.lines);
			const suffix_lines = block.lines.slice(-10);
			let found_match = false;
			let match_end_idx = -1;
			for (let len = suffix_lines.length; len >= 1; len--) {
				const idx = find_line_sequence({
					lines: original_lines,
					sequence: suffix_lines.slice(suffix_lines.length - len),
					start_idx: current_original_idx
				});
				if (idx !== -1) {
					found_match = true;
					match_end_idx = idx + len;
					break;
				}
			}
			if (found_match) current_original_idx = match_end_idx;
		} else {
			let fill_end_idx = original_lines.length;
			if (i + 1 < blocks.length) {
				const next_block = blocks[i + 1];
				if (next_block.type === "code") {
					const prefix_lines = next_block.lines.slice(0, 10);
					let found_next = false;
					for (let len = prefix_lines.length; len >= 1; len--) {
						const idx = find_line_sequence({
							lines: original_lines,
							sequence: prefix_lines.slice(0, len),
							start_idx: current_original_idx
						});
						if (idx !== -1) {
							fill_end_idx = idx;
							found_next = true;
							break;
						}
					}
					if (!found_next) fill_end_idx = original_lines.length;
				}
			}
			if (fill_end_idx > current_original_idx) output_lines.push(...original_lines.slice(current_original_idx, fill_end_idx));
			current_original_idx = fill_end_idx;
		}
	}
	const result = output_lines.join("\n");
	if (original_text.endsWith("\n") && !result.endsWith("\n")) return result + "\n";
	return result;
};
// ../../packages/core/src/changes/search-replace-processor/apply-search-replace-to-content/apply-search-replace-to-content.ts
var escape_reg_exp = (string) => {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};
var apply_search_replace_to_content = (params) => {
	const line_ending = params.original_content.includes("\r\n") ? "\r\n" : "\n";
	let current_content = params.original_content;
	const segments = params.segments;
	let cursor = 0;
	const MAX_CONTEXT_LINES = 5;
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (segment.type !== "search_replace") continue;
		const prev = i > 0 ? segments[i - 1] : void 0;
		const next = i < segments.length - 1 ? segments[i + 1] : void 0;
		const context_before = prev && prev.type === "common" ? prev.lines.slice(-5) : [];
		const context_after = next && next.type === "common" ? next.lines.slice(0, MAX_CONTEXT_LINES) : [];
		const clean_lines = (lines) => lines.filter((l) => l.replace(/[\u200B-\u200F\uFEFF]/g, "").trim() !== "");
		const clean_context_before = clean_lines(context_before);
		const clean_original = clean_lines(segment.original_lines);
		const clean_context_after = clean_lines(context_after);
		const SEPARATOR = "(?:[ \\t\\u200B-\\u200F\\uFEFF]*\\r?\\n){1,5}";
		const build_block_pattern = (lines) => {
			return lines.map((line) => {
				return `[ \\t\\u200B-\\u200F\\uFEFF]*${[...line.replace(/[\u200B-\u200F\uFEFF]/g, "").trim()].map(escape_reg_exp).join("[\\u200B-\\u200F\\uFEFF]*")}`;
			}).join(SEPARATOR);
		};
		const regex_parts = [];
		if (clean_context_before.length > 0) regex_parts.push(`(${build_block_pattern(clean_context_before)})`);
		if (clean_original.length > 0) regex_parts.push(`(${build_block_pattern(clean_original)})`);
		if (clean_context_after.length > 0) regex_parts.push(`(${build_block_pattern(clean_context_after)})`);
		const regex = new RegExp(regex_parts.join(SEPARATOR));
		const content_slice = current_content.slice(cursor);
		const match = regex.exec(content_slice);
		if (!match) {
			const search_text = [
				...context_before,
				...segment.original_lines,
				...context_after
			].join("\n");
			throw new Error(`Could not find content to replace for search replace block. Context:\n${search_text.slice(0, 100)}...`);
		}
		const match_index = cursor + match.index;
		const matched_text = match[0];
		let group_index = 1;
		const matched_before = clean_context_before.length > 0 ? match[group_index++] : "";
		if (clean_original.length > 0) group_index++;
		const matched_after = clean_context_after.length > 0 ? match[group_index++] : "";
		const updated_text = segment.updated_lines.map((line) => line.replace(/[\u200B-\u200F\uFEFF]/g, "")).join(line_ending);
		const replacement_parts = [];
		if (matched_before) replacement_parts.push(matched_before);
		if (segment.updated_lines.length > 0) replacement_parts.push(updated_text);
		if (matched_after) replacement_parts.push(matched_after);
		const replacement_text = replacement_parts.join(line_ending);
		current_content = current_content.slice(0, match_index) + replacement_text + current_content.slice(match_index + matched_text.length);
		const content_before_after_context = matched_before ? matched_before + line_ending + updated_text : updated_text;
		cursor = matched_after ? match_index + content_before_after_context.length : match_index + replacement_text.length;
	}
	return current_content;
};
// ../../packages/core/src/changes/search-replace-processor/parse-search-replace-segments.ts
var parse_search_replace_segments = (content) => {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const segments = [];
	let current_lines = [];
	let state = "NORMAL";
	let original_buffer = [];
	let updated_buffer = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "<<<<<<<" || trimmed.startsWith("<<<<<<< ")) {
			if (state === "NORMAL") {
				if (current_lines.length > 0) {
					segments.push({
						type: "common",
						lines: [...current_lines]
					});
					current_lines = [];
				}
				state = "ORIGINAL";
				original_buffer = [];
				updated_buffer = [];
			} else {
				if (state === "ORIGINAL") original_buffer.push(line);
				if (state === "UPDATED") updated_buffer.push(line);
			}
			continue;
		}
		if (trimmed === "=======" || trimmed.startsWith("======= ")) {
			if (state === "ORIGINAL") state = "UPDATED";
			else if (state === "NORMAL") current_lines.push(line);
			else updated_buffer.push(line);
			continue;
		}
		if (trimmed === ">>>>>>>" || trimmed.startsWith(">>>>>>> ")) {
			if (state === "UPDATED" || state === "ORIGINAL") {
				segments.push({
					type: "search_replace",
					original_lines: original_buffer,
					updated_lines: state === "UPDATED" ? updated_buffer : []
				});
				state = "NORMAL";
				original_buffer = [];
				updated_buffer = [];
			} else current_lines.push(line);
			continue;
		}
		if (state === "NORMAL") current_lines.push(line);
		else if (state === "ORIGINAL") original_buffer.push(line);
		else if (state === "UPDATED") updated_buffer.push(line);
	}
	if (current_lines.length > 0) segments.push({
		type: "common",
		lines: current_lines
	});
	return segments;
};
// ../../packages/core/src/apply/strategies.ts
var preserve_trailing_newline = (original_content, new_content) => {
	if (original_content.endsWith("\n") && !new_content.endsWith("\n")) return new_content + "\n";
	return new_content;
};
var has_conflict_markers = (content) => content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>");
var has_truncation_markers = (content) => content.split("\n").some((line) => is_truncation_line(line));
/** Mirrors the editor's apply-time strategy detection. */
var detect_strategy = (params) => {
	if (params.diff_items.length > 0) return "diff";
	if (params.file_items.some((f) => has_conflict_markers(f.content))) return "search-replace";
	if (params.file_items.some((f) => has_truncation_markers(f.content))) return "truncated";
	return "whole";
};
var compute_proposed_content = (params) => {
	const { strategy, content, original_content } = params;
	if (strategy === "truncated") return process_truncations(content, original_content);
	if (strategy === "search-replace") {
		if (has_conflict_markers(content)) return apply_search_replace_to_content({
			original_content,
			segments: parse_search_replace_segments(content)
		});
		return preserve_trailing_newline(original_content, content);
	}
	if (strategy === "diff") return apply_diff({
		original_code: original_content,
		diff_patch: content
	});
	return preserve_trailing_newline(original_content, content);
};
// ../../packages/core/src/utils/safe-path.ts
var FORBIDDEN_PREFIXES = [
	".git",
	"node_modules",
	"vendor",
	".venv",
	"dist",
	"build",
	"target",
	"bin",
	"obj"
];
/**
* Resolves a model-supplied path inside a workspace root and refuses anything
* that escapes it (traversal, absolute paths, `.git`, generated folders).
* Returns null when the path is not safe to touch.
*/
var resolve_safe_path = (workspace_root, relative_path) => {
	const normalized = normalize_path(relative_path).replace(/^\/+/, "");
	if (!normalized || normalized.includes("\0")) return null;
	if (normalized.split("/").includes("..")) return null;
	if (path.isAbsolute(normalized)) return null;
	const first_segment = normalized.split("/")[0].toLowerCase();
	if (FORBIDDEN_PREFIXES.includes(first_segment)) return null;
	const root = path.resolve(workspace_root);
	const resolved = path.resolve(root, normalized);
	const root_with_sep = root.endsWith(path.sep) ? root : root + path.sep;
	if (resolved !== root && !resolved.startsWith(root_with_sep)) return null;
	return resolved;
};
// ../../packages/core/src/apply/apply-response.ts
var find_root = (roots, workspace_name) => {
	if (workspace_name) {
		const named = roots.find((r) => r.name === workspace_name);
		if (named) return named;
	}
	return roots.find((r) => r.name === workspace_name) ?? roots[0];
};
var make_id = (workspace_name, file_path) => `${workspace_name ?? ""}:${file_path}`;
/**
* Turns a chat response into proposed changes without touching the disk.
*/
var plan_changes = async (params) => {
	const { host, roots, items } = params;
	const file_items = items.filter((i) => i.type === "file");
	const diff_items = items.filter((i) => i.type === "diff");
	if (file_items.length === 0 && diff_items.length === 0) return {
		changes: [],
		strategy: null,
		error: get_unsupported_reason(items)
	};
	const strategy = detect_strategy({
		file_items,
		diff_items
	});
	const changes = [];
	for (const item of file_items) {
		const root = find_root(roots, item.workspace_name);
		if (!root) continue;
		const absolute_path = resolve_safe_path(root.path, item.file_path);
		if (!absolute_path) continue;
		const exists = await host.exists(absolute_path);
		const original_content = exists ? await host.read_file(absolute_path) ?? "" : "";
		let proposed_content = "";
		let kind = exists ? "update" : "create";
		if (item.is_deleted) kind = "delete";
		else if (item.renamed_from) kind = "rename";
		if (kind !== "delete") try {
			proposed_content = compute_proposed_content({
				strategy,
				content: item.content,
				original_content
			});
		} catch {
			proposed_content = original_content;
		}
		changes.push({
			id: make_id(item.workspace_name, item.file_path),
			kind,
			file_path: item.file_path,
			workspace_name: item.workspace_name,
			content: original_content,
			proposed_content,
			ai_content: item.content,
			file_state: kind === "create" ? "new" : void 0,
			file_path_to_restore: item.renamed_from,
			restore_workspace_name: item.renamed_from_workspace,
			is_pure_rename: kind === "rename" && item.content.trim() === "",
			absolute_path
		});
	}
	for (const item of diff_items) {
		const root = find_root(roots, item.workspace_name);
		if (!root) continue;
		const absolute_path = resolve_safe_path(root.path, item.file_path);
		if (!absolute_path) continue;
		const exists = await host.exists(absolute_path);
		const original_content = exists ? await host.read_file(absolute_path) ?? "" : "";
		let proposed_content = original_content;
		let apply_failed = false;
		try {
			proposed_content = compute_proposed_content({
				strategy: "diff",
				content: item.content,
				original_content
			});
		} catch {
			apply_failed = true;
		}
		changes.push({
			id: make_id(item.workspace_name, item.file_path),
			kind: exists ? "update" : "create",
			file_path: item.file_path,
			workspace_name: item.workspace_name,
			content: original_content,
			proposed_content,
			ai_content: item.content,
			file_state: exists ? void 0 : "new",
			apply_failed,
			absolute_path
		});
	}
	return {
		changes,
		strategy
	};
};
var get_unsupported_reason = (items) => {
	if (items.some((i) => i.type === "commit-message")) return "The response is a commit message, not a file change.";
	if (items.some((i) => i.type === "intelligent-file-search-results")) return "The response is an intelligent file search result, not a file change.";
	if (items.some((i) => i.type === "code-at-cursor")) return "The response is a code-at-cursor completion, not a file change.";
	if (items.some((i) => i.type === "patch-repair")) return "Patch repair responses are not handled by this client yet.";
	return "No applicable file changes were found in the response.";
};
/**
* Parses a response, shows the diff (when the host supports it), then applies
* the accepted changes. Nothing is written when the plan is cancelled.
*/
var apply_response = async (params) => {
	const { host, options } = params;
	const roots = await host.get_workspace_roots();
	if (roots.length === 0) return {
		applied: [],
		rejected: [],
		strategy: null,
		error: "No workspace folder is open."
	};
	const workspace_files = options.workspace_files ?? await host.list_workspace_files(roots[0]);
	const plan = await plan_changes({
		host,
		roots,
		items: parse_response({
			response: options.response,
			is_single_root_folder_workspace: roots.length <= 1,
			workspace_files
		})
	});
	if (plan.error && plan.changes.length === 0) return {
		applied: [],
		rejected: [],
		strategy: null,
		error: plan.error
	};
	let accepted = plan.changes;
	if (options.preview && host.confirm_changes) {
		const accepted_ids = await host.confirm_changes({
			changes: plan.changes,
			instructions: options.instructions
		});
		if (accepted_ids === null) return {
			applied: [],
			rejected: plan.changes,
			strategy: plan.strategy
		};
		accepted = plan.changes.filter((c) => accepted_ids.includes(c.id));
	}
	const applied = [];
	const rejected = plan.changes.filter((c) => !accepted.includes(c));
	for (const change of accepted) try {
		if (change.kind === "delete") {
			if (await host.exists(change.absolute_path)) await host.delete_file(change.absolute_path);
		} else if (change.kind === "rename" && change.file_path_to_restore) {
			const restore_root = find_root(roots, change.restore_workspace_name);
			const restore_path = restore_root ? resolve_safe_path(restore_root.path, change.file_path_to_restore) : null;
			if (restore_path && await host.exists(restore_path)) await host.rename_file(restore_path, change.absolute_path);
			if (!change.is_pure_rename) await host.write_file(change.absolute_path, change.proposed_content);
		} else await host.write_file(change.absolute_path, change.proposed_content);
		applied.push(change);
	} catch (error) {
		host.error(`Failed to apply ${change.file_path}: ${error.message}`);
		rejected.push(change);
	}
	return {
		applied,
		rejected,
		strategy: plan.strategy
	};
};
/** What the host should persist so `revert_changes` can undo the apply. */
var to_original_states = (changes) => changes.map((change) => ({
	file_path: change.file_path,
	content: change.content,
	workspace_name: change.workspace_name,
	file_state: change.file_state,
	file_path_to_restore: change.file_path_to_restore,
	restore_workspace_name: change.restore_workspace_name,
	is_pure_rename: change.is_pure_rename,
	ai_content: change.ai_content,
	proposed_content: change.proposed_content,
	apply_failed: change.apply_failed
}));
// ../../packages/core/src/apply/revert.ts
/**
* Restores files to the content recorded before an apply. Mirrors the editor's
* `undo_files`: delete files that were created, move renames back, recreate
* deleted files and restore edited ones.
*/
var revert_changes = async (params) => {
	const { host, states } = params;
	const roots = await host.get_workspace_roots();
	const find_root = (name) => roots.find((r) => r.name === name) ?? roots[0];
	const reverted = [];
	const failed = [];
	for (const state of states) {
		const root = find_root(state.workspace_name);
		if (!root) {
			failed.push({
				file_path: state.file_path,
				error: "No workspace root for this file."
			});
			continue;
		}
		const absolute_path = resolve_safe_path(root.path, state.file_path);
		if (!absolute_path) {
			failed.push({
				file_path: state.file_path,
				error: "Unsafe file path."
			});
			continue;
		}
		try {
			if (state.file_state === "new" && !state.file_path_to_restore) {
				if (await host.exists(absolute_path)) await host.delete_file(absolute_path);
				reverted.push(state.file_path);
				continue;
			}
			if (state.file_path_to_restore) {
				const restore_root = find_root(state.restore_workspace_name);
				const restore_path = restore_root ? resolve_safe_path(restore_root.path, state.file_path_to_restore) : null;
				if (!restore_path) {
					failed.push({
						file_path: state.file_path,
						error: "Unsafe restore path."
					});
					continue;
				}
				if (!state.is_pure_rename && await host.exists(absolute_path)) {
					await host.write_file(restore_path, state.content);
					await host.delete_file(absolute_path);
				} else if (await host.exists(absolute_path)) await host.rename_file(absolute_path, restore_path);
				reverted.push(state.file_path);
				continue;
			}
			await host.write_file(absolute_path, state.content);
			reverted.push(state.file_path);
		} catch (error) {
			failed.push({
				file_path: state.file_path,
				error: error.message
			});
		}
	}
	return {
		reverted,
		failed
	};
};
// ../../packages/shared/src/constants/chatbots.ts
var CHATBOTS = {
	"AI Studio": {
		url: "https://aistudio.google.com/prompts/new_chat",
		supports_system_instructions: true,
		default_system_instructions: "You're a helpful coding assistant.",
		supported_options: {
			"hide-panel": "Hide panel",
			"grounding-with-google-search": "Grounding with Google Search",
			"url-context": "URL context"
		},
		models: {
			"gemini-4-argon": {
				label: "Gemini 4 Argon",
				supported_reasoning_efforts: [
					"Low",
					"Medium",
					"High"
				]
			},
			"gemini-pro-latest": {
				label: "Gemini Pro Latest",
				supported_reasoning_efforts: [
					"Low",
					"Medium",
					"High"
				]
			},
			"gemini-flash-latest": {
				label: "Gemini Flash Latest",
				supported_reasoning_efforts: [
					"Low",
					"Medium",
					"High"
				]
			},
			"gemini-flash-lite-latest": {
				label: "Gemini Flash-Lite Latest",
				supported_reasoning_efforts: [
					"Minimal",
					"Low",
					"Medium",
					"High"
				]
			}
		}
	},
	Arena: {
		url: "https://arena.ai/",
		supports_user_provided_model: true
	},
	ChatGPT: {
		url: "https://chatgpt.com/",
		supports_url_override: true,
		url_override_label: "Project URL",
		url_override_disabled_options: ["temporary"],
		supports_reasoning_effort: true,
		supported_reasoning_efforts: [
			"instant",
			"medium",
			"high"
		],
		supported_options: { temporary: "Temporary" }
	},
	Claude: {
		url: "https://claude.ai/new",
		supports_url_override: true,
		url_override_label: "Project URL",
		url_override_disabled_options: ["incognito-chat"],
		supported_options: { "incognito-chat": "Incognito chat" }
	},
	Copilot: {
		url: "https://copilot.com/chat",
		supports_reasoning_effort: true,
		supported_reasoning_efforts: [
			"Auto",
			"Quick",
			"Deep"
		],
		supported_options: { temporary: "Temporary chat" }
	},
	DeepSeek: {
		url: "https://chat.deepseek.com/",
		supported_options: {
			"deep-think": "DeepThink",
			search: "Search"
		}
	},
	Doubao: {
		url: "https://www.doubao.com/chat/",
		supported_options: { "deep-thinking": "Deep Thinking" }
	},
	Gemini: {
		url: "https://gemini.google.com/app",
		supported_options: { "temporary-chat": "Temporary chat" },
		supports_url_override: true,
		url_override_label: "Gem URL",
		url_override_disabled_options: ["temporary-chat"],
		supports_reasoning_effort: true,
		supported_reasoning_efforts: [
			"Low",
			"Medium",
			"High"
		],
		models: {
			"flash-lite": { label: "Flash-Lite" },
			flash: { label: "Flash" },
			pro: { label: "Pro" },
			argon: { label: "Argon" }
		}
	},
	"GitHub Copilot": {
		url: "https://github.com/copilot",
		supports_url_override: true,
		url_override_label: "Space URL"
	},
	Grok: {
		url: "https://grok.com/",
		supports_url_override: true,
		url_override_label: "Project URL",
		url_override_disabled_options: ["private"],
		supported_options: { private: "Private" },
		models: {
			fast: { label: "Fast" },
			expert: { label: "Expert" }
		}
	},
	HuggingChat: {
		url: "https://huggingface.co/chat/",
		supports_user_provided_model: true,
		supports_reasoning_effort: true,
		supported_reasoning_efforts: [
			"Low",
			"Medium",
			"High"
		]
	},
	"Kimi (Global)": { url: "https://www.kimi.ai/" },
	"Kimi (China)": { url: "https://www.kimi.com/" },
	"Meta AI": { url: "https://www.meta.ai/" },
	Mistral: {
		url: "https://chat.mistral.ai/work",
		supports_url_override: true,
		url_override_label: "Project URL",
		url_override_disabled_options: ["incognito"],
		supported_options: {
			incognito: "Incognito mode",
			think: "Think"
		}
	},
	"Open WebUI": {
		url: "http://openwebui/",
		supports_system_instructions: true,
		supports_user_provided_model: true,
		default_system_instructions: "You're a helpful coding assistant."
	},
	OpenRouter: {
		url: "https://openrouter.ai/chat",
		supports_system_instructions: true,
		supports_reasoning_effort: true,
		supported_reasoning_efforts: [
			"None",
			"Minimal",
			"Low",
			"Medium",
			"High",
			"XHigh",
			"Max"
		],
		default_system_instructions: "You're a helpful coding assistant."
	},
	Qwen: {
		url: "https://chat.qwen.ai/",
		supports_url_override: true,
		url_override_label: "Project URL",
		url_override_disabled_options: ["temporary"],
		supported_options: { temporary: "Temporary" },
		models: {
			fast: { label: "Fast" },
			thinking: { label: "Thinking" }
		}
	},
	Together: { url: "https://chat.together.ai/" },
	Yuanbao: { url: "https://yuanbao.tencent.com/chat" },
	"Z (Global)": { url: "https://chat.z.ai/" },
	"Z (China)": { url: "https://zchat.z.ai/" }
};
// src/methods.ts
var resolve_relative = (root_path, absolute_path) => path.relative(root_path, absolute_path).replace(/\\/g, "/");
/**
* Collects context files for the prompt: the host's selection (or an explicit
* list), read through the host so the editor's unsaved buffers are used.
*/
var collect_context_files = async (params) => {
	const roots = await params.host.get_workspace_roots();
	const selected = params.paths ?? await params.host.get_selected_files();
	const files = [];
	for (const absolute_path of selected) {
		const root = roots.find((candidate) => absolute_path.startsWith(candidate.path)) ?? roots[0];
		if (!root) continue;
		const content = await params.host.read_file(absolute_path);
		const is_binary = content === null;
		files.push({
			path: resolve_relative(root.path, absolute_path),
			content: is_binary ? void 0 : content,
			is_binary,
			modified_at: void 0
		});
	}
	return files;
};
var resolve_chatbot_url = (params) => {
	const chatbot = CHATBOTS[params.chatbot];
	if (!chatbot) return void 0;
	let url = chatbot.url;
	if (params.chatbot === "AI Studio" && params.model) url = `${url}?model=${params.model}`;
	else if (params.chatbot === "Arena" && params.model) url = `https://arena.ai/?mode=direct&model=${params.model}`;
	else if (params.chatbot === "Open WebUI") url = "http://openwebui/";
	return url;
};
var register_methods = (deps) => {
	const { peer, host, server, state } = deps;
	peer.register("ping", () => ({
		ok: true,
		pid: process.pid
	}));
	peer.register("browsers.list", () => ({ browsers: server.get_browsers() }));
	peer.register("workspace.files", async () => {
		const roots = await host.get_workspace_roots();
		if (roots.length === 0) return {
			roots: [],
			files: []
		};
		const root = roots[0];
		const files = await host.list_workspace_files(root);
		return {
			root: {
				name: root.name,
				path: root.path
			},
			files: files.map((relative) => ({
				relative,
				absolute: path.join(root.path, relative)
			}))
		};
	});
	peer.register("prompt.build", async (params) => {
		const files = await collect_context_files({
			host,
			paths: params?.paths
		});
		if (files.length === 0) throw new Error("Context is empty: select at least one file.");
		const { text } = build_chatbot_prompt({
			files,
			instructions: params?.instructions ?? "",
			prompt_type: params?.prompt_type ?? "edit",
			edit_format: params?.edit_format ?? "truncated",
			completed_tasks: params?.completed_tasks
		});
		return {
			text,
			file_count: files.length
		};
	});
	peer.register("chat.initialize", async (params) => {
		const url = params?.url ?? resolve_chatbot_url({
			chatbot: params?.chatbot,
			model: params?.model
		});
		if (!url) throw new Error(`Unknown chatbot: ${params?.chatbot}`);
		const chatbot = CHATBOTS[params.chatbot];
		const result = server.send_initialize_chat({
			action: "initialize-chat",
			text: params?.text ?? "",
			url,
			chatbot: params?.chatbot,
			model: params?.model,
			target_browser_id: params?.target_browser_id,
			system_instructions: params?.system_instructions ?? (chatbot?.supports_system_instructions ? chatbot.default_system_instructions : void 0),
			options: params?.options,
			raw_instructions: params?.raw_instructions,
			inject_apply_response_button: params?.inject_apply_response_button ?? true
		});
		if (!result.sent) throw new Error("No browser connected. Open the Connector extension and try again.");
		return {
			sent: true,
			browser: result.browser
		};
	});
	peer.register("response.apply", async (params) => {
		const result = await apply_response({
			host,
			options: {
				response: params?.response ?? "",
				instructions: params?.instructions,
				preview: params?.preview ?? true
			}
		});
		if (result.applied.length > 0) {
			state.last_states = to_original_states(result.applied);
			state.last_strategy = result.strategy;
		}
		return {
			applied: result.applied.map((change) => ({
				file_path: change.file_path,
				workspace_name: change.workspace_name,
				kind: change.kind
			})),
			rejected: result.rejected.map((change) => ({
				file_path: change.file_path,
				workspace_name: change.workspace_name
			})),
			strategy: result.strategy,
			error: result.error
		};
	});
	peer.register("response.revert", async () => {
		if (state.last_states.length === 0) return {
			reverted: [],
			failed: [],
			error: "Nothing to undo."
		};
		const result = await revert_changes({
			host,
			states: state.last_states
		});
		if (result.failed.length === 0) {
			state.last_states = [];
			state.last_strategy = null;
		}
		return result;
	});
	peer.register("state.status", () => ({
		can_revert: state.last_states.length > 0,
		files: state.last_states.map((s) => s.file_path)
	}));
};
// src/main.ts
var log = (message) => {
	process.stderr.write(`[cwc-sidecar] ${message}\n`);
};
var parse_args = (argv) => {
	let port = DEFAULT_PORT;
	let workspace;
	const roots = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") port = Number(argv[++i]) || 55155;
		else if (arg === "--workspace") workspace = argv[++i];
		else if (arg === "--root") {
			const value = argv[++i];
			if (value) roots.push({
				name: value.split(/[\\/]/).pop() ?? value,
				path: value
			});
		}
	}
	if (workspace && roots.length === 0) roots.push({
		name: workspace.split(/[\\/]/).pop() ?? workspace,
		path: workspace
	});
	return {
		port,
		workspace,
		roots
	};
};
var main = async () => {
	const args = parse_args(process.argv.slice(2));
	const logger = (message) => log(message);
	const peer = new JsonRpcPeer((line) => {
		process.stdout.write(line + "\n");
	});
	const host = args.roots.length > 0 ? new FsHost(args.roots, logger) : new RpcHost(peer);
	const state = {
		last_states: [],
		last_strategy: null
	};
	const server = new ConnectorServer({
		port: args.port,
		on_apply_response: (message) => {
			peer.notify("chat.applyResponse", message);
		},
		on_browsers_changed: (browsers) => {
			peer.notify("browsers.changed", { browsers });
		}
	});
	register_methods({
		peer,
		host,
		server,
		state
	});
	try {
		const port = await server.start(args.port);
		log(`Connector WebSocket server listening on 127.0.0.1:${port}`);
		peer.notify("sidecar.ready", { port });
	} catch (error) {
		const message = error.message;
		if (error.code === "EADDRINUSE") log(`Port ${args.port} is already in use. Another Code Web Chat server (for example the VS Code extension) is probably running. Stop it and retry.`);
		else log(`Failed to start the WebSocket server: ${message}`);
		process.exit(1);
	}
	const rl = readline.createInterface({ input: process.stdin });
	rl.on("line", (line) => peer.handle_line(line));
	const shutdown = async () => {
		log("Shutting down");
		await server.stop();
		process.exit(0);
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
	rl.on("close", shutdown);
	process.on("uncaughtException", (error) => {
		log(`Uncaught exception: ${error.message}`);
	});
	process.on("unhandledRejection", (reason) => {
		log(`Unhandled rejection: ${String(reason)}`);
	});
	if (!fs.existsSync(args.roots[0]?.path ?? "")) {
		if (args.roots.length > 0) log(`Workspace root does not exist: ${args.roots[0].path}`);
	}
};
main();
