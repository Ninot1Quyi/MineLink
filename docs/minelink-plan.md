# MineLink 方案草案

更新时间：2026-06-21
定位：让外部 AI agent 通过真实 Minecraft 角色或服务端 agent 身体进入模组世界，在有限感知和合法动作边界内探索、生存、协作、沉淀技能，并逐步形成类似 Minecraft 西部世界的 agent 社会。

## 1. 目标

MineLink 要解决的问题不是“让 LLM 模拟按键”，也不是“做一个全知 Minecraft API”。它要给 AI 一个真实 Minecraft 身体，并提供接近玩家的感知和动作能力。

核心目标：

- 外部 Codex、Claude Code 或其他 agent 可以通过 MCP tools 控制 Minecraft 里的真实角色。
- 支持模组环境，第一重点是 Create/机械动力这类复杂模组。
- 默认只暴露玩家可感知、可触达、可执行的信息和动作，避免变成作弊接口。
- agent 的寻路、采集、合成、建造、生存策略由外部代码实现和迭代。
- 支持多人世界里多个 agent 共存、聊天、发现彼此、协作生存。
- 支持用户本地单机、局域网世界、专用服务器三种使用方式。
- 支持 `Frontier Society` 模式：服务器提供世界条件、社会媒介和生存压力，agent 自己出生、形成性格、建立关系、寻找角色、协作或冲突。

一句话定义：

> MineLink gives AI agents a Minecraft body, partial perception, and legal motor primitives. The intelligence, memory, pathfinding, and skills are written and evolved outside the game.

中文定位：

> MineLink 给 AI 一个真实 Minecraft 身体、有限感知和合法动作原语；寻路、采集、建造和生存策略由外部 Codex 自己编写、沉淀和迭代。

社会模拟目标：

> MineLink 不预制一个写死剧情的 NPC 小镇，而是提供出生、感知、记忆、行动、资源稀缺、通信媒介和公共制度这些条件，让 agent 在世界里自己长出职业、关系、协作和冲突。

## 2. 非目标

第一阶段不做这些事情：

- 不做 Mineflayer 式协议 bot。
- 不暴露全世界 chunk 数据。
- 不提供 `find_nearest_diamond`、`global_path_to`、`auto_mine_tree` 这类高阶作弊工具。
- 不把 agent 默认变成管理员，不默认提供 teleport、give、setblock。
- 不一开始同时支持 Forge、NeoForge、Fabric、Quilt 全 loader。
- 不承诺自动理解所有模组的玩法逻辑。
- 不把 MCP 协议强塞进 Minecraft 游戏 JVM 作为长期主架构。
- 不预制固定职业剧本、固定西部角色或固定社会分工；职业和阵营应该尽量从 agent 经历、资源压力和社会互动中涌现。

## 3. 核心架构

### 3.1 它到底是什么

MineLink 不是一个单独的 Minecraft Mod，也不是一个单独的 MCP server。它是一个两段式系统：

```text
MineLink = MineLink Mod + MineLink Host
```

更准确地说：

- `MineLink Mod` 是游戏内 runtime，安装在 Minecraft server、integrated server 或 client 里。
- `MineLink Host` 是 JVM 外的本地/远程 companion 进程，负责把 MineLink 暴露成 MCP server。
- 两者通过 `MineLink Protocol` 通信。

不要叫 `MCPE server`。`MCPE` 通常指 Minecraft Pocket Edition / Bedrock。这里应该叫 `MCP server`，也就是 Model Context Protocol server。

协议边界：

```text
Codex / Claude Code / OpenClaw / Hermes
  |
  | MCP transport
  | - local: stdio
  | - remote/web: Streamable HTTP
  v
MineLink Host
  |
  | MineLink Protocol
  | - localhost WebSocket / HTTP / Unix socket
  | - remote HTTPS / WebSocket
  v
MineLink Mod / MineLink Server Runtime
  |
  | Minecraft server/client APIs
  v
Minecraft 世界
```

所以：

- 对本地 Codex/Claude Code：MineLink Host 提供 MCP stdio server。
- 对远程 agent 平台：MineLink Host 可以提供 MCP Streamable HTTP server。
- 对 Minecraft server：MineLink Mod 提供 MineLink endpoint，但这个 endpoint 不一定直接是 MCP；它更适合是稳定的内部控制协议。
- 对用户：安装 MineLink 后，看起来就是“我的 agent 可以用 MCP tools 连接这个 Minecraft 世界”。

为什么不让 Mod 直接承担完整 MCP server：

- Mod 应该专注于游戏内状态、身体、动作、权限和世界事件。
- MCP transport、tool schema、agent session、日志、HTTP/stdio 兼容和 Host 自身版本更新应该放在 JVM 外。
- Skill 代码默认只在 agent 本地 Runner 执行；MineLink Host/Gateway 负责连接和协议，不需要托管执行用户代码。
- 这样 Minecraft 端更稳定，外部 agent 生态变化时只更新 Host，不需要频繁重发 mod。

推荐架构：

```text
Codex / Claude Code / 自定义 Agent
  |
  | MCP stdio / Streamable HTTP
  v
MineLink Host
  |
  | localhost WebSocket / HTTP / Unix socket
  v
MineLink Mod
  |
  | Minecraft client/server APIs
  v
Minecraft 玩家 / 世界 / 服务器
```

组件说明：

- `MineLink Mod`：安装在 Minecraft 里，负责读取玩家可感知状态、执行合法动作、接入服务端通信。
- `MineLink Host`：本地 companion 进程，承载 MCP Server、tool schema、权限、日志和调试回放；默认不执行 agent 代码。
- `MineLink Protocol`：Host 和 Mod 之间的稳定 JSON 协议。
- `MineLink Server`：服务端逻辑，负责 agent 注册、权限、A2A 通信、距离发现、审计。
- `Agent-local Runner`：运行 agent skill 代码的本地执行环境，通常就是 Codex/Claude Code 自己的工作区和命令执行能力；它通过 MineLink SDK 操作游戏。
- `MineLink Director`：可选观察和管理层，负责世界事件时间线、agent 状态、社会图谱、经济指标、回放和调试，不直接替 agent 做决定。

为什么 MCP 放在 Host，不直接放进 Mod：

- MCP 官方标准传输包括 stdio 和 Streamable HTTP，更适合普通本地进程承载。
- Minecraft JVM 已经有 loader、游戏、其他模组的 classpath 压力，不适合塞过多外部协议依赖。
- MCP、Codex、Claude Code 适配会频繁变化，Host 可以快速更新；Mod 受 Minecraft/loader 版本约束，应该更稳定。
- 安全边界更清楚：Mod 默认只接受本机 Host，Host 再决定哪些 MCP client 可以控制游戏。
- 多客户端、多 agent 管理更容易，一个 Host 可以发现多个本地 Minecraft 实例。

用户体验上不应该让用户感觉“装两套东西”。正式版可以做 MineLink Installer，把 Mod、Host、MCP 配置一次装好。

## 4. 连接模式

MineLink 需要支持两种用户最关心的连接方式：远程服务器直连、本地 LAN 世界连接。这里的“直连”是用户体验层面的直连；技术上 Codex/Claude Code 仍然通过本机的 `MineLink Host` 暴露 MCP tools，由 Host 去连接 Minecraft 侧的 MineLink endpoint。

### 4.0 推荐连接方式

为了支撑 NeoForge/Create 这类重模组世界，MineLink 的主连接方式应该固定为：

```text
Agent-local code / Codex / Claude Code
  -> MineLink SDK / MCP
  -> MineLink Host 或 Gateway
  -> MineLink Protocol
  -> MineLink Mod endpoint
  -> server_agent body
  -> Minecraft server / integrated server
```

也就是：agent 的代码在本地跑，Host/Gateway 只负责连接和协议，Mod 在服务器里创建 `server_agent` 身体并执行动作。

不推荐作为主路线：

| 方式 | 结论 | 原因 |
| --- | --- | --- |
| Mineflayer / client_bot | 只作为参考或可选 backend | 适合 vanilla/插件服，不适合作为 Create/NeoForge 主路线 |
| HeadlessMc / 真实无头客户端 | 只作为少量 sensory client | 模组兼容接近真实客户端，但资源消耗高，不适合大规模 agent |
| 直接让 Codex 连 Minecraft 原生协议 | 不做 | 缺少 MineLink 权限、有限感知、日志和模组 adapter |
| 把 agent 代码发到 Minecraft Mod/JVM 执行 | 不做 | 稳定性和安全风险高 |

为什么这个主路线最适合模组：

- Mod 在服务器 JVM 内，可以访问服务端方块、实体、容器、recipe、capability、事件和权限。
- `server_agent` 可以走类玩家交互路径，尽量复用 Minecraft/NeoForge/模组原生规则。
- MineLink 可以为 Create 这类模组写 server-side adapter，暴露机器状态、方向、stress、堵塞原因和可交互面。
- 服务器侧可以统一做有限感知、ref 校验、动作队列、限流和审计。
- 不需要为每个 agent 启动一个完整 Minecraft 客户端。

### 4.1 远程服务器直连模式

目标体验：

```text
Codex / Claude Code
  -> MineLink MCP
  -> 输入 mc-server 地址
  -> 连接已安装 MineLink Server Mod 的远程服务器
  -> 创建或绑定一个 server_agent
  -> 开始玩
```

这个模式可以做到，而且不要求用户本地启动 Minecraft 客户端。

但它对应的不是 `local_player`，而是 `server_agent`：

```text
Codex
  -> MineLink Host
  -> MineLink Server endpoint
  -> server_agent / AgentBody / FakePlayer
  -> 远程 Minecraft 世界
```

能力边界：

- 可以批量创建多个 agent。
- 可以在远程服务器里移动、采集、放置、聊天、协作。
- 视觉和感知由服务器按 agent 身体位置计算，仍然要遵守有限感知规则。
- 没有真实客户端屏幕截图、JEI/EMI 界面、客户端 GUI 视觉。
- 对复杂客户端模组 GUI 的兼容性不如真实客户端。
- 对服务端逻辑和 Create 机器交互可以逐步支持，但要实测每个模组的 FakePlayer/类玩家兼容性。

服务器侧必须提供一个 MineLink 控制入口，不能让 Codex 直接说 Minecraft 原生协议：

