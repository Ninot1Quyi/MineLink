# MineLink Mod 与 MCP Server 拆分设计

更新时间：2026-06-21
目标：拆清楚 MineLink 里 Minecraft Mod、MCP Server、Host/Gateway、远程服务器、本地 LAN 之间的边界，以及第一版应该怎么做。

## 1. 一句话结论

MineLink 应该是一个两段式系统：

```text
MineLink = MineLink Mod + MineLink Host
```

其中：

- `MineLink Mod` 跑在 Minecraft JVM 里，是游戏内 runtime；主要安装在 dedicated server 或用户本地单人世界对应的 integrated server 环境里。
- `MineLink Host` 跑在 JVM 外，是 MCP Server / Gateway。
- `MineLink Protocol` 是两者之间的内部协议。

对 Codex、Claude Code、OpenClaw、Hermes 来说，它们看到的是 MCP tools。
对 Minecraft 服务器来说，它安装的是 MineLink Mod。用户本地自己开单人世界/LAN 时，也是在本地 Minecraft 里安装这个 Mod，让 integrated server 具备 MineLink runtime。
对 MineLink 自己来说，MCP 不直接塞进 Mod，Mod 和 Host 通过稳定内部协议通信。

## 2. 名词

不要叫 `MCPE server`。`MCPE` 通常指 Minecraft Pocket Edition / Bedrock。

这里应该叫：

```text
MineLink MCP Server
MineLink MCP Gateway
MineLink Host
MineLink Mod
MineLink Server Runtime
MineLink Protocol
```

建议命名：

```text
MineLink Mod        Minecraft 里的 mod jar
MineLink Host       本地 stdio MCP server
MineLink Gateway    远程 HTTP MCP server，多租户/托管形态
MineLink Protocol   Host/Gateway 到 Mod 的内部协议
MineLink Runtime    Mod 里的 server_agent、动作、感知、社会系统
```

## 3. 总体拓扑

### 3.1 本地 Codex / Claude Code

这是第一版最重要的使用方式。

```text
Codex / Claude Code
  |
  | MCP stdio
  v
MineLink Host
  |
  | MineLink Protocol over HTTPS / WebSocket
  v
Remote Minecraft Server + MineLink Mod
  |
  v
server_agent in Minecraft world
```

特点：

- 用户本地不需要安装 Minecraft 客户端。
- 用户本地只需要运行 `MineLink Host`。
- `MineLink Host` 对 Codex 提供 MCP stdio。
- `MineLink Host` 连接远程服务器的 MineLink endpoint。
- 第一阶段服务器建议 `online-mode=false`，允许 agent 直接连接和出生。

### 3.2 远程 agent 平台

适合 OpenClaw、Hermes 或网页控制台这种不方便用 stdio 的场景。

```text
Remote Agent Platform
  |
  | MCP Streamable HTTP
  v
MineLink Gateway
  |
  | MineLink Protocol
  v
Minecraft Server + MineLink Mod
```

特点：

- `MineLink Gateway` 是 Host 的服务化形态。
- 它可以管理多个 agent session。
- 它必须做 admission、rate limit、审计和隔离。
- 这个形态比本地 Host 更容易成为公网入口，安全优先级更高。

### 3.3 本地单人世界 / LAN 世界

适合用户自己开单人世界并开放局域网。

```text
Codex / Claude Code
  |
  | MCP stdio
  v
MineLink Host
  |
  | localhost / LAN MineLink Protocol
  v
Minecraft Integrated Server + MineLink Mod
  |
  v
server_agent joins local world
```

特点：

- 用户本地 Minecraft 正在运行，并且安装了 MineLink Mod。
- MineLink Mod 在 integrated server 侧启用 runtime。
- 本地人类玩家仍然是普通玩家。
- agent 通过 integrated server 里的 `server_agent` 加入世界。
- 不默认接管 `local_player`。

## 4. 组件边界

### 4.0 Agent 推荐连接方式

MineLink 的默认 agent 连接方式应该是 `server_agent` 路线：

```text
Agent-local skill code
  -> MineLink SDK / MCP client
  -> MineLink Host 或 Gateway
  -> MineLink Protocol
  -> MineLink Mod endpoint
  -> server_agent
```

这个连接方式的设计目标是支撑 NeoForge/Create 这类模组服务器，而不是只做 vanilla bot。核心判断：

- Host/Gateway 是协议和会话层，不运行 Minecraft，也不执行用户 skill 代码。
- Mod endpoint 是服务器内 runtime，负责有限感知、动作执行、权限、admission、capability discovery。
- `server_agent` 是服务器内类玩家身体，优先通过 Minecraft/NeoForge/模组原生服务端逻辑完成交互。
- Mineflayer/client_bot 只作为 API 风格参考或未来可选 backend，不作为主协议。
- HeadlessMc/真实客户端只作为少量高保真 sensory client，不作为大规模 agent 身体。

这种方式下，模组兼容不是“天然全兼容”，而是有更好的落点：

```text
服务端物品/方块/实体/容器逻辑
  -> 通过 server_agent 和原生事件/菜单/权限复用

模组内部状态
  -> 通过 server-side adapter 暴露有限摘要

客户端 GUI / JEI / Ponder / overlay
  -> 默认不属于 server_agent 能力，必要时用知识库或少量 sensory client 辅助
```

### 4.1 MineLink Mod 做什么

MineLink Mod 是游戏内 runtime。

职责：

- 在 dedicated server / integrated server 内创建和管理 `server_agent`。
- 提供 MineLink endpoint，接收 Host/Gateway 的内部协议请求。
- 管理 `server_agent` 生命周期：出生、唤醒、睡眠、下线、恢复。
- 执行玩家合法动作：移动、看向、挖掘、放置、使用、攻击、聊天、容器交互。
- 计算有限感知：位置、状态、背包、附近实体、可见表面、raycast、聊天、公共媒介。
- 维护行动队列和动作反馈。
- 管理 A2A 和社会媒介：附近说话、公告板、账本、订单、信件、电报。
- 执行服务器 admission policy：open、token、invite、whitelist、rate limit。
- 复用服务器已有规则：封禁、白名单、权限、claim/protection。
- 持久化 agent body 状态和社会事件。
- 暴露 capability discovery，告诉 Host 当前服务器支持哪些能力。

不应该做：

- 不直接承载完整 MCP stdio/HTTP server。
- 不直接运行 Codex/LLM。
- 不运行复杂 skill sandbox。
- 不把外部 agent 会话、日志平台、HTTP 多租户网关都塞进 Minecraft JVM。
- 不提供全知世界 API。

### 4.2 MineLink Host 做什么

MineLink Host 是 JVM 外的 MCP server。

职责：

- 对本地 Codex/Claude Code 提供 MCP stdio。
- 对需要 HTTP 的平台提供 MCP Streamable HTTP，或由 Gateway 形态提供。
- 管理 MCP tools schema。
- 把 MCP tool call 转成 MineLink Protocol 请求。
- 维护 agent session：当前连接哪个服务器、哪个 agent、当前目标、最近观察。
- 提供 SDK/连接支持，让 agent 在本地运行 skill 代码并通过 Host/Gateway 操作游戏；默认不托管执行用户代码。
- 处理重连、超时、重试、server capability cache。
- 管理本地配置和 server 列表。
- 管理 admission token / invite / 后续 online auth 信息。
- 收集日志、事件和回放数据。

不应该做：

- 不直接修改 Minecraft 世界。
- 不绕过 Mod 执行动作。
- 不自己维护一份和服务器冲突的白名单/封禁/权限规则。
- 不假装知道服务器没有暴露的世界状态。

### 4.3 MineLink Gateway 做什么

Gateway 是 Host 的服务端部署形态。

职责：

