# 桌面客户端与线上房间服务

Windows EXE 是透明桌面客户端；公开的 Node.js 服务负责房间、战斗、技能与胜负。客户端在本机绘制画面，通过 HTTPS / WSS 连接同一个线上服务，朋友无需处于同一局域网。本地内置服务继续支持离线练习与局域网备用连接。

MOBA 使用 `glass-lane-v1` 协议，不能连接斗地主的 `https://glass-landlord.onrender.com` 服务。部署时创建独立服务，保留原斗地主服务和配置。

## 当前线上服务

https://glass-lane-moba.onrender.com 已通过实际公网双人建房、开局、移动与技能升级、断线重连和房间清理验收。0.1.2 Windows 客户端通过 desktop/client-config.json 默认连接此地址。Render 免费服务空闲后可能休眠，首次连接需等待唤醒。

## Render Free

本目录的 `render.yaml` 与 `Dockerfile` 描述一个免费、单实例的 Docker Web Service，建议服务名为 `glass-lane-moba`。实际地址以 Render 创建结果为准，不能仅凭服务名推定已经上线。

- 独立仓库：将本目录作为仓库根，Dockerfile 和上下文均为 `.`。
- 原有 monorepo：在新服务设置中将 Root Directory 设为 `透明单线MOBA`，Dockerfile 为 `./Dockerfile`，Docker Context 为 `.`；不要修改既有斗地主服务的仓库路径或运行命令。
- Health Check Path 为 `/health`，只运行一个实例，使用平台注入的 `PORT`。
- `NODE_ENV=production`。默认监听 `0.0.0.0`，平台代理需支持 WebSocket Upgrade。

Docker 的构建阶段使用 Node.js 24 和 pnpm 11.25.0，安装前设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，因此不会下载桌面 Electron。最终运行阶段仅安装锁定的 `ws` 依赖，并复制打包后的 `build`、`dist` 和许可说明，不包含 Electron、浏览器、开发工具或桌面窗口。

若配置 `ALLOWED_ORIGINS`，请同时允许客户端页面的实际来源、公开服务自己的 HTTPS 来源，以及需要的备用网页来源；留空时仍通过房号、密码和服务端指令验证控制房间访问。不要在该变量中填房间密码。

Render Free 可能在空闲后休眠，首次连接需等待唤醒；重启会清空内存房间。本配置不会自动开通付费实例。

## 普通服务器或本地容器

```text
docker build -t glass-lane-server .
docker run --rm -p 10000:10000 -e PORT=10000 glass-lane-server
```

也可在 Node.js 24 环境直接运行：

```text
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile --prod=false
pnpm build
pnpm start
```

构建安装期间设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，服务运行期可设置 `PORT`。反向代理对外使用 HTTPS，并将 `/ws` 转发为 WebSocket；客户端输入或内置公开的 HTTPS 根地址，会自动转换成 WSS。

## 发布验收

1. `/health` 返回 `ok: true`、`game: "glass-lane"`、`protocol: "glass-lane-v1"`。
2. 公开页面的入口、JS、CSS 和两位英雄图片返回成功，错误页面不能冒充健康检查。
3. 两个独立远程连接创建自己的随机密码测试房、加入、准备并开始，验证双方指令和状态；断线重连恢复原座位，主动退出后清理测试房。
4. 新客户端预置实际服务地址；不依赖用户手动填写 localhost 或房主 IP。透明、置顶、缩放和点击行为仍由 Windows 客户端提供。
5. Windows 免安装版在隐藏窗口诊断模式中加载实际打包资源，确认大厅、角色资源和桌面桥接初始化成功，再交付 EXE。禁止自动弹出可见测试窗口。

配置文件就绪不等于线上发布完成。实际公开地址及线上联机结果须以本次部署记录为准。