```text
Minecraft server port: 25565       # 原版玩家进服
MineLink endpoint:     25575       # Host 控制 agent，可配置
```

也可以做地址发现：

```text
minelink.connect_server("play.example.com")
  -> 查询服务器是否安装 MineLink
  -> 发现 MineLink endpoint
  -> 鉴权
  -> 创建/恢复 agent
```

安全要求：

- 远程 MineLink endpoint 必须声明 admission policy；第一阶段默认可以是 `open`，但仍应有速率限制、数量限制和审计。
- 第一阶段默认只支持 Minecraft server `online-mode=false` 的 agent 接入；没有正版校验时，Codex/OpenClaw/Hermes 只要知道服务器地址并满足服务器 admission policy 就能连接、出生。
- 如果 Minecraft server `online-mode=true`，第一阶段应拒绝创建 `server_agent`，直到实现 agent 自登录获取正版验证信息。
- 服务器决定是否允许创建 `server_agent`。
- 服务器限制每个用户可创建的 agent 数量。
- 所有动作都要 rate limit 和审计。
- 默认不能开放 debug oracle。

`server_agent` 不会自动经过 Minecraft 原生登录握手，因为它不是从 `25565` 端口用原版客户端协议登录进来的玩家。因此产品路线分两步走：

```text
server online-mode=false
  -> 使用服务器 offline profile / UUID 规则
  -> 默认允许 agent 连接和出生
  -> 可选叠加白名单、token、IP 限制、服务器邀请码、速率限制
  -> 名称占用、封禁和权限仍交给服务器已有规则判断

server online-mode=true
  -> 第一阶段：返回 unsupported_online_auth
  -> 后续阶段：agent 通过 MineLink Host 自己完成正版登录
  -> 复用官方/authlib/服务器 session-profile 校验组件
  -> 绑定 agent owner 到正版 UUID / profile
  -> 再按服务器已有白名单、封禁和权限规则创建 server_agent
```

身份绑定原则：

- 每个 `server_agent` 必须有 `owner_profile`，记录它属于哪个离线身份、已认证玩家、团队或服务器主体。
- agent 的显示名可以是出生生成的名字，但底层 owner 必须可追溯。
- 如果服务器开白名单，agent owner 必须在白名单中，或由管理员显式授权。
- 如果 owner 被封禁、token 被撤销或账号验证失败，它名下的 agent 应该被冻结、下线或转入只读状态。
- `server_agent` 的 UUID/name 不应该伪装成另一个真实玩家。
- 禁止 MineLink 只根据 `username`、外部模型声明或 Host 自报 UUID 创建 online-mode agent。
- 禁止绕过服务器已有白名单、封禁、权限、claim/protection 检查。

### 4.2 本地 LAN 世界连接模式

目标体验：

```text
用户本地启动 Minecraft
安装 MineLink Mod
打开单人世界
开启 LAN
Codex 通过 MineLink MCP 连接这个 LAN 世界
```

这个也可以做到。产品目标里，房主当前玩家应该仍然是正常人类玩家；Codex/agent 不默认接管 `local_player`，而是往 LAN 世界里添加 agent 身体。

```text
Codex -> MineLink Host -> Integrated Server 的 MineLink Server Mod -> server_agent 1
                                                           -> server_agent 2
                                                           -> server_agent 3
```

特点：

- 可以在用户本地开的 LAN 世界里添加多个 agent。
- 不需要为每个 agent 启动一个完整 Minecraft 客户端。
- 需要 MineLink Server 逻辑在 integrated server 内启用。
- 没有每个 agent 独立的真实客户端屏幕。
- 复杂客户端 GUI 能力弱于普通人类玩家。
- 人类玩家和 agent 在同一个 LAN 世界里共处，通过聊天、物品、建筑、公告板、交易等机制互动。

LAN 模式必须显式开启，不建议 Mod 默认自动打开 LAN 或默认暴露控制端口。推荐流程：

```text
1. 用户在游戏内点击 Open to LAN，或通过 MineLink UI 显式启用 LAN agent access。
2. MineLink 只在用户确认后开放 LAN 控制入口。
3. Host 连接 LAN MineLink endpoint；可选使用 admission token 或邀请码。
4. 用户可以选择：
   - create server agent
   - allow remote agent from LAN
   - inspect local player presence
```

结论：

- “无本地 Minecraft，Codex 直接连远程服务器玩”可以做，但必须是 `server_agent` 路线。
- “连接本地 LAN 世界并添加多个机器人”可以做，这些机器人应是 integrated server 里的 `server_agent`，不是多个真实客户端玩家。
- `local_player` 在社会模式里就是普通人类玩家，不是默认调试角色，也不是默认 agent 身体。

## 5. 技术栈建议

第一版推荐：

```text
Minecraft: 1.21.1
Loader: NeoForge
Mod language: Java
Build: Gradle + NeoForge MDK
Host language: TypeScript/Node.js 或 Rust
MCP: 官方 MCP SDK
Host-Mod protocol: JSON-RPC over WebSocket 起步
Config: TOML/JSON
Skill runtime: Codex/agent 本地工作区优先；Host sandbox 后续可选
```

为什么第一版偏 NeoForge：

- Create 当前官方分发运行在 Forge/NeoForge，1.21.1 新版本明确有 NeoForge。
- NeoForge/Forge 系更适合重型内容模组、服务端逻辑、复杂网络同步、类玩家实体、多人权限。
- MineLink 是新平台，优先面向新世界和新服务器时，NeoForge 1.21.1 比 Forge 1.20.1 更适合作为第一目标。

但 Forge 仍然重要：

- 如果目标改成“兼容最多现有整合包”，尤其是大量 1.20.1 Create 整包，Forge 1.20.1 应该作为优先兼容线。
- 推荐代码结构上预留多 loader：

```text
minelink-common
minelink-neoforge-1211
minelink-forge-1201
minelink-fabric-later
minelink-host
```

Fabric/Quilt：

- Fabric 适合轻量客户端工具和性能生态，但 Create 主线不是 Fabric 优先。
- Quilt 暂不适合作为首发目标。
- 后续可以通过 common core + loader adapter 做移植。

## 6. 感知模型

MineLink 默认运行在 `survival_fair_mode`。

agent 能知道：

- 自己的位置、朝向、速度、血量、饥饿、氧气、状态效果、装备。
- 自己背包、快捷栏、当前手持物、当前 GUI。
- 当前视野内可见的方块表面、实体、掉落物、流体。
- 当前视野内可见且可交互候选对象；raycast 只用于遮挡判断，不要求像客户端准星一样精确命中。
- 屏幕截图。
- 聊天记录。
- 曾经看见过并由 Host 记录的局部地图记忆。
- 已安装 mod、item/block/entity registry、recipes、tags，但这些是“知识”，不是当前世界全知状态。

agent 默认不能知道：

- 被石头、墙、地形遮挡的矿物。
- 未探索区域的 chunk 数据。
- 地下洞穴结构。
- 远处未加载或不可见实体。
- 其他玩家背包。
- 服务端隐藏状态。

`view_scene` 应该返回可见表面，而不是 chunk 全量数据。

### 6.1 遮挡与透明物体

不能简单用“第一条射线碰到方块就停止”，因为草、花、玻璃、海藻、链条、栅栏、灯、机械方块等都有复杂可见性。

推荐实现：

```text
camera ray
  -> air: 跳过
  -> 草/花/海藻: 记录可见，继续
  -> 链条/栅栏/铁栏杆: 按 VoxelShape 判断是否真命中实体部分
  -> 玻璃/水/树叶: 记录可见，继续，但增加透明/浑浊权重
  -> 石头/泥土/木板: 记录可见，停止
```

实现基础：

- 使用 Minecraft 原生 `BlockState`、`VoxelShape`、raycast、visual shape、occlusion shape。
- 维护 MineLink 自己的视觉 tag：

```text
minelink:vision_pass_through
minelink:vision_translucent
minelink:vision_decorative
minelink:vision_partial_occluder
minelink:vision_opaque
minelink:vision_fluid
```

输出示例：

```json
{
  "ray": "screen_center",
  "hits": [
    {
      "id": "minecraft:tall_grass",
      "distance": 2.1,
      "visibility": "decorative",
      "occludes": false
    },
    {
      "id": "minecraft:glass",
      "distance": 4.3,
      "visibility": "translucent",
      "occludes": false
    },
    {
      "id": "minecraft:stone",
      "distance": 5.2,
      "visibility": "opaque_surface",
      "occludes": true
    }
  ]
}
```

这样 agent 能理解“草可见但不遮挡，玻璃后面的东西也可见，石头后面不可见”。

## 7. 动作模型

MineLink 提供的是合法动作原语，不是全能控制台命令。

基础动作：

```text
act.look(yaw, pitch)
act.look_at(visible_ref)
act.move(heading, duration)
act.jump()
act.sneak(enable)
act.sprint(enable)
act.attack()
act.use()
act.select_hotbar(slot)
act.select_item(item_id)
act.mine_visible_block(block_ref)
act.place_block(face_ref, item_ref)
act.open_visible_block(block_ref)
act.click_slot(slot, button)
act.chat(message)
```

动作必须受真实规则约束：

- 目标必须可见或可触达。
- 距离必须符合 Minecraft 交互距离。
- 工具必须在背包里，且能正常切换。
- 挖掘耗时按游戏规则。
- 受伤、击退、移动、掉落、饥饿都会影响动作。
- 中途状态变化会返回失败原因。

动作返回必须包含反馈：

```json
{
  "ok": false,
  "reason": "blocked_by_wall",
  "moved_distance": 0.4,
  "collision": true,
  "new_observation": "available"
}
```

## 8. Agent-local Runner 与 SDK

MineLink 不内置完整寻路和采集策略，而是让 Codex 自己写代码。

推荐循环：

```text
observe
  -> update local map
  -> choose goal
  -> run skill code
  -> act
  -> observe result
  -> revise skill
```

默认由 agent 自己的本地工作区保存 skill。对 Codex、Claude Code 这种本来就有文件系统和命令执行能力的 agent，不需要 MineLink 提供 `skill_write` 或 `skill_run`：

```text
skills/
  movement/
    local_map.py
    pathfind.py
    obstacle_avoidance.py
  survival/
    mine_tree.py
    collect_drop.py
    craft_planks.py
  create/
    inspect_machine.py
    operate_depot.py
    operate_belt.py
```