- 对远程 agent 平台暴露 MCP Streamable HTTP。
- 托管多个 agent session。
- 管理团队、token、quota、审计。
- 连接一个或多个 Minecraft server 的 MineLink endpoint。

第一版可以不做 Gateway，先做本地 Host。

## 5. 协议分层

### 5.1 外层：MCP

外部 agent 只看 MCP。

```text
MCP stdio:
  本地 Codex / Claude Code

MCP Streamable HTTP:
  远程 agent 平台 / Web dashboard / 托管 Gateway
```

外层 MCP tools 应该稳定、语义清楚、面向 agent。

示例：

```text
minelink.connect_server
minelink.birth
minelink.list_agents
minelink.observe_self
minelink.observe_scene
minelink.observe_inventory
minelink.act_move
minelink.act_look_at
minelink.act_mine_visible_block
minelink.act_place_block
minelink.act_use
minelink.chat_say_local
minelink.notice_post
```

注意：agent skill 不是 Minecraft 服务器能力，也不是 MineLink Mod 的职责。Skill 是 agent 在自己本地或 Host 本地工作区沉淀的代码/经验；Codex 这类本来就能读写本地文件的 agent，应该直接用自己的文件系统保存 skill。

### 5.2 内层：MineLink Protocol

Host 到 Mod 使用内部协议，不直接用 MCP。

推荐：

```text
Encoding: JSON
Pattern: request/response + event stream
Transport:
  local: WebSocket / HTTP / Unix socket
  remote: HTTPS / WebSocket
Versioning: protocol_version + capability flags
```

为什么内层不用 MCP：

- Mod 不需要理解 MCP 的完整生态和工具模型。
- Minecraft JVM 里应该少引入外部协议依赖。
- 内部协议可以更贴近游戏 runtime，例如 action queue、tick event、body state、world events。
- 后续 MCP 版本变化时，只改 Host。

## 6. MineLink Protocol 草案

### 6.1 Handshake

```json
{
  "type": "hello",
  "protocol_version": "0.1",
  "client": {
    "kind": "minelink-host",
    "version": "0.1.0"
  }
}
```

返回：

```json
{
  "type": "hello_result",
  "server": {
    "minecraft_version": "1.21.1",
    "loader": "neoforge",
    "minelink_mod_version": "0.1.0",
    "online_mode": false
  },
  "admission": {
    "mode": "open",
    "max_agents_per_owner": 3
  },
  "capabilities": {
    "server_agent": true,
    "birth": true,
    "visible_surface_scan": true,
    "inventory": true,
    "container_basic": true,
    "complex_gui": false,
    "create_adapter": "partial"
  }
}
```

### 6.2 Connect / admission

```json
{
  "type": "connect",
  "server_address": "play.example.com",
  "owner": {
    "kind": "offline_agent",
    "name": "codex_workspace_01"
  },
  "admission_token": null
}
```

返回：

```json
{
  "type": "connect_result",
  "ok": true,
  "owner_id": "owner:offline:codex_workspace_01",
  "limits": {
    "max_agents": 3,
    "actions_per_second": 5
  }
}
```

如果服务器是 `online-mode=true`，第一阶段返回：

```json
{
  "type": "error",
  "code": "unsupported_online_auth",
  "message": "This server requires online authentication. MineLink online login is planned for a later phase."
}
```

### 6.3 Birth

```json
{
  "type": "agent.birth",
  "seed_prompt": "一个谨慎但好奇的新人",
  "body_type": "server_agent"
}
```

返回：

```json
{
  "type": "agent.birth_result",
  "agent_id": "agent:elias_reed",
  "display_name": "Elias Reed",
  "body_id": "body:elias_reed",
  "spawn": {
    "dimension": "minecraft:overworld",
    "position": [120, 64, -38]
  },
  "initial_profile": {
    "personality": {
      "curiosity": 0.72,
      "risk_tolerance": 0.28
    },
    "needs": ["food", "shelter", "tools"],
    "relationships": {}
  }
}
```

### 6.4 Observe

```json
{
  "type": "agent.observe",
  "agent_id": "agent:elias_reed",
  "include": ["self", "inventory", "visible_scene", "nearby_entities", "chat"]
}
```

返回：

```json
{
  "type": "agent.observe_result",
  "self": {
    "health": 20,
    "hunger": 18,
    "position": [120.5, 64, -38.2],
    "yaw": 90,
    "pitch": 0
  },
  "visible_scene": {
    "mode": "server_computed_visible_surfaces",
    "blocks": [],
    "entities": []
  },
  "inventory": {
    "hotbar": [],
    "main": []
  }
}
```

### 6.5 Action

```json
{
  "type": "agent.action",
  "agent_id": "agent:elias_reed",
  "action": {
    "kind": "mine_visible_block",
    "block_ref": "vis:block:123",
    "tool_policy": "best_available"
  }
}
```

返回：

```json
{
  "type": "agent.action_result",
  "action_id": "act:001",
  "status": "queued"
}
```

动作完成事件：

```json
{
  "type": "agent.action_event",
  "action_id": "act:001",
  "status": "failed",
  "reason": "target_no_longer_visible",
  "observation_hint": true
}
```

## 7. MCP Tool 到 Protocol 映射

| MCP tool | Host 行为 | Mod/Protocol 行为 |
| --- | --- | --- |
| `minelink.connect_server` | 建立到 MineLink endpoint 的连接 | `hello` + `connect` |
| `minelink.birth` | 生成 MCP 参数，记录 session | `agent.birth` |
| `minelink.observe_self` | 选择 include 字段 | `agent.observe` |
| `minelink.observe_scene` | 限制返回大小，缓存结果 | `agent.observe` |
| `minelink.act_move` | 校验参数，提交动作 | `agent.action` |
| `minelink.act_mine_visible_block` | 要求 block_ref 来自最近观察 | `agent.action` |
| `minelink.chat_say_local` | 转换成社会通信动作 | `agent.action` 或 `social.say` |
| `minelink.tool_list` | 返回压缩后的动态工具目录 | Host catalog + server capabilities |
| `minelink.tool_query` | 按工具名返回详细 schema 和使用说明 | Host catalog |
| `minelink.tool_execute` | 按工具名和参数执行动态工具 | 转成对应 protocol/action |

原则：

- MCP tool 不应该直接暴露服务器内部对象。
- 所有 `block_ref`、`entity_ref`、`face_ref` 应该来自最近 observation。
- Host 可以做参数校验，但最终合法性由 Mod 按游戏规则判断。

### 7.1 工具延迟加载

MineLink 不应该把所有 Minecraft、Create、容器、配方、社会系统工具一次性暴露给 agent。模组世界里工具数量会很快膨胀：

```text
基础动作工具
容器工具
合成工具
社交工具
Create adapter 工具
其他模组 adapter 工具
调试工具
服务器管理工具
```

如果全部直接作为 MCP tools 注册给 agent，会导致上下文膨胀、选择困难和工具 schema 维护困难。

推荐对外只暴露少量稳定核心工具：

```text
minelink.connect_server
minelink.birth
minelink.tool_list
minelink.tool_query
minelink.tool_execute
```

其中动态工具通过目录懒加载。

这里的工具延迟加载只针对“游戏能力工具”：观察、移动、挖掘、合成、容器、Create adapter、社会通信等。Skill 延迟加载是另一层东西，默认发生在 agent 自己的本地工作区；MineLink 不需要把 `skill_read`、`skill_write`、`skill_run` 作为核心 MCP tool。

第一版不提供 `runner.submit` 这类托管代码执行工具。需要长时间 skill 时，由 agent 本地脚本持续调用 SDK；Host/Gateway 只负责连接、会话、限流、日志和协议转发。

#### tool_list

用于列出当前服务器、当前 agent、当前视野和当前已安装模组下可用的工具摘要。

参数示例：

```json
{
  "namespace": "craft",
  "query": "furnace",
  "tags": ["container", "survival"],
  "cursor": null,
  "limit": 20
}
```

