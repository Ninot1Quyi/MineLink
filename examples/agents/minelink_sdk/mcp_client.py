import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from typing import Any, Dict, Optional


JsonDict = Dict[str, Any]


class MineLinkMcpClient:
    def __init__(self, host_command: Optional[str] = None, cwd: Optional[Path] = None) -> None:
        self.repo_root = cwd or Path(__file__).resolve().parents[3]
        self.transport = os.environ.get("MINELINK_MCP_TRANSPORT", "stdio").lower()
        self.host_command = host_command or os.environ.get(
            "MINELINK_HOST_COMMAND", "node packages/host/dist/index.js mcp"
        )
        self.http_url = os.environ.get("MINELINK_MCP_URL") or os.environ.get("MINELINK_MCP_HTTP_URL", "")
        self.gateway_token = os.environ.get("MINELINK_GATEWAY_TOKEN", "")
        self.session_id: Optional[str] = None
        self.proc: Optional[subprocess.Popen[str]] = None
        self.next_id = 1

    def __enter__(self) -> "MineLinkMcpClient":
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()

    def start(self) -> None:
        if self.uses_http():
            if not self.http_url:
                raise RuntimeError("MINELINK_MCP_URL is required when MINELINK_MCP_TRANSPORT=http")
            init = self.request(
                "initialize",
                {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "minelink-python-example", "version": "0.1.0"},
                },
            )
            server_info = (init.get("result") or {}).get("serverInfo", {})
            if server_info.get("name") != "minelink-host" or not self.session_id:
                raise RuntimeError(f"MCP HTTP initialize failed: {init}")
            self.notify("notifications/initialized", {})
            return

        if self.proc is not None:
            return
        self.proc = subprocess.Popen(
            shlex.split(self.host_command),
            cwd=self.repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        init = self.request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "minelink-python-example", "version": "0.1.0"},
            },
        )
        if "result" not in init:
            raise RuntimeError(f"MCP initialize failed: {init}")
        self.notify("notifications/initialized", {})

    def close(self) -> None:
        if self.uses_http():
            if self.session_id:
                try:
                    self.http_request(None, method="DELETE")
                except Exception:
                    pass
                finally:
                    self.session_id = None
            return

        if self.proc is None:
            return
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
            self.proc.terminate()
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        finally:
            self.proc = None

    def connect_server(
        self,
        endpoint: str = "ws://127.0.0.1:25575",
        server_address: str = "dev.local",
        owner_name: str = "codex_workspace_01",
    ) -> JsonDict:
        return self.call_tool(
            "minelink.connect_server",
            {"endpoint": endpoint, "serverAddress": server_address, "ownerName": owner_name},
        )

    def birth(self, seed_prompt: str = "A cautious but curious newcomer.") -> JsonDict:
        return self.call_tool("minelink.birth", {"seedPrompt": seed_prompt, "bodyType": "server_agent"})

    def tool_execute(self, name: str, arguments: Optional[JsonDict] = None, mode: str = "await_completion") -> JsonDict:
        return self.call_tool(
            "minelink.tool_execute", {"name": name, "mode": mode, "arguments": arguments or {}}
        )

    def tool_list(self, arguments: Optional[JsonDict] = None) -> JsonDict:
        return self.call_tool("minelink.tool_list", arguments or {})

    def tool_query(self, name: str) -> JsonDict:
        return self.call_tool("minelink.tool_query", {"name": name})

    def call_tool(self, name: str, arguments: JsonDict) -> JsonDict:
        response = self.request("tools/call", {"name": name, "arguments": arguments})
        if "error" in response:
            raise RuntimeError(response["error"])
        result = response.get("result", {})
        content = result.get("content", [])
        if not content:
            return result
        text = content[0].get("text", "{}")
        parsed = json.loads(text)
        return unwrap_tool_result(parsed)

    def request(self, method: str, params: JsonDict) -> JsonDict:
        request_id = self.next_id
        self.next_id += 1
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        if self.uses_http():
            return self.http_request(payload)
        self.write(payload)
        while True:
            response = self.read()
            if response.get("id") == request_id:
                return response

    def notify(self, method: str, params: JsonDict) -> None:
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        if self.uses_http():
            self.http_request(payload)
            return
        self.write(payload)

    def uses_http(self) -> bool:
        return self.transport in {"http", "streamable-http", "gateway"}

    def http_request(self, payload: Optional[JsonDict], method: str = "POST") -> JsonDict:
        headers = {"accept": "application/json, text/event-stream"}
        data = None
        if payload is not None:
            headers["content-type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        if self.session_id:
            headers["mcp-session-id"] = self.session_id
            headers["mcp-protocol-version"] = "2025-11-25"
        if self.gateway_token:
            headers["authorization"] = f"Bearer {self.gateway_token}"

        request = Request(self.http_url, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=30) as response:
                self.session_id = response.headers.get("mcp-session-id", self.session_id)
                body = response.read().decode("utf-8")
        except HTTPError as error:
            body = error.read().decode("utf-8")
        if not body.strip():
            return {}
        return json.loads(body)

    def write(self, payload: JsonDict) -> None:
        if self.proc is None or self.proc.stdin is None:
            raise RuntimeError("MCP host is not started")
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def read(self) -> JsonDict:
        if self.proc is None or self.proc.stdout is None:
            raise RuntimeError("MCP host is not started")
        line = self.proc.stdout.readline()
        if line:
            return json.loads(line)
        stderr = ""
        if self.proc.stderr is not None:
            try:
                stderr = self.proc.stderr.read()
            except Exception:
                stderr = ""
        raise RuntimeError(f"MCP host exited unexpectedly. stderr={stderr}")


def unwrap_tool_result(payload: JsonDict) -> JsonDict:
    if payload.get("ok") is True and isinstance(payload.get("result"), dict):
        nested = payload["result"]
        if nested.get("ok") is True and isinstance(nested.get("result"), dict):
            return nested["result"]
        return nested
    return payload


def write_json(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def log(message: str, **fields: Any) -> None:
    sys.stdout.write(json.dumps({"message": message, **fields}, ensure_ascii=False) + "\n")
    sys.stdout.flush()