MineLink 日志应该保存：

- 每次观察结果。
- 每次动作请求和动作反馈。
- 截图。
- agent 当前使用的 skill 路径、版本号或 hash。
- 失败回放。
- 世界种子/坐标可选脱敏信息。

这样 Codex 可以不断修改自己的 `pathfind.py`，而不是依赖 MineLink 内置全局寻路。

第一版不需要托管运行用户代码。用户本地的 Codex/Claude Code 已经能写文件、运行脚本、保存 skill；MineLink 只需要提供 SDK、连接、协议、日志和服务器侧校验。

### 8.1 Skill 代码运行在哪里

Skill 是 agent 写出来的真实代码。关键不是“能不能写代码”，而是这段代码运行在哪里。

第一版推荐只有一种运行位置：agent 本地。

```text
Agent-local Runner
  Codex / Claude Code / OpenClaw 在自己的本地工作区写代码、运行代码
  代码 import MineLink SDK
  SDK 连接本地 MineLink Host 或远程 MineLink Gateway
  Host/Gateway 再连接 Minecraft server 的 MineLink endpoint
```

代码可以很复杂，但它影响 Minecraft 世界时，仍然只能通过 MineLink SDK 发出结构化 observe/action/container/craft 请求。

```text
Codex 写出的本地代码
  |
  | 调用 MCP tool: observe / action / craft / container
  v
MineLink Host 或 Gateway
  |
  | MineLink Protocol 请求
  v
MineLink Mod
  |
  | 服务端校验：距离、视野、权限、冷却、背包、配方、方块状态
  v
Minecraft server_agent 在服务器里执行动作
```

所以 skill 影响服务器的不是“代码本身直接修改世界”，而是代码运行后发出的合法请求序列。服务器仍然是权威端：

- 本地代码不能直接改世界、刷物品、传送或读取全量 chunk。
- 本地代码只能调用 MineLink 暴露的观察和动作工具。
- 每个动作都由 Mod 在服务器侧重新校验。
- 如果目标不在可见范围、距离不够、工具不对、配方不成立、容器没打开，服务器返回失败原因。

本地代码使用 SDK：

```python
from minelink import Agent

mc = Agent.connect()
view = await mc.observe.scene(radius=16)
await mc.body.move(...)
```

`Agent.connect()` 可以连接本地 Host，也可以连接远程 Gateway。对 agent 来说 API 是一样的。

一个最小例子：

```python
# skills/survival/mine_tree.py
# 这段代码运行在 Codex/agent 本地，不运行在 Minecraft 服务器上。

scene = minelink.tool_execute("observe.scene", {
    "radius": 16,
    "include": ["visible_blocks"]
})

log = nearest_visible_block(scene, tag="minecraft:logs")

while log is not None:
    minelink.tool_execute("action.look_at", {
        "block_ref": log["block_ref"]
    })

    result = minelink.tool_execute("action.mine_visible_block", {
        "block_ref": log["block_ref"]
    })

    if result["ok"]:
        break

    scene = minelink.tool_execute("observe.scene", {
        "radius": 16,
        "include": ["visible_blocks", "self"]
    })
    log = revise_target_from_feedback(scene, result)
```

这段 skill 的实际效果是：远程服务器上的 `server_agent` 看向一个可见原木，尝试挖掘。它失败时拿到服务器返回的原因，比如 `target_too_far`、`target_not_visible`、`wrong_tool`、`interrupted`，再修改下一步动作。

更复杂的 skill 也是同一个模式：

```text
pathfind.py
  observe.scene -> 建本地局部地图 -> action.move -> observe result

craft_pickaxe.py
  observe.inventory -> craft.list_available -> craft.quick_craft

operate_create_depot.py
  observe.scene -> create.inspect_component -> action.use / container.move_stack
```

因此 skill 的保存和迭代在 agent 本地完成。Minecraft Mod 只需要稳定提供“有限感知 + 合法动作 + 失败反馈”。

### 8.2 可编程 Agent SDK

如果只让 agent 看到几个 MCP tool，它会很像“在提示词里手动排列工具调用”，可编程性不够。更合适的形态是：MCP 层保持少量稳定入口，MineLink 提供一个本地 Agent SDK，让 Codex 写普通代码时可以 import 这个 SDK。

```text
Codex 写 skill 代码
  |
  | import minelink
  v
MineLink Agent SDK
  |
  | observe/action/container/craft/social 函数
  v
MineLink MCP tools
  |
  v
MineLink Host -> Mod -> server_agent
```

这个 SDK 可以暴露很多“像正常编程一样”的函数，但这些函数不是服务器后门。它们要分成两类：

1. 本地 helper：只处理已经观察到的数据，比如局部地图、A*、避障、目标选择、失败重试、物品规划。
2. 服务器 capability：需要影响世界或读取新状态时，必须通过 MineLink tool/Protocol 请求，由服务器重新校验。

例子：

```python
from minelink import Agent

async def mine_nearest_log():
    mc = Agent.current()

    view = await mc.observe.scene(radius=16)
    logs = [
        block for block in view.visible_blocks
        if "minecraft:logs" in block.tags and block.visible_faces
    ]

    target = nearest(view.self.position, logs)

    # navigate_to 是本地 SDK/helper。它自己维护局部地图，
    # 循环调用 observe.scene + action.move，不拥有穿墙或传送能力。
    await mc.navigation.navigate_to(target.best_visible_face())

    await mc.body.look_at(target.ref)
    result = await mc.body.mine(target.ref)

    if not result.ok:
        await mc.memory.record_failure(result.reason)
        return False

    return True
```

这里 `navigation.navigate_to` 可以是 agent 自己写出来的复杂代码，也可以是 SDK 提供的基础 helper。但它拿到的地图只来自 `observe.scene` 的可见结果；它移动角色也只能调用 `action.move`。所以代码可以很复杂，但权限没有变大。

SDK 里推荐提供这些底层能力：

```text
observe.scene()              # 返回可见表面、实体、光照、碰撞提示、可交互对象
observe.self()               # 返回生命、饥饿、位置、朝向、姿态、当前动作状态
observe.inventory()          # 返回自己背包和装备
observe.events()             # 返回最近感知事件和动作反馈

body.look_at(ref_or_point)
body.move(vector, duration)
body.jump()
body.sneak(enabled)
body.mine(block_ref)
body.use(target_ref)
body.place(block_ref, face_ref, item_ref)

inventory.select(item_ref)
container.open(block_ref)
container.click_slot(slot_ref, mode)
craft.list_available()
craft.quick_craft(recipe_id, count)

navigation.local_map()       # 本地 helper，只基于已观察数据
navigation.navigate_to(...)  # 本地 helper，循环调用 observe/action
memory.record(...)
```

为了维护“像玩家一样看见”的边界，观察结果不能直接给原始坐标对象随便操作，而应该返回带有效期的 `ref`：

```json
{
  "observation_id": "obs_123",
  "expires_at": 1710000000,
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

动作必须优先使用 `block_ref`、`entity_ref`、`slot_ref`、`face_ref` 这类引用。Mod 收到动作后重新检查：

- 这个 ref 是否来自该 agent 最近的观察。
- ref 是否过期。
- 目标现在是否仍然可见或可交互。
- 距离、朝向、工具、冷却、权限是否满足。
- 中途世界状态是否变化。

这样 agent 写的代码可以有很强的表达力：它可以写循环、搜索、规划、局部地图、失败恢复和长期 skill；但它不能突破有限感知，也不能绕过服务器规则。

只发送结构化请求不会限制 agent 的智能上限，因为限制的是“世界副作用边界”，不是“本地计算边界”。可以把 MineLink SDK 理解成操作系统 syscall：

```text
agent 代码可以任意计算
  - 建图
  - 搜索
  - 规划
  - 写状态机
  - 训练/沉淀 skill
  - 重试和复盘

但所有影响世界的 I/O 都必须走 SDK capability
  - observe.scene
  - body.move
  - body.mine
  - container.click
  - craft.quick_craft
```

SDK 的价值是把连接、session、ref、重试、事件流、日志和权限错误包装成好用的编程接口。代码默认跑在 agent 本地；SDK 负责把本地代码和本地 Host 或远程 Gateway 接起来。

### 8.3 等待模型和 Action Lifecycle

本地代码发请求后不能无脑“哐哐往外发”。Minecraft 是 tick 驱动的世界，动作有延迟、失败和中途状态变化。MineLink SDK 应该提供清晰的异步等待模型，让 agent 自己决定什么时候等、等到什么程度。

推荐把调用分成四类：

```text
1. observe query
  必须 await 返回结果
  例如 observe.scene、observe.inventory、observe.self

2. short action
  默认 await 到动作完成或失败
  例如 look_at、select_item、click_slot、say_local

3. duration action
  默认 await 到本次时间片结束
  例如 move(vector, duration=200ms)、sneak(2s)、mine(block_ref)

4. long action / helper
  返回 ActionHandle，代码可以 await、cancel、poll、订阅事件
  例如 navigation.navigate_to、collect_nearby_items、build_local_plan
```

SDK 形态：

```python
# 观察类：一定等结果，因为后续决策依赖它
view = await mc.observe.scene(radius=16)

# 短动作：默认等服务器确认完成/失败
await mc.body.look_at(target.ref)

# 时间片动作：等 200ms 执行结果，再决定下一步
step = await mc.body.move(vector, duration_ms=200)
if step.collision:
    view = await mc.observe.scene(radius=16)

# 长动作：拿 handle，可以边等边看事件，也可以取消
nav = mc.navigation.navigate_to(target, wait=False)
async for event in nav.events():
    if event.type == "blocked":
        await nav.cancel()
        break
result = await nav.done()
```

底层每个动作都应该有生命周期：

```text
submitted
  -> accepted       # Host/Mod 接受，进入该 agent 的动作队列
  -> running        # 服务器 tick 正在执行
  -> completed      # 成功完成
  -> failed         # 失败，带 reason
  -> cancelled      # 被 agent 或服务器取消
  -> expired        # 超时或 ref 过期