返回示例：

```json
{
  "tools": [
    {
      "name": "craft.list_available",
      "summary": "List recipes currently craftable from the agent inventory and nearby stations.",
      "tags": ["craft", "recipe", "inventory"]
    },
    {
      "name": "craft.quick_craft",
      "summary": "Craft an item through real server recipe/container rules.",
      "tags": ["craft", "recipe", "container"]
    },
    {
      "name": "container.observe",
      "summary": "Inspect the currently opened server container slots.",
      "tags": ["container", "slot"]
    }
  ],
  "next_cursor": null
}
```

#### tool_query

用于按工具名获取详细 schema、前置条件、失败原因和示例。agent 只有要用某个工具时才查询它。

参数示例：

```json
{
  "name": "craft.quick_craft"
}
```

返回示例：

```json
{
  "name": "craft.quick_craft",
  "description": "Craft an item by opening the required 2x2/3x3 container, filling slots from a server recipe, and taking the output.",
  "input_schema": {
    "type": "object",
    "required": ["recipe_id", "count"],
    "properties": {
      "recipe_id": { "type": "string" },
      "count": { "type": "integer", "minimum": 1 }
    }
  },
  "preconditions": [
    "required items are in inventory or reachable container",
    "required crafting station is visible and reachable",
    "recipe exists in server recipe registry"
  ],
  "failure_reasons": [
    "missing_ingredients",
    "station_not_visible",
    "station_too_far",
    "inventory_full",
    "recipe_not_available"
  ]
}
```

#### tool_execute

用于执行已经查询过的动态工具。

参数示例：

```json
{
  "name": "craft.quick_craft",
  "arguments": {
    "recipe_id": "minecraft:wooden_pickaxe",
    "count": 1
  }
}
```

返回示例：

```json
{
  "ok": true,
  "result": {
    "crafted": "minecraft:wooden_pickaxe",
    "count": 1,
    "consumed": [
      { "item": "minecraft:oak_planks", "count": 3 },
      { "item": "minecraft:stick", "count": 2 }
    ]
  }
}
```

#### 动态工具目录来源

Host 的工具目录由几类来源合并：

```text
Core tools
  connect、birth、observe、basic action

Server capability discovery
  当前 Mod 支持哪些能力

Body capability discovery
  当前 agent body 能做什么

Mod adapters
  create.*、container.*、craft.*、social.*

Runtime context
  当前是否打开容器
  当前是否看到 Create 方块
  当前是否在工作台旁
  当前服务器是否安装某个模组
```

关键原则：

- 不把每个 recipe、每个 item、每个 block 都注册成一个 MCP tool。
- 大量数据用 `list/query` 查，具体动作用少数通用工具执行。
- `tool_list` 返回摘要，`tool_query` 才返回完整 schema。
- `tool_execute` 必须再次校验参数和服务器状态，不能只相信 query 时的结果。
- 动态工具也必须遵守有限感知和真实服务器规则。

### 7.2 本地 Skill 代码和服务器动作链路

Agent 写出的 skill 默认运行在 agent 本地：

```text
Agent-local Runner
  - Codex / Claude Code 在自己的本地工作区写代码、运行代码
  - 代码 import MineLink SDK
  - SDK 连接本地 Host 或远程 Gateway
```

skill 不直接修改 Minecraft 世界，也不在 Minecraft Mod/JVM 或 MineLink 后端里运行。它作用到服务器的方式是调用 MineLink SDK/MCP tools，由 Host/Gateway 转成 MineLink Protocol 请求，再由 Mod 在服务器侧执行真实动作。

```text
本地 Codex / Claude Code / OpenClaw
  |
  | 运行本地 skill 代码
  | 例如 skills/survival/mine_tree.py
  v
MCP tool call
  |
  | minelink.tool_execute("action.mine_visible_block", ...)
  v
MineLink Host / Gateway
  |
  | session、参数、capability、限流、日志
  v
MineLink Protocol
  |
  | agent.action / agent.observe / social.say / container.op
  v
MineLink Mod
  |
  | 服务端权威校验
  v
Minecraft server_agent
```

关键边界：

- skill 是“控制程序”，不是 Minecraft 服务器插件。
- 服务器只接收 MineLink 定义过的 observation/action/container/craft/social 请求。
- Mod 必须在服务器侧重新校验可见性、距离、权限、冷却、背包、容器状态和配方。
- Host 可以先做 schema 校验和日志，但不能替代服务器权威校验。
- 服务器返回动作结果和失败原因，本地 skill 根据反馈修改策略。

例子：

```text
skills/movement/pathfind.py
  -> tool_execute("observe.scene")
  -> 本地计算下一步
  -> tool_execute("action.move")
  -> 根据 collision / moved_distance / new_observation 继续修正

skills/survival/mine_tree.py
  -> tool_execute("observe.scene")
  -> 选择最近可见原木 block_ref
  -> tool_execute("action.look_at")
  -> tool_execute("action.mine_visible_block")
  -> 根据 target_too_far / target_not_visible / wrong_tool 继续修正
```

这也是为什么 MineLink 不需要把 `skill_read`、`skill_write`、`skill_run` 混进 Minecraft 游戏能力里。Codex 这类 coding agent 可以自己写本地文件、自己运行本地代码。Minecraft Mod 只需要提供稳定、有限、可审计的游戏工具。

### 7.3 Agent SDK、Capability 和 Ref

MineLink 不应该把 agent 限制成“只能手动组合几个 MCP tool”。更好的做法是：MCP 只暴露少量稳定入口，MineLink 提供一个本地 Agent SDK，让 coding agent 用普通代码写 skill。

SDK 内部有两类能力：

```text
Local helper
  - 只处理本地已有数据
  - 例如局部地图、A*、目标选择、物品规划、失败重试
  - 不需要服务器授权
  - 不产生世界副作用

Server capability
  - 读取新感知或影响世界
  - 例如 observe.scene、body.move、body.mine、container.click、craft.quick_craft
  - 必须经过 Host -> Mod -> server_agent
  - 必须由 Mod 在服务器侧重新校验
```

SDK 形态示例：

```python
view = await mc.observe.scene(radius=16)
target = choose_nearest_log(view.visible_blocks)

path = local_pathfind(view.local_map, target.pos_hint)

for step in path:
    moved = await mc.body.move(step.vector, duration=200)
    if moved.collision:
        view = await mc.observe.scene(radius=16)
        path = local_pathfind(view.local_map, target.pos_hint)

await mc.body.look_at(target.ref)
await mc.body.mine(target.ref)
```

这里 `choose_nearest_log` 和 `local_pathfind` 可以是 agent 自己写的任意本地代码；`observe.scene`、`body.move`、`body.mine` 才是服务器 capability。

为了限制感知和权限，Mod 返回的 observation 应该使用 ref/lease 机制：

```json
{
  "agent_id": "agent_7",
  "observation_id": "obs_123",
  "issued_at": 1710000000,
  "expires_at": 1710000005,
  "visible_blocks": [
    {
      "block_ref": "blk_obs_123_48",
      "pos_hint": [12, 64, -8],
      "id": "minecraft:oak_log",
      "tags": ["minecraft:logs"],
      "visible_faces": ["north", "up"],
      "distance": 5.2
    }
  ]
}
```

动作请求不应该只靠裸坐标，优先使用最近 observation 里的 `block_ref`、`entity_ref`、`slot_ref`、`face_ref`：

```json
{
  "type": "body.mine",
  "agent_id": "agent_7",
  "block_ref": "blk_obs_123_48",
  "expected_observation": "obs_123"
}
```

服务器侧必须重新校验：

- ref 是否属于这个 agent。
- ref 是否来自最近观察，是否过期。
- 方块/实体/槽位现在是否仍然存在。
- 目标是否仍在有限感知和可交互范围内。
- 角色是否有正确工具、姿态、冷却和权限。
- 该动作是否符合当前服务器和模组规则。

这样可以同时满足两件事：

- agent 可以写真正的代码，不只是机械排列工具调用。
- 代码能看到和操作的东西仍然被 MineLink 的感知层和服务器权威规则限制住。

### 7.4 Action Lifecycle 和背压

MineLink 不能把本地代码发来的请求当成无限 fire-and-forget 流。每个会影响世界的请求都必须进入 action lifecycle，并且对每个 agent 做队列、限流和取消。

推荐协议状态：

```text
submitted
  -> accepted
  -> queued
  -> running
  -> completed
  -> failed
  -> cancelled
  -> expired
```

`tool_execute` 可以有两种返回模式：

```json
{
  "mode": "await_completion",
  "name": "body.mine",
  "arguments": {
    "block_ref": "blk_obs_123_48"
  }
}
```

返回：

```json
{
  "ok": true,
  "status": "completed",
  "result": {
    "changed_block": true,
    "drops_spawned": 1
  }
}
```

或者：

```json
{
  "mode": "submit",
  "name": "navigation.navigate_to",
  "arguments": {
    "target_ref": "blk_obs_123_48"
  }
}
```

返回：

```json
{
  "ok": true,
  "status": "accepted",
  "action_id": "act_789",
  "event_stream": "actions/act_789/events"
}
```

本地 SDK 应该把这些协议细节包装成：

```python
result = await mc.body.mine(block_ref)

nav = mc.navigation.navigate_to(target, wait=False)
async for event in nav.events():
    ...
await nav.done()
```

等待策略：

```text
observe.*              总是 await 结果
short action           默认 await completed/failed
duration action        await 到 duration 结束或失败
long helper/action     返回 action_id / ActionHandle
event stream           长连接订阅，不阻塞其他逻辑
```

背压规则：

- 每个 agent 有独立 action queue。
- 同一 body 的 motor action 不能无限并发；move/mine/use/container click 需要按通道互斥或排队。
- observe 可以高频但要限流、限大小、限视距。
- chat/social 可以和移动并发，但也要限频。
- 当队列满时返回 `backpressure_queue_full`。
- 当动作依赖的 ref 过期时返回 `expired_ref`，要求重新 observe。

这样本地代码可以连续运行，但每一步世界 I/O 都有反馈和节奏，不会把服务器打爆。

### 7.5 服务端权限限制和 Guard Pipeline

本地 SDK、Deno/WASI sandbox、MCP schema 都不能作为 Minecraft 世界权限的最终边界。最终边界必须在 Mod 所在的服务器逻辑里，因为只有服务器知道真实世界状态、模组规则、权限事件和当前身体状态。

可以复用已有规则的地方应该复用：

```text
Minecraft / NeoForge / 模组原生逻辑
  - survival/adventure/creative game mode
  - block break speed、工具、掉落物、耐久
  - recipe registry、crafting menu、container slot
  - item use、block use、entity interaction
  - cooldown、health、food、movement、collision
  - protection / permission / event hook
```

MineLink 不应该自己生成物品、自己扣材料或自己决定掉落物。正确方式是：通过类玩家身体进入原生交互路径，让服务器和模组自己判断是否允许。

但原生服务器逻辑不一定会替我们检查“agent 是否真的看见了”。如果我们直接从 Mod 代码里调用底层方法，可能绕过客户端 packet 路径里的隐含约束。所以 MineLink 必须在调用原生交互前加一层 guard：

```text
Action request
  |
  v
1. schema 校验
  - 参数类型、必填字段、tool 版本

2. session / admission 校验
  - agent 是否存在
  - 是否被暂停/封禁/限流
  - 是否允许该 capability

3. ref / lease 校验
  - block_ref/entity_ref/slot_ref 是否属于该 agent
  - 是否来自最近 observation
  - 是否过期

4. perception 校验
  - 当前是否仍然可见
  - raycast 是否无遮挡
  - 是否在当前朝向对应的视野内
  - 是否需要先 turn/look

5. body 校验
  - 距离是否在 block/entity interaction range 内
  - 当前是否能行动
  - 是否在跳跃、游泳、死亡、睡觉、打开容器等冲突状态
  - 手里物品、姿态、冷却是否满足

6. 原生交互调用
  - block break / use item / container click / craft / entity interact
  - 触发正常事件、权限、模组逻辑

7. 结果和反馈
  - ok
  - failure reason
  - consumed / changed inventory
  - new observation hint
```

典型限制：

```text
挖 64 格外的方块
  - ref 可能不存在，或 distance > interaction_range
  - 返回 target_too_far

挖背后的方块
  - ref 可能来自旧 observation
  - 当前朝向视野内不可见
  - 返回 target_not_visible_from_current_view 或 must_turn_first

隔墙挖矿
  - 目标不会出现在 visible surface observation
  - 裸坐标请求不被接受，或 ref 校验失败
  - 返回 unknown_or_unobserved_target

远程捡物品
  - 不暴露 teleport/pull item capability
  - collect helper 只能移动到 item 附近
  - 真正 pickup 由服务器原生碰撞/拾取逻辑发生
```

这个 guard pipeline 是 MineLink 的核心安全边界。它比 prompt 约束可靠，也比只靠本地 SDK 可靠。

Minecraft Mod/JVM 不应该执行 agent 上传的任意代码。Minecraft server 侧只接受结构化请求，例如 `agent.observe`、`body.move`、`body.mine`、`container.click`、`craft.quick_craft`。这样可以避免 agent 代码里的无限循环、内存泄漏、依赖冲突、阻塞 IO 或恶意逻辑破坏 Minecraft JVM 稳定性。第一版也不需要 Host/Gateway 执行代码；agent 在本地运行 skill，MineLink 后端只返回观察、执行动作和失败原因。远期如果要做托管 Runner，应作为独立产品能力隔离实现。

### 7.6 Mineflayer 对 MineLink 的参考价值

Mineflayer 的核心结构是：

```text
mineflayer.createBot(...)
  -> node-minecraft-protocol client
  -> 登录 Minecraft server
  -> 解析服务器 packet，维护 bot.world/entity/inventory
  -> 发送移动、聊天、挖掘、容器等 packet
```

这说明“本地代码控制游戏角色”这件事是成立的。Mineflayer 的 API、事件和插件模型值得借鉴：

```text
bot-like object
  mc.self / mc.inventory / mc.chat / mc.body / mc.world_view

event emitter / async iterator
  spawn、chat、action_completed、blocked、inventory_changed

plugin style
  navigation、craft、container、create_adapter、social

pathfinder style
  Goal、Movements、cost model、replan on feedback
```

但 MineLink 不应该直接把 `node-minecraft-protocol` 当成 Host 到 Mod 的协议：

- 它是 Minecraft client/server wire protocol，不是 agent capability protocol。
- 用它就等于让 agent 作为客户端 bot 登录服务器，绕开了 `server_agent` 的服务器内部身体路线。
- 客户端协议会给程序完整 chunk 数据，容易暴露被墙和地形遮挡的方块，不符合 MineLink 的有限视觉目标。
- Forge/NeoForge 模组兼容需要服务器内部事件、FakePlayer/ServerPlayer、capability、container/menu、权限和 adapter；client protocol 很难稳定覆盖。

因此推荐做法是：

```text
借鉴 Mineflayer 的 SDK 形态
不复用 Mineflayer 的 wire protocol 作为 MineLink 主协议
可选研究 Mineflayer/pathfinder 的实现，重写成基于 MineLink observation/ref/action 的 helper
```

如果未来需要另一个 body 类型，可以单独做 `client_bot` backend：

```text
server_agent backend
  默认路线：MineLink Mod + server_agent

client_bot backend
  可选路线：Mineflayer/node-minecraft-protocol
  适合 vanilla/少量插件服务器
  不作为 Create/NeoForge 模组社会的主路线
```