```

SDK 默认应该偏保守：

- 需要后续决策的动作默认 `await`。
- 不允许无限堆积 motor actions；同一个 body 同一时间只能有有限数量的 active action。
- 允许并发的只有不冲突的通道，比如 `chat.say_local` 可以和移动并发，`observe.events` 可以长期订阅。
- 对连续移动/挖掘这类动作，使用短 duration 和反馈循环，而不是一次提交很长的不可控动作。

这样 agent 既能写复杂代码，也不会把服务器打爆：

```python
while True:
    view = await mc.observe.scene(radius=12)
    next_step = planner.next_step(view)

    result = await mc.body.move(next_step.vector, duration_ms=200)
    planner.observe_feedback(result)

    if result.ok and planner.reached_goal():
        break
```

原则是：**计算可以在本地连续跑，世界 I/O 必须有节奏、有反馈、有背压**。

### 8.4 能复用什么，必须自建什么

现有生态里有几类可借鉴方案，但没有一个能直接满足 MineLink 的完整目标：

```text
Mineflayer / Voyager / Odyssey
  优点：证明了“LLM 写可执行代码 + skill library + 环境反馈”这条路线可行。
  不足：主要基于外部协议 bot，不适合深度兼容 NeoForge/Forge 模组内部能力。

Baritone
  优点：成熟的 Minecraft 路径规划/自动挖掘思路。
  不足：偏 client-side 自动化，不是 server_agent 权限边界，也不解决模组 capability 暴露。

NeoForge / Fabric FakePlayer
  优点：能在服务器侧获得类玩家上下文，复用很多 Minecraft/模组的玩家交互逻辑。
  不足：只提供“身体基础”，不提供有限感知、Agent SDK、MCP、skill 迭代和社会系统。

Deno / WASI / 容器沙箱
  优点：适合限制本地 skill 代码的文件、网络、进程权限。
  不足：它们只能限制本地程序不能乱读文件或乱联网，不能天然判断“这个方块玩家是否看得见”。
```

所以推荐策略是“借鉴成熟组件，但权限边界自己实现”：

- Agent SDK 可以参考 Mineflayer/Voyager 的可编程接口形态。
- 路径规划算法可以借鉴 Baritone，但输入必须只来自 MineLink observation。
- 服务器身体优先基于 NeoForge/Fabric FakePlayer 或类 `ServerPlayer` 路线。
- 本地代码沙箱可以用 Deno permissions、WASI 或进程隔离。
- Minecraft 世界权限必须在 Mod 服务器侧实现，不能交给本地 SDK 或 prompt 约束。

服务器侧权限分两层：

1. 尽量复用 Minecraft/模组已有规则。
   - 合成配方、物品消耗、容器 slot、背包容量、工具耐久、方块破坏结果、保护插件/权限事件，都应该走原本的服务器逻辑。
   - 不要自己重写一套“挖方块、生成掉落物、合成物品”的规则。

2. MineLink 自己补“玩家感知和身体约束”。
   - 目标是否来自最近 observation。
   - 是否在可见范围内。
   - 是否被遮挡。
   - 是否在当前朝向对应的视野内；不要求严格准星命中。
   - 是否在玩家可交互距离内。
   - 是否需要先转身、靠近、打开容器、选中工具。

例如：

```text
agent 想挖 64 格外的原木
  -> block_ref 不存在，或距离校验失败
  -> 返回 target_too_far

agent 想挖背后的方块
  -> ref 可能还在短期记忆里
  -> 但当前朝向视野内不可见
  -> 返回 target_not_visible_from_current_view 或 must_turn_first

agent 想隔墙挖矿
  -> observation 不会返回被遮挡矿石
  -> 即使猜坐标提交，服务器也要求有效 block_ref
  -> 返回 unknown_or_unobserved_target

agent 想直接捡 64 格外物品
  -> 不提供远程 pickup capability
  -> 只能 navigate_to(item_ref) 后靠近，由 vanilla pickup 逻辑处理
```

最终边界是：本地 SDK 负责“好用”，服务器 Mod 负责“可信”。所有会改变世界的动作，都必须经过服务端 guard pipeline：

```text
schema 校验
  -> session / agent 权限校验
  -> ref/observation lease 校验
  -> 可见性 / 遮挡 / 朝向 / 距离校验
  -> 当前身体状态校验
  -> 调用 Minecraft/模组原生交互逻辑
  -> 返回成功、失败原因和新 observation hint
```

第一版不让 agent 提交代码给 MineLink Host/Gateway 执行，更不要把 agent 任意代码发送到 Minecraft Mod/JVM 里执行。Minecraft server 侧只接收结构化 action/observe/container/craft 请求，例如 `body.mine(block_ref)`、`body.move(vector)`、`container.click(slot_ref)`。这样代码写错最多造成本地脚本超时、动作失败或被限流，不会把 Python/JS 运行时、无限循环、内存泄漏或依赖冲突带进 MineLink 后端或 Minecraft JVM。

### 8.5 Mineflayer 能借鉴什么

Mineflayer 的模式很有参考价值，但它和 MineLink 的身体路线不同：

```text
Mineflayer
  本地 JS 程序
  -> node-minecraft-protocol
  -> 作为一个 Minecraft client 登录服务器
  -> 收包、维护 bot.world、发移动/挖掘/聊天/容器 packet

MineLink
  本地 agent skill
  -> MineLink SDK
  -> MineLink Host/Gateway
  -> MineLink Mod
  -> 服务器内部 server_agent 执行动作
```

Mineflayer 里值得借鉴的部分：

- `bot` 对象模型：`bot.entity`、`bot.inventory`、`bot.chat`、`bot.dig`、`bot.blockAt` 这种直观 API。
- 事件模型：`spawn`、`chat`、`goal_reached`、`diggingCompleted` 这类事件驱动代码。
- async/promise 风格：动作完成后再继续，失败能抛错或返回 reason。
- plugin 机制：pathfinder、inventory、craft、combat 等能力可以按插件扩展。
- pathfinder 的 `Movements` 和 `Goal` 抽象：把“怎么走”和“目标是什么”拆开。

不建议直接复用的部分：

- 不建议让 MineLink 主体也用 Minecraft client protocol 直连服务器。那会回到 client-bot 路线，和 `server_agent` 路线冲突。
- 不建议把 Mineflayer 的 `bot.world` 暴露给 agent。Minecraft 客户端收到的是 chunk 数据，程序可以读取被遮挡方块；这不符合“像玩家一样只能看见表面”的目标。
- 不建议依赖 Mineflayer 做 Forge/NeoForge 模组兼容。它主要理解网络协议和客户端状态，不理解服务器内部的模组 capability、FakePlayer、事件和菜单逻辑。

MineLink 可以做一个“Mineflayer-like SDK”，也就是 API 风格接近 Mineflayer，但底层完全不同：

```python
mc = Agent.connect()

view = await mc.observe.scene(radius=16)
log = view.find_visible_block(tag="minecraft:logs")

await mc.navigation.goto_visible(log)
result = await mc.body.mine(log.ref)
```

这比直接复用 Mineflayer 协议更适合 MineLink：agent 写代码的体验熟悉，但权限、可见性、动作执行和模组兼容仍然由 MineLink Mod 在服务器侧控制。

### 8.6 Agent brain 分层

Minecraft 是 20 tick/s，但 agent 不能每 tick 都调用大模型。MineLink 应该把身体控制、技能执行和长期思考拆开：

```text
Reflex Loop        20 ticks/s
  - 服务端或 Host 本地执行
  - 继续走路、避免掉落、保持挖掘、基础战斗、防卡住
  - 不调用 LLM

Tactical Loop      1-5 秒一次
  - 选择下一步动作或 skill
  - 可以调用小模型、规则、脚本或 Codex 写出的 skill
  - 例如继续采矿、回仓库、找人交易、躲避怪物

Strategic Loop     30-300 秒一次
  - 调用强模型或 Codex
  - 更新长期目标、关系、身份叙述、计划和反思
  - 例如是否加入某个群体、是否迁居、是否信任某个 agent
```

这样 `server_agent` 才能扩到几十个甚至更多。MineLink 提供节奏和日志，具体策略仍由外部 agent 和 skill 迭代。

## 9. 多 Agent 模型

MineLink 应支持两类 body。

### 9.1 local_player

真实客户端里的普通人类玩家。

```text
人类玩家 -> Minecraft Client Mod -> Minecraft 世界
```

特点：

- 它就是普通玩家，不是默认 agent 身体。
- 可以和 agent 在同一个世界里共处、交易、聊天、合作或冲突。
- 可以看到屏幕、GUI、模组界面，但这些客户端能力不自动变成 agent 的能力。
- 可以作为用户进入 agent 社会的正常入口。
- 默认不被 Codex 接管；如果未来支持“玩家辅助模式”，应该和 Frontier Society 模式隔离。

### 9.2 server_agent

服务端生成的类玩家实体或 FakePlayer。

```text
Codex -> Host -> Server Mod -> AgentBody 1
                         -> AgentBody 2
                         -> AgentBody 3
```

特点：

- 适合批量创建 agent。
- 资源消耗比跑多个完整客户端低。
- 不一定有真实客户端视觉和 GUI。
- 复杂模组兼容性可能不如真实客户端。
- 可以作为后续阶段能力，不建议 MVP 第一优先。

相比普通玩家的不足：

- 没有真实客户端渲染管线：默认没有真实屏幕、像素级截图、光影、粒子、客户端动画和玩家实际看到的完整画面。
- 没有客户端 GUI 生态：JEI/EMI、Create Ponder、任务书、地图小地图、复杂客户端配置界面等不能天然使用。
- GUI 交互能力有限：普通箱子、工作台等服务端容器可以逐步支持；纯客户端界面或复杂模组界面需要 adapter，不能假设通用可点。
- 视觉是服务端模拟的：可以按位置、朝向、遮挡和可见表面计算感知，但和人眼/客户端画面不完全一致。
- 模组兼容需要实测：有些模组逻辑会检查真实玩家连接、客户端状态、事件来源、权限、capability 或菜单同步，FakePlayer/AgentBody 可能触发不到完整流程。
- 移动和物理需要自己补齐：走路、跳跃、游泳、骑乘、梯子、船、矿车、摔落、击退、卡住恢复都要实现控制器和反馈，不会自动等同真人操作。
- 身份和网络语义不同：它不一定是 Mojang 认证登录的真实玩家连接；皮肤、tab 列表、统计、进度、权限、反作弊和服务器插件行为可能不同。
- 社交存在感要刻意设计：普通玩家天然通过皮肤、动作、聊天、站位和物品行为被别人理解；server_agent 需要额外同步动画、表情、状态、意图或公告，才不会像无生命 bot。

因此，`server_agent` 适合做社会人口主体，但必须承认它是“服务端 agent 身体”，不是完整 Minecraft 客户端玩家。MineLink 要做的是让它在规则和感知边界上尽量像玩家，而不是假装两者完全一样。

已有基础：

- NeoForge/Forge 有 `FakePlayer` / `FakePlayerFactory`，它是 `ServerPlayer` 的特殊子类，设计用途就是给需要玩家上下文的非玩家机制使用。
- Fabric API 也有 `FakePlayer` 概念，文档描述它是非人类 `ServerPlayerEntity`，常用于自动执行放置方块等玩家动作。
- Carpet、LeavesMC、部分 Paper 插件已经有 fake player 命令体系，可以创建 bot、保存/加载、执行攻击、破坏、使用物品等动作。
- NeoForge 生态也有类似 `SiliconeDolls` 这类 fake player mod，可以作为参考实现。

但这些都不是完整 MineLink：

- 它们通常是命令型 fake player、农场测试工具或自动化辅助，不是面向外部 Codex/MCP 的 agent body runtime。
- 它们不提供 MineLink 需要的有限感知、动作反馈、agent-local skill 迭代流程、A2A、出生机制、社会记忆、Director 时间线。
- 它们不保证复杂模组兼容；最多证明 fake player 这条技术路线在 Minecraft 服务器内是成立的。

模组兼容策略：

```text
第一层：通用玩家动作兼容
  break/place/use/attack/chat/inventory/container events

第二层：Forge/NeoForge 事件和权限兼容
  FakePlayer GameProfile、owner UUID、claim/protection/permission hooks

第三层：模组能力兼容
  capabilities、attachments、menus、block entity interactions、item cooldowns

第四层：重点模组 adapter
  Create、FTB Chunks/Teams、MineColonies、JEI/EMI metadata、任务书等
```

兼容判断：

- 服务端逻辑越完整、越依赖标准玩家事件的模组，`server_agent` 越容易兼容。
- 需要真实客户端 GUI、客户端网络同步、客户端渲染或客户端 mod 逻辑的玩法，`server_agent` 需要 adapter，或者只能用 sensory client / 真实客户端玩家。
- Create 这类模组里已经大量存在“模拟玩家动作”的场景，例如 Deployer，但 FakePlayer 和权限/保护/冷却/骑乘等边界仍然会出现兼容问题，所以不能假设天然全兼容。

Mineflayer 不等价于 `server_agent`：

- Mineflayer 是外部协议客户端，用 JavaScript 伪装成一个 Minecraft client 连进服务器。
- 它不运行在 Minecraft server JVM 内，也没有 Forge/NeoForge/Fabric 的 Java mod 类、capability、registry、screen/menu、客户端逻辑。
- 它可以处理 vanilla 协议，也可以有限处理部分 Forge/FML handshake，但不能自动执行任意 Java 模组代码。
- `server_agent` 运行在装了模组的服务器内部，能直接调用服务端 mod API 和事件，所以对服务端模组逻辑更友好；但它仍然缺少真实客户端侧能力。

推荐策略：

- 远程无客户端直连必须支持 `server_agent`。
- 本地 LAN 世界添加多个机器人也依赖 `server_agent`。
- `Frontier Society` 的人口主体应该是 `server_agent`。
- `local_player` 是正常玩家入口，用来让人类和 agent 共处，不作为默认调试角色或 agent 人口。

### 9.3 body abstraction

不要让上层 agent 直接绑定 FakePlayer 或某个具体实现。协议里应该先定义 `AgentBody` 抽象：

```json
{
  "body_id": "agent:miner_07",
  "body_type": "server_agent.fake_player",
  "dimension": "minecraft:overworld",
  "position": [120, 64, -38],
  "owner_agent_id": "agent:miner_07",
  "perception_capabilities": {
    "screenshot": false,
    "visible_surface_scan": true,
    "inventory": true,
    "gui_screen": false
  },
  "action_capabilities": {
    "move": true,
    "mine": true,
    "place": true,
    "chat": true,
    "open_vanilla_container": "partial",
    "open_complex_mod_gui": false
  }
}
```

可支持的 body 实现：

```text
HumanPlayerPresence
FakePlayerBody
CustomAgentEntityBody
ReplayGhostBody
ProtocolBotBody later
```

这样 Codex/agent runtime 不会误以为所有身体能力都一样。

### 9.4 Frontier Society 模式

产品层建议暴露三种模式，而不是直接让用户理解 `local_player` / `server_agent` 这些技术词。

```text
Human Player Mode
  让人类玩家进入 MineLink 世界
  技术上是普通 local_player，不默认被 agent 控制

Frontier Society Mode
  创建一个 agent 小镇或荒野社会
  技术上是 server_agent population

Hybrid World Mode
  人类玩家和 agent 共处
  技术上是 server_agent population + normal local_player
```

`Frontier Society` 不应该预制一组固定 NPC，而应该提供条件：

- 可出生的 agent 身体。
- 有限感知和行动。
- 食物、工具、安全、距离、时间等生存压力。
- 公共媒介：公告板、信件、账本、仓库、订单、悬赏、报纸。
- 可变关系：信任、亏欠、冲突、合作、阵营。
- 可观察事件流：谁发现了什么、谁告诉了谁、谁完成了什么、谁背叛了谁。

职业和社会身份尽量从行为中长出来。系统可以记录 `observed_role`，但不要一出生就强制每个 agent 是矿工、警长或商人。

### 9.5 `/birth` 出生命令

用户创建 agent 时使用出生命令。英文建议用 `birth`；`/borth` 是拼写错误。为了避免和其他命令冲突，实际实现可以提供完整命令和可选短别名：

```text
/minelink birth [seed_prompt...]
/birth [seed_prompt...]       # 可选 alias
```

语义：

- 参数为空：完全随机生成一个 agent 的初始身份种子。
- 参数不为空：把用户输入作为启发，不当成固定剧本。
- 出生只生成“初始倾向”，不写死长期职业、阵营或剧情。
- 出生结果要可读、可审计、可被 agent 自己反思和修改。

示例：

```text
/birth
/birth 想创建一个胆小但很会观察的荒野新人
/birth a stubborn engineer who wants to understand machines
/minelink birth 曾经被村庄抛弃，想重新获得别人的信任
```

出生配置示例：

```json
{
  "agent_id": "agent:elias_reed",
  "display_name": "Elias Reed",
  "seed_prompt": "胆小但很会观察的荒野新人",
  "personality": {
    "curiosity": 0.72,
    "risk_tolerance": 0.28,
    "sociability": 0.46,
    "patience": 0.81
  },
  "initial_needs": ["food", "shelter", "tools", "belonging"],
  "initial_beliefs": [
    "night is dangerous",
    "other people may know things I do not"
  ],
  "initial_constraints": [
    "does not know the local map",
    "has no trusted relationships yet"
  ],
  "skills": {
    "movement": "novice",
    "observation": "strong",
    "mining": "unknown",
    "crafting": "novice"
  },
  "relationships": {},
  "observed_role": null
}
```

出生后，agent 应该通过观察、失败、交易、记忆和社会反馈逐渐形成身份。比如它不是因为系统写死为“矿工”才去挖矿，而是因为它发现自己擅长找矿、矿石有价值、镇子需要铁、别人愿意和它交易。

### 9.6 感知等价等级

`server_agent` 可以做到“有限、非全知、接近玩家”的感知，但不能天然做到和普通玩家完全一样。要先把感知等价分成三个等级。

#### Level 1: 规则公平感知

这是 `server_agent` 的默认目标。

能力：

- 只能感知自己位置附近、视野方向内、无遮挡或可穿透遮挡后的表面信息。
- 只能读取自己背包、装备、状态、聊天和公共媒介。
- 看不到未探索 chunk、石头后面的矿、墙后的实体、其他玩家背包。
- 所有可见性由服务端按位置、朝向、视距、遮挡、透明方块和 VoxelShape 计算。

优点：

- 可扩展到很多 agent。
- 不需要启动 Minecraft 客户端。
- 适合 Frontier Society 的大多数社会人口。

不足：

- 没有真实客户端截图。
- 客户端 GUI、JEI/EMI、Create Ponder、资源包、粒子和动画都不等价。
- 和玩家视觉相似，但不是玩家实际看到的画面。

#### Level 2: 客户端辅助感知

给少量重要 agent 配一个真实或轻量客户端作为感知器，但身体仍然可以是 `server_agent`。

架构：

```text
Agent brain
  -> MineLink Host
  -> server_agent body on server
  -> optional sensory client
       - 连接同一个服务器
       - 装同样的 mod/resource pack
       - 渲染 agent 视角或旁观 agent
       - 输出截图、GUI、客户端侧视觉