## 8. Mod 内部模块

建议 Mod 拆成这些包：

```text
minelink-common
  protocol DTO
  capability model
  config schema
  shared constants

minelink-neoforge
  server/
    MineLinkEndpoint
    AgentBodyManager
    FakePlayerBody
    ActionScheduler
    PerceptionService
    InventoryService
    SocialService
    AdmissionService
    PersistenceService
    AuditLog

  client/
    optional client companion
    local LAN UI
    future sensory client hooks
```

第一版可以只做 server 侧。

### 8.1 MineLinkEndpoint

职责：

- 监听 Host/Gateway 连接。
- 处理 `hello`、`connect`、`agent.birth`、`agent.observe`、`agent.action`。
- 做协议版本校验。
- 调用 AdmissionService。
- 把请求分发给 body/action/perception/social 模块。

### 8.2 AgentBodyManager

职责：

- 创建 `server_agent`。
- 管理 body id、agent id、owner id。
- 加载/保存身体状态。
- 处理死亡、睡眠、下线、重生。
- 暴露 body capabilities。

### 8.3 ActionScheduler

职责：

- 动作排队。
- 按 tick 执行动作。
- 支持取消、超时、失败原因。
- 把高层动作拆成合法玩家动作。
- 维护 action lifecycle：accepted、queued、running、completed、failed、cancelled、expired。
- 管理每个 agent 的背压、限流和队列长度。
- 管理动作通道互斥：移动、挖掘、使用、容器点击等不能无限并发。
- 发布 action event stream，供本地 SDK await、poll 或订阅。

### 8.4 PerceptionService

职责：

- 计算有限感知。
- 使用 BlockState、VoxelShape、raycast、透明/可穿透 tag。
- 限制视距和返回大小。
- 给每个可见对象生成短期 `ref_id`。

### 8.5 SocialService

职责：

- 附近说话。
- shout。
- 公告板。
- 订单。
- 信件。
- 电报。
- A2A 事件和审计。

## 9. Host 内部模块

建议 Host 拆成这些模块：

```text
minelink-host
  mcp/
    StdioServer
    HttpServer
    ToolRegistry

  protocol/
    MineLinkClient
    ReconnectPolicy
    CapabilityCache

  session/
    ServerSession
    AgentSession
    ConfigStore

  logs/
    EventStore
    ReplayWriter
    AuditViewer

  dev/
    DevServerLauncher
    E2EHarness
    LogCollector
    FixtureWorlds
```

第一版 Host 只需要：

- MCP stdio。
- `connect_server`。
- `birth`。
- observe/action/chat 几个 tools。
- 本地 JSON 配置。
- 简单日志。
- dev harness：build、start-server、start-host、run-agent、collect-logs、e2e。

HTTP Gateway 可以后做。

### 9.1 自举开发验证模块

MineLink 仓库应该允许 Codex 这类 coding agent 自己完成本地开发验证。最小 dev harness：

```text
scripts/dev/build.sh
  编译 Mod、Host、SDK

scripts/dev/start-server.sh
  启动 NeoForge dev dedicated server，加载 MineLink Mod

scripts/dev/start-host.sh
  启动 MineLink Host，连接 dev server endpoint

scripts/dev/run-agent.sh mine_tree
  运行 examples/agents/mine_tree.py

scripts/dev/e2e.sh mine_tree
  一键执行 build -> server -> host -> agent -> assertion -> collect logs

scripts/dev/hotswap.sh <class>
  对已启动的 dev server 做方法体级热更新

scripts/dev/e2e.sh create_smoke
  启动带 Create 的 dev server，跑 Create 适配 smoke test

scripts/dev/stop-all.sh
  清理 server、host、agent 进程
```

日志和证据目录：

```text
.minelink-dev/
  logs/
    server.log
    host.log
    agent.log
  replays/
    latest-action-trace.jsonl
  reports/
    mine_tree-result.json
    create_smoke-result.json
    hotswap-report.json
```

热更新分层：

```text
Host / SDK
  -> 用语言原生 watch/dev 模式
  -> 修改后直接重跑 agent script 或 Host 单测

Mod Java 快速迭代逻辑
  -> compileJava
  -> HotswapAgent + JBR/DCEVM enhanced class redefinition
  -> 由 IDE Reload Changed Classes 或 autoHotswap=true 触发
  -> 适合 perception、action scheduler、错误处理、日志、adapter 逻辑

资源 / recipe / tag / datapack
  -> 优先 /reload 或数据包重载
  -> 如果 loader/runtime 不支持稳定重载，则重启 dev server

注册表 / event subscription / Mixin / 被 Minecraft/NeoForge/Mixin/协议依赖的字段或方法结构变化 / 协议 schema / Create 依赖变化
  -> 重启 dev server
```

HotswapAgent 使用边界：

- 只在本地 dev server 上使用，不作为生产热修复机制。
- dev server 使用支持 enhanced class redefinition 的 JBR/DCEVM，并启用 HotswapAgent。
- 面向 Minecraft 1.21.1 / NeoForge 1.21.1 时，dev profile 优先使用 Java 21 对应的 JBR，并设置 `-XX:+AllowEnhancedClassRedefinition -XX:HotswapAgent=fatjar`。
- 第一版 `scripts/dev/hotswap.sh` 默认 engine 是 `hotswap_agent`；Arthas `retransform/redefine` 只是 fallback/debug 工具。
- HotswapAgent 可以覆盖比普通 Java HotSwap 更多的 class 变化，但 MineLink 对 registry、Mixin、network schema、Create 依赖和启动期初始化仍按“需要重启”处理。
- `scripts/dev/hotswap.sh` 需要记录 engine、class 名、class hash、时间、命令输出和是否成功。
- 热更新通过后只能说明当前 JVM 快速验证通过；合并前仍要跑一次 clean restart e2e。

Create dev profile：

```text
fixtures/worlds/create_smoke
  depot
  belt
  mechanical_press
  shaft
  cogwheel
  wrench
  material_chest

scripts/dev/e2e.sh create_smoke
  build
  start NeoForge dev server with Create
  load create_smoke fixture
  start Host
  birth server_agent
  observe visible Create components
  execute create.inspect_component
  use wrench or item on one reachable component
  assert structured observation and structured failure reason
  collect logs/replay/report
```

开发验证原则：

- 默认只启动本地 dev world，不连接公网服务器。
- 如果需要接受 Minecraft EULA，必须由用户确认一次。
- 如果需要正版账号或 online-mode 验证，必须通过安全配置注入，不要求明文密码。
- e2e 失败时，必须输出结构化 failure reason 和可回放 action trace。
- Codex 修改代码后，应优先跑最小 e2e，而不是只跑编译。
- 热更新是缩短调试循环，不是最终验收；结构性改动和 Create 依赖变化必须重启。

## 10. 部署方式

### 10.0 安装体验目标

工程上 MineLink 是 `Mod + Host` 两个进程，但用户体验上应该尽量像安装普通 mod。

目标体验：

```text
服务器管理员：
  把 MineLink Mod jar 放进 mods/
  启动服务器
  MineLink endpoint 自动可用

普通 agent 用户：
  安装 MineLink Host 或由 Mod/Installer 自动准备
  Codex/Claude Code 里出现 MineLink MCP
  输入服务器地址即可连接

本地开世界的用户：
  把 MineLink Mod jar 放进本地 Minecraft mods/
  开单人世界或 LAN
  MineLink integrated server runtime 自动可用
```

可以提供三种安装形态。

#### 方案 A: 开发期手动安装

```text
服务器：
  手动放 MineLink Mod 到 mods/

agent 用户本地：
  手动安装 minelink-host
  手动配置 Codex/Claude Code MCP

本地开世界用户：
  手动放 MineLink Mod 到本地游戏 mods/
```