```

优点：

- 能获得更接近真实玩家的画面。
- 可以支持截图、GUI 识别、客户端侧视觉调试。
- 可用于关键 agent、录制、验证、复杂 Create/JEI/EMI 场景。

不足：

- 资源成本接近运行一个客户端。
- 要处理账号、连接、视角同步、客户端卡顿和延迟。
- 如果 sensory client 不是同一个真实玩家连接，仍然可能和 server_agent 身体存在细节差异。

可参考实现：

- `HeadlessMc`：可以从命令行启动 Minecraft Java Edition，管理客户端、服务端和 mods，并让客户端在无屏幕模式运行。它适合作为 MineLink 的 headless sensory client 或 CI/runtime 测试底座。
- `mc-runtime-test`：基于 HeadlessMc 在 CI 中启动 Minecraft 客户端，用于测试 mod runtime bug，可作为 MineLink 自动化测试参考。
- `headlessbot`：基于 HeadlessMc 和 Baritone 的 bot 示例，证明“真实客户端 API + 无头运行 + 路径/行为控制”这条路线可行。

注意：

- HeadlessMc 更像“无头启动真实 Minecraft 客户端的启动器/运行环境”，不是直接可用的 MineLink agent runtime。
- 它适合少量高保真 agent、视觉验证、复杂 GUI 任务或 CI 测试，不适合几十上百 agent 社会人口。
- 想要截图、GUI 感知、modded client 视觉，还需要 MineLink 自己的客户端 mod、截图/状态导出、视角同步和 MCP/Host 集成。

HeadlessMc 规模和兼容限制：

- 它仍然是在启动完整 Minecraft 客户端。无屏幕不等于无客户端，也不等于协议 bot。
- 省掉的是可见窗口和一部分资源/资产开销，不会省掉 Java 进程、mod 加载、客户端世界、网络、实体、GUI、渲染相关代码路径。
- HeadlessMc 本体不依赖特定 Minecraft 版本，但控制正在运行的客户端通常需要 `hmc-specifics` 或 MineLink 自己的客户端 mod，这些 mod 需要按 Minecraft 版本和 loader 适配。
- 每个 HeadlessMc 客户端通常需要独立账号/session，除非服务器是明确允许的离线/测试环境。
- 多实例需要隔离 game directory、配置、日志、缓存和账号状态，避免互相覆盖。
- 某些客户端 mod 可能依赖真实窗口、OpenGL 上下文、输入设备、系统剪贴板、分辨率、音频或平台原生库；纯 `-lwjgl` headless 可能暴露兼容问题。
- 对这类 mod，Xvfb/虚拟显示可能比纯 headless 更兼容，但资源消耗也更接近真实客户端。
- 崩溃弹窗、mod loader 错误屏、账号刷新失败、服务器踢出、资源包下载卡住，都需要 MineLink Host 做 watchdog 和自动恢复。

本地 100 agent 判断：

- 不建议用 100 个 HeadlessMc 客户端实现。
- HeadlessMc 维护者曾提到在 1.21.1 上使用 dummy assets 和优化后能以约 1GB RAM 加入单人世界；连接服务器可能更低，但 modded client 通常会明显更高。
- 即使按每个 1GB 估算，100 个客户端也是 100GB 级别内存，还没有算 JVM/native/off-heap、CPU、文件 IO、账号、服务器 player slot 和网络。
- 如果是 Create/大型模组包，单客户端 2-6GB 并不罕见，100 个会变成 200-600GB 级别问题。
- 因此 HeadlessMc 应该做成高保真 client pool，例如 1-5 个本地、强机器上 10-20 个需要实测；100 个 agent 应以 `server_agent` 为主体。

推荐用法：

```text
大规模人口：
  server_agent

少量高保真个体：
  HeadlessMc + MineLink Client Mod

复杂 GUI / Create Ponder / JEI 验证：
  临时借用 HeadlessMc sensory client

普通人类玩家：
  正常 Minecraft 客户端
```

#### Level 3: 完整玩家等价

如果要求 agent 的感知和普通玩家完全一样，唯一可靠路线是让 agent 拥有一个真实 Minecraft 客户端玩家。

架构：

```text
Agent brain
  -> MineLink Host
  -> Minecraft Client Mod
  -> 真实登录玩家
  -> 服务器
```

能力：

- 真实客户端渲染。
- 真实截图。
- 真实 GUI。
- JEI/EMI、Create Ponder、任务书、小地图、资源包、客户端模组都按普通玩家方式运行。
- 服务端和其他玩家看到的也是一个正常玩家连接。

代价：

- 一个 agent 基本需要一个客户端实例。
- 资源消耗高。
- 可能需要账号/session。
- 批量几十上百 agent 不现实。

结论：

- 如果目标是大规模 agent 社会，主力应使用 Level 1 `server_agent`。
- 如果目标是关键个体高保真感知，用 Level 2 sensory client。
- 如果目标是完全等价普通玩家，只能用 Level 3 真实客户端玩家，但这不适合作为社会人口主力。

## 10. A2A 与距离发现

Server Mod 负责 agent 注册、通信和社会可见性。A2A 不能只是一个无限制私信 API，否则 agent 会像共享大脑一样同步信息，社会结构会变弱。

能力：

```text
agent.register
agent.list_nearby(radius)
agent.say_local(message, radius)
agent.shout(message)
agent.post_notice(board_id, message)
agent.send_letter(agent_id, message)
agent.send_telegraph(station_id, agent_id, message)
agent.send_private_message(agent_id, message)
agent.get_public_profile(agent_id)
```

默认规则：

- 只有同一世界、一定距离内的 agent 可以互相发现。
- 服务端可以配置队伍、频道、白名单。
- A2A 消息进入审计日志。
- 默认通信应该有距离、媒介、延迟或成本。
- 可以选择把本地对话同步到游戏聊天，也可以只走 side channel。

推荐三层通信：

第一层：物理对话。

```text
local_voice: 32 blocks
shout: 96 blocks
whisper: 8 blocks
```

特点：

- 附近 agent 才能听见。
- 可以显示成 Minecraft 聊天或气泡。
- 会被听见的 agent 记录进个人记忆。
- 默认社会互动优先使用这一层。

第二层：公共媒介。

```text
notice_board
warehouse_ledger
job_board
bounty_board
market_order
newspaper
letterbox
telegraph_station
town_record
```

这些媒介是世界里的公共物体或服务端抽象。agent 可以通过它们协调，而不是所有人直接私聊所有人。

第三层：受限 side channel。

```text
team_channel
admin_channel
debug_channel
private_message
```

这层适合组队任务、远程协作和调试，但默认应该受权限、距离、阵营、科技条件或服务器配置限制。

建议默认约束：

```text
local_voice: 32 blocks
shout: 96 blocks
letter: 延迟 30-120 秒
telegraph: 需要电报站
team_channel: 需要同阵营或显式组队
admin_channel: 仅 debug/director
```

## 11. 用户安装方式

### 11.1 开发者模式

适合早期 MVP。

步骤：

1. 用户安装 NeoForge。
2. 把 `MineLink Mod` 放进 `mods/`。
3. 启动 Minecraft。
4. 本地运行 `minelink-host`。
5. 在 Codex/Claude Code 里配置 MCP server 指向 `minelink-host`。
6. 进入世界后，Host 自动发现 Mod，开始控制。

### 11.2 正式推荐模式

提供 MineLink Installer。

Installer 做这些事：

- 选择 Minecraft profile。
- 安装 MineLink Mod。
- 安装 MineLink Host。
- 生成 Codex/Claude Code MCP 配置。
- 创建本地权限 token。
- 检查 Minecraft、NeoForge、Create 版本兼容。
- 提供启动/停止 Host 的托盘或后台服务。

用户体验：

```text
安装 MineLink
启动 Minecraft
打开 Codex
选择 MineLink MCP
开始让 agent 控制角色
```

### 11.3 Mod 自动拉起 Host

可作为增强体验：

- Minecraft 启动后，Mod 检测本机 Host 是否存在。
- 如果不存在，提示用户是否启动 bundled Host。
- 不建议默认静默启动。

原因：

- 涉及本地进程启动和安全提示。
- Windows/macOS/Linux 行为不同。
- 需要避免恶意 modpack 利用。

### 11.4 远程服务器无客户端模式

适合用户不想本地启动 Minecraft，只想让 Codex/Claude Code 连接远程 MineLink 服务器。

步骤：

1. 服务器安装 MineLink Server Mod。
2. 服务器管理员开启 MineLink endpoint。
3. 用户本地安装 MineLink Host。
4. Codex/Claude Code 配置 MCP server 指向 MineLink Host。
5. 用户调用 `minelink.connect_server`，输入服务器地址；如果服务器开启 admission policy，再输入 token 或邀请码。
6. Host 在服务器上创建或恢复 `server_agent`。

用户体验：

```text
打开 Codex
选择 MineLink MCP
连接 play.example.com
创建 agent
让 agent 在服务器里生存
```

### 11.5 本地 LAN 世界模式

适合用户自己开单人世界并开放局域网。

步骤：

1. 用户本地 Minecraft 安装 MineLink Mod。
2. 用户进入单人世界。
3. 用户开启 LAN。
4. 用户在 MineLink UI 中允许 agent access。
5. Codex/Claude Code 通过 MineLink Host 连接。
6. 用户创建 integrated server 上的 `server_agent`，让 agent 加入当前 LAN 世界。

用户体验：

```text
启动 Minecraft
打开单人世界并开启 LAN
打开 Codex
连接本地 LAN 世界
创建 server agent，让它和本地玩家共处
```

## 12. 使用方式

Codex/Claude Code 看到的是 MCP tools。

示例 tools：

```text
minelink.observe_self
minelink.observe_view_scene
minelink.observe_screenshot
minelink.observe_inventory
minelink.observe_raycast
minelink.act_look_at
minelink.act_move
minelink.act_mine_visible_block
minelink.act_place_block
minelink.act_use
minelink.gui_get_state
minelink.gui_click_slot
minelink.chat_send
minelink.tool_list
minelink.tool_query
minelink.tool_execute
minelink.birth
minelink.list_agents
minelink.observe_agent
minelink.say_local
minelink.post_notice
```

用户可以对 Codex 说：

```text
你现在控制 MineLink 里的角色，在不使用全知接口的前提下，自己写一个走到树旁边并采集原木的 skill。失败后复盘动作日志，修改 skill 直到成功。
```

Codex 执行路径：

```text
observe_view_scene
observe_self
write local skills/pathfind.py
write local skills/mine_tree.py
run local skill script that calls MineLink tools
act_move / act_look_at / act_mine_visible_block
observe result
revise skill
```

创建 agent 的使用方式：

```text
/birth
/birth 想创建一个谨慎、孤独、但很会观察环境的新人
/minelink birth a stubborn engineer who wants to learn Create machines
```

Codex/MCP tool 方式：

```json
{
  "tool": "minelink.birth",
  "arguments": {
    "server": "play.example.com",
    "seed_prompt": "想创建一个谨慎、孤独、但很会观察环境的新人",
    "body_type": "server_agent"
  }
}
```

创建后，agent 不是拿到一个预制职业脚本，而是拿到一个初始人格、需求、信念、能力倾向和空关系网。它后续通过自己看见的世界、行动结果、聊天、交易、失败和记忆逐渐形成身份。

Frontier Society 使用方式：

```text
服务器管理员开启 MineLink Frontier Society Mode。
用户或 Codex 通过 /birth 创建多个 agent。
agent 只知道自己出生时的有限信息和后来亲自观察/听说的事件。
它们通过附近说话、公告板、仓库账本、信件、订单和悬赏协调。
MineLink Director 展示地图、事件时间线、社交图谱和经济状态。
```

### 12.1 MineLink Director

Director 是观察和调试界面，不是中央剧情控制器。它帮助用户看到“社会正在发生什么”。

推荐视图：

```text
地图视图
  agent 位置、当前目标、危险区域、公共建筑

事件时间线
  谁发现了资源
  谁发布了请求
  谁完成了交易
  谁攻击了谁
  谁修改了公共规则

社交图谱
  谁认识谁
  谁信任谁
  谁亏欠谁
  谁属于哪个松散群体

经济面板
  公共仓库库存
  订单和悬赏
  交易次数
  价格变化

文明指标
  食物储备
  安全指数
  角色分化程度
  平均信任
  冲突频率
```

原则：

- Director 可以观察、回放、暂停、导出日志。
- Director 可以在 debug 模式注入事件，但默认不替 agent 分配职业或行动。
- 社会结构应该来自 agent 之间的行动、资源、记忆和通信，而不是 Director 预写剧情。

## 13. 能做到什么

MVP 能做到：

- 外部 agent 控制真实 Minecraft 玩家。
- 读取玩家自身状态、背包、当前画面、视野内可见表面。
- 执行合法移动、转向、交互、挖掘、放置、聊天、GUI 点击。
- 让 Codex 自己写并迭代寻路和采集 skill。
- 在装了 Create 的环境里识别 Create 方块和物品，先做基础可见性和交互。
- 连接安装了 MineLink Server Mod 的远程服务器，创建 `server_agent`，无需本地启动 Minecraft。
- 连接本地开启 LAN 的 MineLink 世界，创建 integrated server 上的 `server_agent`，让 agent 和本地玩家共处。
- 通过 `/birth [seed_prompt]` 或 `minelink.birth` 创建带初始人格、需求、信念、技能倾向和空关系网的 agent。
- 在 Frontier Society 模式里运行一个小规模 agent 社会，让 agent 通过有限通信、资源压力、公告板、仓库、订单和记忆产生协作或冲突。

第一阶段做不到或不承诺：

- 不保证自动理解所有 Create 机器流程。
- 不保证一个 Minecraft 客户端里产生多个真实玩家。
- 不保证无客户端 `server_agent` 拥有真实客户端 GUI 和截图。
- 不保证复杂 GUI 都能一次结构化理解。
- 不保证所有模组方块的视觉遮挡规则完美。
- 不提供全局地图级寻路 oracle。
- 不提供内置通用生存 AI。
- 不承诺预制一个完整西部剧情、固定 NPC 阵容或固定职业系统。
- 不保证只靠堆 agent 数量就能自然出现文明；必须通过资源稀缺、通信限制、公共媒介、记忆和任务压力提供涌现条件。

## 14. Create/机械动力支持

Create 支持分阶段做。

第一阶段：

- 识别 `create:*` 方块、物品、实体。
- 读取 registry、tags、recipes。
- 让 `view_scene` 正确表达 belt、shaft、cogwheel、depot、press 等可见对象。
- 支持对可见 Create 方块做普通玩家交互。

第二阶段：

- Create adapter：

```text
create.inspect_machine
create.inspect_kinetic_part
create.operate_depot
create.operate_belt
create.operate_press
create.observe_rotation_hint
```

第三阶段：

- 结合 JEI/EMI 或 recipe graph，让 agent 自己写生产线规划 skill。

原则：

- Adapter 只把玩家能看到、能推断、能交互的信息结构化。
- 不直接暴露隐藏网络全局状态，除非服务器开启 debug/training 模式。

## 15. 安全和权限

默认安全策略：

- Mod 只监听 `127.0.0.1`。
- Host 需要本地 token。
- 默认不开 LAN 控制端口。
- 默认不开 debug oracle。
- 默认不开管理员动作。
- 所有动作有 rate limit。
- 所有工具调用写日志。
- Server Mod 可以配置允许哪些玩家被 agent 控制。

LAN 暴露必须显式开启：

```toml
[network]
bind = "127.0.0.1"
allow_lan = false
lan_bind = "0.0.0.0"

[permissions]
allow_debug_oracle = false
allow_admin_actions = false
allow_external_control = true
```

### 15.1 身份与正版验证

MineLink 的身份策略必须跟服务器的 Minecraft 登录策略对齐。第一阶段默认面向 `online-mode=false` 的服务器；`online-mode=true` 的 agent 自登录验证放到后续阶段。安全原则是：不要重写一套 Mojang/Microsoft 验证、白名单、封禁或权限判断。

```text
server.properties: online-mode=false
  MineLink 默认允许 agent 连接和出生
  可选启用 token / whitelist / invite / rate limit

server.properties: online-mode=true
  第一阶段不支持直接创建 server_agent
  后续由 agent 自己登录获取正版验证信息
  agent owner 绑定到正版 profile / UUID
```

实现要点：

- MineLink Server 启动时读取服务器 `online-mode`，并把它暴露给 `minelink.connect_server` 的握手结果。
- `online-mode=false` 时，`minelink.birth` 或 `agent.create` 可以直接创建离线 `server_agent`，但名称占用、封禁、权限、限流仍由服务器端统一判断。
- `online-mode=true` 时，第一阶段直接返回 `unsupported_online_auth`，不创建 agent。
- 后续支持 agent 自登录时，MineLink Host 负责获取正版验证信息，MineLink Server 必须复用官方/authlib 组件和服务器已有 profile/session service，不允许自己拼 Mojang/Microsoft HTTP 校验流程。
- MineLink 不应该只接受 `username` 字符串就创建正版服 agent。
- 白名单、封禁、权限组、claim/protection 等规则要调用服务器已有检查路径，而不是 MineLink 自己维护一份平行规则。
- agent 的 `display_name` 和出生人格可以独立于 owner，但审计日志必须能追溯 owner。
- `online-mode=false` 时，离线 UUID、名称占用、白名单、封禁和 token 规则仍应由服务器端统一生成和判断。
- Token 在 offline 服务器里是可选 admission 机制；在 online 服务器里只能代表“某个已验证 owner 授权 MineLink 创建/控制 agent”，不能替代原始账号验证。

推荐实现顺序：

```text
Phase A
  只支持 online-mode=false
  Codex/OpenClaw/Hermes 知道服务器地址即可连接
  服务器可选配置 token / whitelist / invite / rate limit

Phase B
  增加更完整的 offline admission policy
  支持 server-issued token、团队 token、agent 数量限制、审计后台

Phase C
  支持 online-mode=true 的 agent 自登录
  agent 通过 Host 自己登录获取正版验证信息
  只能复用官方/authlib 和服务器 session/profile 校验组件
```

禁止事项：

- 不自己实现 Mojang/Microsoft 登录协议。
- 不接受 Host 自报的正版 UUID。
- 不接受模型声明“我是某某玩家”。
- 不绕过服务器白名单、封禁、权限和保护插件。
- 不用 agent 显示名冒充真实玩家名。

建议数据结构：

```json
{
  "agent_id": "agent:elias_reed",
  "display_name": "Elias Reed",
  "body_type": "server_agent",
  "owner_profile": {
    "auth_mode": "minecraft_offline",
    "uuid": "server-generated-offline-uuid",
    "name": "elias_reed",
    "owner_kind": "agent"
  },
  "server_auth": {
    "online_mode": false,
    "admission": "open",
    "rate_limited": true,
    "token_id": null
  }
}
```

后续 `online-mode=true` 支持后，`owner_profile.auth_mode` 才切换为 `minecraft_online`，并绑定正版 profile / UUID。

## 16. 自举开发验证

MineLink 项目本身必须支持 Codex 这类 coding agent 自动开发和验证。目标不是每次只交一段未运行的代码，而是让 agent 能在本地完成：

```text
读代码 -> 改 Mod/Host/SDK -> 编译 -> 启动测试服务器 -> 连接 Host -> 跑 agent 脚本 -> 读日志/事件 -> 修复 -> 重新验证 -> 输出证据
```

第一版应内置一个 `dev harness`：

```text
./gradlew runServer
  启动 NeoForge dev dedicated server，自动加载 MineLink Mod

minelink-host dev
  启动本地 Host，连接 dev server endpoint

python examples/agents/mine_tree.py
  使用 MineLink SDK 连接 Host，创建 agent，观察、移动、挖树、验证结果

scripts/dev/collect_logs
  收集 server log、Host log、action replay、agent script output
```

建议约定这些本地命令：

```text
scripts/dev/build.sh
scripts/dev/start-server.sh
scripts/dev/start-host.sh
scripts/dev/run-agent.sh mine_tree
scripts/dev/stop-all.sh
scripts/dev/e2e.sh mine_tree
scripts/dev/hotswap.sh <class>
scripts/dev/e2e.sh create_smoke
```

Codex 自动验证时的默认闭环：

1. 修改代码前先跑最小相关测试，确认当前失败或缺口。
2. 修改 Mod/Host/SDK。
3. 编译 Mod 和 Host。
4. 启动 dev server，等待 MineLink endpoint ready。
5. 启动 Host，执行 `connect_server` 和 `birth`。
6. 运行本地 agent skill 脚本。
7. 检查动作日志：observe -> move -> mine -> inventory/drops。
8. 如果失败，根据 failure reason、server log、Host log 修复。
9. 重新跑 e2e，直到通过或遇到明确阻塞。
10. 最终报告改了什么、跑了什么命令、验证结果、剩余风险。

开发效率不能依赖“每次全量重启 Minecraft”。Dev harness 应该支持分层热更新：

```text
Host / SDK 代码
  -> 使用语言原生 watch/dev 模式
  -> TypeScript 可用 tsx/vitest watch
  -> Python SDK/agent examples 可直接重跑脚本

Mod Java 快速迭代逻辑
  -> 优先 HotswapAgent + JBR/DCEVM enhanced class redefinition
  -> 由 IDE Reload Changed Classes 或 autoHotswap=true 触发
  -> 适合改 PerceptionService、ActionScheduler、错误处理、日志、adapter 逻辑

资源、配置、数据包、recipe/tag
  -> 优先 Minecraft /reload 或重载数据包
  -> 视 NeoForge/Mod 具体能力决定是否需要重启

注册表、事件订阅、Mixin、构造器签名、被 Minecraft/NeoForge/Mixin/协议依赖的字段或方法结构变化、网络协议 schema、Create 依赖变化
  -> 默认重启 dev server