优点：

- 最简单。
- 适合 MVP。
- 调试清楚。

缺点：

- 用户体验不够好。

#### 方案 B: Installer 一键安装

```text
MineLink Installer
  -> 安装/更新 MineLink Host
  -> 生成 Codex/Claude Code MCP 配置
  -> 可选安装 MineLink Mod 到指定 Minecraft profile/server
```

优点：

- 最稳。
- 跨平台行为可控。
- 能处理权限、路径、更新、卸载。

缺点：

- 需要额外 installer。

#### 方案 C: Mod 自举 Host

本地开世界用户只把 MineLink Mod 当普通 mod 放进 `mods/`。Minecraft 启动后：

```text
MineLink Mod 启动
  -> 检查本机是否已有 MineLink Host
  -> 如果没有，解包 bundled Host 到 .minecraft/minelink/host/
  -> 启动 Host 进程
  -> 写入或提示写入 MCP 配置
  -> Host 连接当前本地/服务器 MineLink endpoint
```

优点：

- 本地开世界用户感觉像只装了一个普通 mod。
- 对单机/LAN 用户最顺。

风险：

- Mod 从游戏 JVM 拉起外部进程，安全上必须显式提示。
- Windows/macOS/Linux 进程管理不同。
- macOS Gatekeeper、Windows Defender、Linux 权限都可能影响 bundled binary。
- 服务器环境不一定允许 mod 启动外部进程。
- 自动写 Codex/Claude 配置要谨慎，最好先提示用户确认。
- Host 更新和 Mod 更新节奏不同，不能把 Host 完全绑死在 jar 里。

推荐策略：

```text
MVP:
  方案 A

早期公测:
  方案 B

成熟版:
  方案 B + 可选方案 C
```

也就是说，正式产品可以做到“服务器管理员或本地开世界用户像普通 mod 一样安装”。普通远程 agent 用户不需要安装 Minecraft，也不需要安装这个 Mod；他们只需要 MineLink Host/Gateway。

### 10.1 服务器管理员

服务器侧：

```text
1. 安装 NeoForge server。
2. 把 MineLink Mod 放到 mods/。
3. 配置 MineLink endpoint。
4. 设置 admission policy。
5. 启动服务器。
```

示例配置：

```toml
[endpoint]
enabled = true
bind = "0.0.0.0"
port = 25575
tls = false

[admission]
mode = "open"
max_agents_per_owner = 3
max_total_agents = 50
actions_per_second = 5

[auth]
online_mode_policy = "unsupported_phase_1"

[debug]
allow_oracle = false
```

### 10.2 普通 agent 用户

本地：

```text
1. 安装 MineLink Host。
2. 在 Codex / Claude Code 配置 MCP stdio。
3. 连接服务器地址。
4. /birth 创建 agent。
```

用户不需要：

- Minecraft 客户端。
- NeoForge 客户端。
- MineLink Mod。
- HeadlessMc。
- 游戏窗口。

### 10.3 本地开世界用户

本地 Minecraft：

```text
1. 安装 NeoForge client/profile。
2. 把 MineLink Mod 放到本地游戏 mods/。
3. 启动 Minecraft。
4. 打开单人世界或 Open to LAN。
5. MineLink Mod 在 integrated server 侧启用 endpoint。
6. 本机或局域网 MineLink Host 连接该 endpoint，创建 server_agent。
```

这个用户需要 Minecraft 客户端，因为他就是在本地开世界的人。
但连接这个 LAN 世界的外部 agent 仍然不需要自己的 Minecraft 客户端。

### 10.4 远程平台

平台侧：

```text
1. 部署 MineLink Gateway。
2. Gateway 连接一个或多个 MineLink server endpoint。
3. 对外暴露 MCP Streamable HTTP。
4. 远程 agent 通过 HTTP MCP 使用 tools。
```

## 11. 第一版实现范围

第一版建议只做：

```text
Loader:
  NeoForge server mod

Server:
  online-mode=false
  open admission + rate limit
  server_agent body

Host:
  local MCP stdio

Protocol:
  WebSocket JSON

Tools:
  connect_server
  birth
  tool_list
  tool_query
  tool_execute

Dynamic tool catalog first batch:
  observe.self
  observe.scene
  observe.inventory
  action.move
  action.look_at
  action.mine_visible_block
  action.use
  chat.say_local
  container.open
  container.observe
  container.move_stack
  container.take_output
  craft.list_available
  craft.quick_craft

Agent-local skill runtime:
  不作为第一版核心 MineLink tool
  Codex/Claude Code 在自己的本地工作区运行 skill
  MineLink 提供 SDK、日志和连接能力，不托管执行代码

Dev harness:
  scripts/dev/e2e.sh mine_tree
  examples/agents/mine_tree.py
  action trace + server/host/agent logs

Install:
  手动安装 Mod
  手动运行 Host
  手动配置 MCP
```

不要第一版做：

- HTTP Gateway。
- Mod 自动拉起 Host。
- 一键 Installer。
- online-mode 正版自登录。
- HeadlessMc sensory client。
- Create 深度 adapter。
- 大规模 100 agent。
- 完整 GUI。
- 全局地图和全局寻路。

## 12. server_agent 无客户端能力边界

如果 agent 用户本地不安装 Minecraft，直接通过 MineLink Host 连接服务器，它的身体就是 `server_agent`。这条路线可以让 agent 进入世界、移动、采集、放置、聊天、交易和协作，但它不是完整客户端玩家。

### 12.1 能天然做到什么

只要 MineLink Mod 在服务器里实现对应动作，`server_agent` 可以比较自然地做到：

```text
移动
  走路、转向、跳跃、潜行、冲刺、基础避障

基础交互
  attack
  use item
  break block
  place block
  interact block
  interact entity

状态
  血量、饥饿、氧气、经验、状态效果、装备

物品
  背包、快捷栏、装备栏、捡掉落物、丢物品

容器
  箱子、熔炉、工作台等服务端容器

聊天和社会
  附近说话、公告板、订单、信件、A2A

服务端模组逻辑
  只要模组逻辑主要在服务器端，并且通过标准玩家事件、物品使用、方块交互、容器菜单完成，server_agent 就有机会兼容
```

### 12.2 不能天然做到什么

`server_agent` 没有真实客户端，所以不能天然做到：

```text
真实屏幕感知
  截图、像素画面、粒子、动画、shader、资源包视觉

客户端 GUI
  JEI/EMI
  Create Ponder
  任务书复杂页面
  小地图
  客户端配置界面
  纯客户端 overlays

客户端按键逻辑
  某些 mod 的客户端快捷键
  径向菜单
  客户端侧模式切换

客户端网络状态
  需要真实 screen/menu 同步的复杂流程
  需要客户端确认或客户端脚本参与的交互

真实玩家连接语义
  tab 列表、皮肤、统计、进度、反作弊、正版 session 等可能不同
```

这里的“客户端 GUI”要区分两类。

第一类是服务端容器 GUI：

```text
箱子
熔炉
工作台
铁砧
酿造台
漏斗
大多数有 menu/container 的机器
```

这类不一定需要真实客户端画面。`server_agent` 可以通过服务端容器状态和 slot 操作来完成：

```text
open container
inspect slots
move item stack
click slot / shift click
wait for progress
take output
close container
```

第二类是纯客户端/复杂客户端 GUI：

```text
JEI/EMI 搜索面板
Create Ponder
小地图
客户端 overlay
某些只在客户端处理的配置页面
```

这类没有稳定服务端容器语义，`server_agent` 不能天然使用，需要 adapter、Host 知识库、HeadlessMc sensory client 或真实客户端。

### 12.3 模组兼容分层

对模组能力要按层判断。