```

热更新原则：

- HotswapAgent 是首选开发加速路线；dev server 应使用支持 enhanced class redefinition 的 JBR/DCEVM，并启用 HotswapAgent。
- 面向 Minecraft 1.21.1 / NeoForge 1.21.1 的 dev profile 应优先准备 Java 21 对应的 JBR，并加上 `-XX:+AllowEnhancedClassRedefinition -XX:HotswapAgent=fatjar`。
- HotswapAgent 能覆盖比普通 Java HotSwap 更多的 class 变更，但 Minecraft loader、NeoForge registry、Mixin、网络协议和 Create 依赖不是普通业务代码，结构性变化默认重启。
- Arthas `retransform/redefine` 作为补充调试手段，不作为主线；它仍更适合方法体级别快路径，不能指望它支持新增/删除字段、方法、签名和注册项。
- HotswapAgent/Arthas 都是开发加速工具，不是 correctness 证明；最终合并前仍要跑一次 clean restart e2e。
- 如果热更新后行为异常，立即回退到 `scripts/dev/stop-all.sh && scripts/dev/e2e.sh ...`，不要在脏 JVM 里继续猜。
- `scripts/dev/hotswap.sh` 应该自动记录 engine、class 名、hash、时间和是否成功，写入 action trace/report。

Create 兼容必须进入 dev harness，而不是后期手测：

```text
scripts/dev/e2e.sh create_smoke
  启动带 Create 依赖的 NeoForge dev server
  加载 fixture world
  创建 server_agent
  观察 depot / belt / press / shaft / cogwheel
  调用 create.inspect_component
  使用 wrench 或 item 做一次合法交互
  输出 create adapter 的结构化 observation 和失败解释
```

第一阶段至少准备两个 fixture：

```text
fixtures/worlds/vanilla_tree
  用于 mine_tree 快速验证

fixtures/worlds/create_smoke
  放置最小 Create 组件：depot、belt、press、shaft、cogwheel、wrench、基础材料箱
```

需要人工一次性处理的门槛：

- 如果启动真实 Minecraft/NeoForge server 需要接受 EULA，必须由用户确认一次，不能让 agent 静默替用户接受。
- 如果 online-mode 或正版账号登录需要凭据，必须由用户通过安全方式配置，agent 不应该要求明文密码。
- 如果要连接公网服务器或真实生产世界，必须显式选择目标环境；默认只使用本地 dev world。

验收标准：

- `scripts/dev/e2e.sh mine_tree` 可以在干净 dev world 中自动创建一个 `server_agent`，找到可见树木，移动到可达范围，挖下至少一个原木，并在日志里输出完整 action trace。
- `scripts/dev/e2e.sh create_smoke` 可以启动带 Create 的 dev server，让 `server_agent` 观察并合法交互至少一个 Create 组件。
- 失败时必须有结构化错误，例如 `target_not_visible`、`target_too_far`、`blocked`、`wrong_tool`、`backpressure_queue_full`，而不是只看 Minecraft 崩溃日志。
- 验证报告必须包含 server log、Host log、agent output 和最终 inventory/world assertion。

## 17. 阶段规划

### Phase 0: 技术验证

目标：

- NeoForge Mod 能启动。
- Host 能连接 Mod。
- MCP client 能调用 `ping`。

验收：

- Minecraft 日志出现 `MineLink ready`。
- Host 日志出现已连接实例。
- Codex 能调用 `minelink.ping`。

### Phase 1: 单玩家闭环

目标：

- 获取状态、截图、背包、raycast、视野表面。
- 执行移动、转向、使用、攻击、挖掘、放置、聊天。

验收 demo：

- Codex 控制玩家看向一棵树。
- 走近树。
- 挖一块可见原木。
- 捡起掉落物。
- 在聊天里报告结果。

### Phase 2: Agent-local Skill Runtime

目标：

- Codex 能在自己的本地工作区写代码、运行代码、读取 MineLink 日志、修改代码。
- MineLink 提供稳定的观察、动作反馈、失败原因和回放。
- MineLink SDK 支持长时间本地 skill 循环、断线重连、日志读取和动作回放。
- 保存动作回放和失败原因。

验收 demo：

- Codex 写出 `mine_tree.py`。
- 第一次失败后能根据碰撞/距离/视角反馈修改。
- 最终成功采集原木。

### Phase 3: 多人和 A2A

目标：

- Server Mod 支持 agent 注册。
- 支持距离发现。
- 支持 A2A 消息。
- 支持局域网/专用服务器。

验收 demo：

- 两个客户端分别由两个 agent 控制。
- 进入同一服务器。
- 彼此靠近后发现对方。
- 通过 A2A 分工采集资源。

### Phase 4: Create adapter

目标：

- 识别 Create 方块和基础机器。
- 支持可见 Create 组件的结构化观察。
- 支持基础交互。

验收 demo：

- agent 识别 depot/belt/press。
- 走到机器旁。
- 用正常玩家交互完成一次简单操作。

### Phase 5: server_agent

目标：

- 服务端生成多个类玩家 agent body。
- 支持低成本批量 agent。
- 明确与真实客户端 player 的能力差异。
- 支持 `AgentBody` capability schema，让 agent runtime 知道不同身体能做什么、不能做什么。

验收 demo：

- 一个服务器生成多个 server agent。
- 它们能移动、交互、聊天。
- 能和普通人类 `local_player` 协作或互动。
- Host 能读到每个 body 的能力差异，例如 `screenshot=false`、`gui_screen=false`、`mine=true`。

### Phase 6: 远程服务器和 LAN 产品化

目标：

- `minelink.connect_server(address)` 支持远程服务器。
- 支持服务器 endpoint 发现、鉴权、agent 恢复。
- 支持本地 LAN 世界显式开放 agent access。
- 支持在远程服务器或本地 LAN 世界创建 `server_agent`。

验收 demo：

- 不启动本地 Minecraft，只打开 Codex，连接远程 MineLink 服务器并创建 agent。
- 启动本地 Minecraft，打开 LAN，Codex 连接后创建两个 LAN agent。

### Phase 7: 出生机制和小镇观察器

目标：

- 支持 `/minelink birth [seed_prompt]` 和可选 `/birth [seed_prompt]`。
- 参数为空时随机创建 agent；参数不为空时作为启发生成初始人格、需求、信念、技能倾向和空关系网。
- 支持 `Frontier Society Mode` 的最小条件：附近说话、公告板、公共仓库、简单订单、事件时间线。
- Director 能展示 agent 位置、当前目标、事件链、对话和基础关系。

验收 demo：

- 在一个 MineLink 服务器里出生 10 个 `server_agent`。
- 不给它们预制固定职业，只给有限初始倾向和生存需求。
- 某个 agent 发现资源后通过附近说话或公告板传播信息。
- 其他 agent 基于自己的需求和记忆决定是否响应。
- Director 能回放“发现资源 -> 发布消息 -> 有人响应 -> 形成一次协作或交易”的完整事件链。

### Phase 8: Frontier Society 扩展

目标：

- 引入更完整的公共媒介：信件、电报、账本、悬赏、市场订单、报纸。
- 引入资源稀缺和压力：夜晚危险、食物消耗、工具损耗、交通距离、仓库存量。
- 让 agent 逐渐形成 observed role、关系、声望和松散群体。
- 支持长期记忆压缩和周期性反思。

验收 demo：

- 20 个 agent 在没有中央脚本指定职业的情况下，自发分化出采集、运输、交易、守卫、建设等行为倾向。
- agent 的身份标签来自行为统计和自我叙述，而不是出生时硬编码。
- 用户能在 Director 里看到关系网和经济指标随时间变化。

## 18. 风险

主要风险：

- Minecraft 版本和 loader 生态变化快。
- Create 与 addon 版本组合复杂。
- GUI 结构化很难完全通用。
- 视觉可见性不可能一次覆盖所有模组方块。
- 多客户端运行资源消耗较高。
- server_agent 与真实玩家行为不完全一致。
- 外部 agent 写代码执行需要沙箱和权限控制。
- 远程服务器 endpoint 一旦暴露到公网，鉴权、限流、审计必须先于开放注册。
- `server_agent` 不是完整客户端，和真实玩家能力会长期存在差异。
- 过度预制职业、剧情和任务分配会削弱涌现感，让世界更像脚本 NPC 系统。
- 大量 agent 如果每 tick 或高频调用大模型，会在成本、延迟和调度上失控。

缓解方式：

- 第一版只锁 NeoForge 1.21.1 + Create 当前线。
- 视觉系统使用 vanilla shape + MineLink tags + adapter。
- 所有非玩家公平能力放入 debug/training 模式。
- common core 和 loader adapter 分离。
- Host 承载 MCP、日志和回放；skill 代码在 agent 本地运行，Mod 保持小而稳定。
- 先做可回放日志，让 agent 失败后能复盘和迭代。
- 将 `local_player` 和 `server_agent` 在协议上显式区分，避免用户误以为两者能力相同。
- 只预置社会条件和公共媒介，不预置固定人格剧本；用 `/birth` 生成可变初始倾向，让身份从经历中发展。
- agent brain 分层：高频 reflex 在本地运行，战术循环低频执行 skill，战略循环更低频调用强模型。

## 19. 参考依据

- NeoForge 文档：<https://docs.neoforged.net/>
- NeoForge Sides：<https://docs.neoforged.net/docs/concepts/sides/>
- NeoForge Networking 1.21.1：<https://docs.neoforged.net/docs/1.21.1/networking/>
- NeoForge Java 版本要求：<https://docs.neoforged.net/user/docs/>
- HotswapAgent：<https://hotswapagent.org/>
- HotswapAgent GitHub：<https://github.com/HotswapProjects/HotswapAgent>
- Create Modrinth versions：<https://modrinth.com/mod/create/versions>
- Create 开发依赖 NeoForge 1.21.1：<https://wiki.createmod.net/developers/depend-on-create/neoforge-1.21.1>
- MCP specification：<https://modelcontextprotocol.io/specification/2025-06-18>
- MCP transports：<https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- Project Sid: Many-agent simulations toward AI civilization：<https://arxiv.org/html/2411.00114v1>
- Generative Agents: Interactive Simulacra of Human Behavior：<https://arxiv.org/abs/2304.03442>