| 类型 | server_agent 支持度 | 需要 MineLink 做什么 |
| --- | --- | --- |
| 纯服务端方块/物品逻辑 | 高 | 标准 use/break/place/interact |
| 标准容器菜单 | 中高 | container adapter、slot click、recipe/craft 支持 |
| 依赖 Forge/NeoForge player event 的逻辑 | 中高 | 正确使用 FakePlayer/ServerPlayer、事件、权限 |
| 依赖 capability/attachment 的逻辑 | 中 | 补 owner/profile/capability 上下文 |
| 复杂机器 GUI | 中低 | 每个重点模组写 adapter |
| 纯客户端 GUI/overlay | 低 | 需要 HeadlessMc sensory client 或真实客户端 |
| 客户端快捷键/渲染驱动玩法 | 低 | 需要客户端辅助，server_agent 不能直接等价 |

### 12.4 要让它像真人，需要实现哪些东西

MineLink 要把 `server_agent` 做得像玩家，至少要实现这些层。

第一层：身体控制。

```text
ActionScheduler
MovementController
LookController
InteractionController
InventoryController
ContainerController
FailureFeedback
```

第二层：有限感知。

```text
Self state
Visible surface scan
Raycast
Nearby entities
Inventory
Container state
Chat/social events
Local memory
```

第三层：规则一致性。

```text
交互距离
挖掘时间
工具效率和耐久
冷却
饥饿/受伤/击退
权限/claim/protection
封禁/白名单/admission
```

第四层：模组 adapter。

```text
Create adapter
  belt/depot/press/basin/shaft/cogwheel 等可见性和交互

Container adapter
  常见容器 slot 语义

Recipe adapter
  服务端 recipe graph

Quest/book adapter later
  任务书、公告、社会目标
```

### 12.4.1 容器和合成怎么做

对 `server_agent` 来说，工作台和熔炉不应该理解成“点 GUI 像素”，而应该理解成“服务端容器状态 + slot 操作 + recipe”。

熔炉示例：

```text
agent 走到可见熔炉旁
act_open_visible_block(furnace_ref)
observe_container
container_move_item(input_slot, item=iron_ore)
container_move_item(fuel_slot, item=coal)
wait_until(progress_done)
container_take(output_slot)
close_container
```

工作台示例：

```text
agent 走到工作台旁
act_open_visible_block(crafting_table_ref)
crafting_plan(recipe=minecraft:wooden_pickaxe)
container_place_grid([
  plank, plank, plank,
  null,  stick, null,
  null,  stick, null
])
container_take(output_slot)
close_container
```

这件事可以分成三层做。

第一层：低级 slot 操作。

```text
container.open(block_ref)
container.observe()
container.click_slot(slot, button)
container.move_stack(from_slot, to_slot, amount)
container.take_output(slot)
container.close()
```

这一层最像真实玩家，只是不用像素坐标，而是用服务端 slot index。

第二层：recipe helper。

```text
craft.plan(item_id, count)
craft.execute(recipe_id)
smelt.plan(input, fuel)
smelt.execute()
```

这一层可以根据服务端 recipe registry 自动知道“怎么摆”。Minecraft 的 recipe 本来就在服务端有数据，MineLink 可以读取 shaped/shapeless recipe，生成 slot plan。

也可以提供类似原版 recipe book 的工具层：

```text
craft.list_available()
  根据 agent 当前背包、附近可用工作台/设备、已知 recipe，列出当前能做什么

craft.fill_recipe(recipe_id)
  像玩家点击 recipe book 一样，把材料按服务端 recipe 自动铺进 2x2 或 3x3 grid

craft.quick_craft(recipe_id, count)
  如果材料、工作台和距离都满足，自动执行打开容器、铺材料、取 output 的完整流程
```

这不是凭空生成物品，而是把“玩家点 recipe book 后自动填格子”的行为结构化。最终 output 仍然由服务器 container/menu 和 recipe 规则决定。

推荐同时保留两种模式：

```text
快捷模式：
  craft.list_available
  craft.quick_craft

手动模式：
  container.open
  container.move_stack
  container.click_slot
  container.take_output
```

快捷模式让 agent 高效完成常见合成；手动模式让 Codex 可以自己学习摆放、调试失败、处理不在 recipe helper 覆盖范围内的复杂容器。

第三层：agent 自己写 skill。

```text
skills/craft_pickaxe.py
skills/smelt_iron.py
skills/restock_furnace.py
```

Codex 可以调用低级 slot 工具，也可以用 recipe helper；如果它想学习和改进流程，就把流程沉淀成 skill。

关键原则：

- 物资必须真的在 agent 背包或可触达容器里。
- 工作台/熔炉必须可见、可触达并能打开。
- 合成必须使用真实服务端 recipe。
- slot 操作必须走服务器 container/menu 规则。
- 不做 `give item` 或凭空合成。

所以，“不打开真实客户端 GUI”不等于作弊。只要它打开了服务端容器、按真实 slot/recipe 规则放入物品、等待进度、取出产物，它就是在用正常玩家能力的结构化版本。

第五层：社会存在感。

```text
名字和身份
可见模型/皮肤或 agent 标识
动作动画同步
聊天气泡/附近说话
当前意图或状态提示
公共媒介互动
```

### 12.5 真实判断

`server_agent` 能不能“用模组”取决于模组把玩法放在哪里：

- 如果玩法是服务端物品/方块/实体/容器交互，`server_agent` 可以通过 adapter 做到。
- 如果玩法必须依赖客户端 GUI、客户端快捷键、客户端渲染或 JEI/EMI/Ponder 这类客户端体验，`server_agent` 不能天然做到。
- 对关键复杂场景，可以临时借用 HeadlessMc sensory client 或真实客户端做视觉/GUI 辅助。

因此第一版产品承诺应该是：

```text
server_agent 像玩家一样在服务器规则内行动和交互
不是完整客户端玩家
优先兼容服务端交互型模组
对复杂客户端型模组逐个 adapter
```

### 12.6 Create/机械动力专项判断

Create 对 MineLink 是相对友好的目标，但不能说天然全兼容。

有利点：

- Create 的核心玩法不是只靠 GUI，而是世界里的机械组件：shaft、cogwheel、belt、depot、basin、press、mixer、saw、drill、fan、contraption 等。
- 很多 Create 操作本质上是放置方块、连接机械、投放物品、取放容器、右键交互、观察机器状态，这些都适合 `server_agent` 通过服务端动作和有限感知去做。
- Create 自己有 Deployer 这种“模拟玩家交互”的机器。Create Wiki 描述 Deployer 会模拟玩家动作，可以左键/右键或使用物品；这说明 Create 生态里类玩家交互不是陌生路线。

天然能做或较容易做：

```text
识别 Create 方块和物品
  create:* registry、tags、recipes

放置和拆除基础组件
  shaft、cogwheel、belt、depot、basin、press 等

普通玩家交互
  右键方块
  放入/取出物品
  使用 wrench
  使用 filter
  手动给 blaze burner 加燃料

观察世界内机器
  可见组件位置
  方块朝向
  belt 方向
  item 在 belt/depot 上的可见状态
  机器是否正在运动的服务端状态或 adapter 摘要

服务端 recipe
  mixing、pressing、cutting、deploying、compacting 等 recipe graph
```

需要 MineLink Create adapter 的部分：

```text
Kinetic network summary
  旋转方向
  转速
  stress capacity/impact
  是否 overstressed

Component semantics
  这个方块是不是输入/输出
  belt/depot/basin/press/mixer 的角色
  物品应该放在哪一面

Wrench interactions
  旋转、拆卸、配置方向

Contraption interactions
  movable contraption、机械臂、火车、矿车装配、结构移动

Recipe planning
  从目标物品反推需要哪些 Create 工序

Failure explanation
  为什么机器不动
  为什么 belt 方向错了
  为什么 stress 不够
  为什么物品没有进入 basin
```

不能由 `server_agent` 天然获得的部分：

```text
Ponder
  Create 的可视化教学是客户端体验

JEI/EMI 搜索界面
  客户端 recipe UI

客户端 overlay 和视觉提示
  goggle tooltip
  ponder scene
  鼠标悬浮说明
  某些客户端高亮

复杂客户端 GUI
  如果某个 addon 把玩法放在客户端 GUI 里，server_agent 需要 adapter 或 sensory client
```

Create adapter 第一版建议：

```text
create.scan_visible_components
  返回视野内 Create 方块、朝向、可交互面、基础语义

create.inspect_component
  输入 visible block ref，返回该组件的服务端摘要

create.use_wrench
  对可见 Create 方块执行合法 wrench 操作

create.place_component
  在可触达位置按方向放置组件

create.recipe_graph
  暴露服务端 recipe，不暴露 JEI GUI

create.explain_machine_failure
  基于可见组件和服务端状态解释常见失败
```

Create 适配原则：

- 优先让 agent 通过普通动作使用 Create：走过去、看见、放置、右键、使用 wrench、取放物品。
- Adapter 只补“普通玩家能从世界状态、工具提示、经验和规则推断的信息”，不要暴露隐藏全局网络。
- 对 Ponder/JEI 这类客户端学习体验，默认不进入 `server_agent`；需要时由 Host 提供文档/recipe knowledge，或借用 HeadlessMc sensory client。
- 如果要做“像玩家学会 Create”，可以把 adapter 输出做成结构化观察和失败解释，而不是一步到位的 `auto_build_factory`。

## 13. 第一版验收 Demo

### Demo A: 远程服务器连接

```text
服务器安装 MineLink Mod。
服务器 online-mode=false。
Codex 本地启动 MineLink Host。
Codex 调 minelink.connect_server("play.example.com")。
Codex 调 minelink.birth("一个谨慎但好奇的新人")。
服务器里出现 server_agent。
```

### Demo B: 基础行动闭环

```text
Codex observe_scene。
Codex 看到附近有树。
Codex act_move 接近树。
Codex act_mine_visible_block 挖可见原木。
动作成功或返回失败原因。
Codex 根据反馈重试。
```

### Demo B2: Codex 自举验证

```text
Codex 修改 Mod/Host/SDK 代码。
Codex 运行 scripts/dev/e2e.sh mine_tree。
脚本启动 dev server 和 Host。
脚本运行 examples/agents/mine_tree.py。
agent 创建 server_agent，观察树，移动，挖原木。
脚本断言 inventory 或 world event 中出现原木结果。
脚本收集 server.log、host.log、agent.log、latest-action-trace.jsonl。
Codex 根据结果继续修复，直到 e2e 通过。
```

### Demo C: 人和 agent 共处

```text
人类玩家正常 Minecraft 客户端进服。
agent 通过 MineLink server_agent 进服。
人类玩家在聊天里说话。
agent 通过 chat_say_local 回应。
人类玩家看到 agent 在世界里移动和交互。
```

## 14. 已确认设计结论

这些是当前讨论里已经收敛的结论，后续实现默认遵守。

### 14.1 系统形态

- MineLink 是 `MineLink Mod + MineLink Host`，不是单独一个 Mod，也不是把完整 MCP server 塞进 Minecraft JVM。
- MineLink Mod 安装在承载世界的一端：dedicated server，或本地单人世界/LAN 的 integrated server。
- 普通远程 agent 用户不需要 Minecraft、不需要 NeoForge、不需要 MineLink Mod，只需要 MineLink Host/Gateway。
- MineLink Host/Gateway 对外提供 MCP；MineLink Mod 对 Host/Gateway 提供内部 MineLink Protocol endpoint。
- 本地 Codex/Claude Code 优先使用 MCP stdio；远程平台后续使用 MCP Streamable HTTP。

### 14.2 agent 身体

- 默认 agent 身体是 `server_agent`。
- `local_player` 是普通人类玩家，不是默认 agent 身体，也不是默认调试角色。
- 人类玩家和 `server_agent` 应该能在同一个世界里共处。
- `server_agent` 不是完整客户端玩家，不能天然拥有真实截图、客户端 GUI、JEI/EMI、Create Ponder、客户端快捷键和完整正版 session 语义。
- 大规模 agent 社会以 `server_agent` 为主体；HeadlessMc 只作为少量高保真 sensory client 或复杂 GUI 辅助。

### 14.3 服务器接入和安装

- 第一阶段面向 `online-mode=false` 的服务器。
- 默认可以 open admission，但必须保留速率限制、数量限制和审计。
- `online-mode=true` 第一阶段返回 `unsupported_online_auth`，不创建 agent。
- 正版自登录放后续阶段，且只能复用官方/authlib 和服务器 session/profile 校验组件，不能自己手写 Mojang/Microsoft 验证。
- 服务器管理员安装 MineLink Mod；本地开世界用户安装 MineLink Mod；普通 agent 用户只安装 Host 或使用 Gateway。

### 14.4 合成和容器

- 工作台、熔炉、箱子这类是服务端容器，不需要真实客户端 GUI。
- MineLink 不重写 Minecraft recipe 规则，也不凭空生成物品。
- MineLink 负责把 agent 意图翻译成真实 container/menu/slot 操作。
- shaped recipe 必须按服务端 recipe pattern 摆放；shapeless recipe 可以按服务端规则任选合法摆放。
- recipe book 风格能力可以提供给 agent：`craft.list_available`、`craft.quick_craft`。
- 快捷合成也必须满足真实条件：材料存在、设备可见可触达、recipe 存在、slot 操作由服务端确认、output 由服务端生成。
- 低级 slot 操作也要保留，让 Codex 可以自己学习摆放、调试失败和处理复杂容器。

### 14.5 Create/机械动力

- Create 是相对适合 `server_agent` 优先适配的模组，因为大量玩法是世界内机械组件交互，而不是纯 GUI。
- `server_agent` 可以通过走近、观察、放置、右键、使用 wrench、取放物品来使用很多基础 Create 组件。
- Create 仍然需要 adapter，尤其是 kinetic network、stress、方向、wrench 语义、component semantics、failure explanation。
- Ponder、JEI/EMI、goggle tooltip、客户端 overlay 属于客户端体验，`server_agent` 不天然支持。
- Create adapter 不应该提供 `auto_build_factory` 这种一步到位工具，而应提供结构化观察、合法交互和失败解释，让 agent 自己写 skill。

### 14.6 工具暴露

- 不把几百个工具一次性暴露给 agent。
- MCP 层保持少量稳定工具：`connect_server`、`birth`、`tool_list`、`tool_query`、`tool_execute`。
- 具体动作和模组能力通过动态工具目录懒加载。
- `tool_list` 给摘要，`tool_query` 给 schema，`tool_execute` 执行。
- 不把每个 recipe、item、block 都注册成独立 MCP tool；大量数据通过查询和通用执行工具处理。
- Skill 是 agent/Host 本地工作区概念，不是 Minecraft server capability；Codex 这类 agent 用自己的本地文件沉淀 skill 即可。

## 15. 关键设计原则

- Mod 是游戏内 runtime，不是 MCP 生态承载层。
- Host/Gateway 是 MCP server，不是 Minecraft 服务器。
- 外部 agent 只用 MCP tools，不直接碰 Minecraft 协议。
- Host 到 Mod 使用 MineLink Protocol，不直接把 MCP 塞进 Mod。
- 第一版面向 `online-mode=false`，让 agent 直接连接和出生。
- `online-mode=true` 的 agent 自登录放后续阶段。
- `server_agent` 是默认身体。
- `local_player` 是普通人类玩家，不是默认 agent 身体。
- 所有世界动作最终由 Mod 按服务器规则执行。
- 所有感知默认有限、非全知、可审计。
