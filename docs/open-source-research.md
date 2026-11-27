# 0.2.0 采用的角色玩法来源

已实际移植 MIT 开源 Claude of Legends 的 Dain/Fenn/Ashvyn/Sylra 四名角色，固定提交和完整适配见 [source-heroes.md](source-heroes.md)。下文保留最初原型的调研记录，不代表0.2.0仍使用自拟英雄数值。

# 单线 MOBA 开源调研与当前素材选择

检查日期：2026-11-25。以下结论来自对应仓库的 README、许可文件及素材官方网站，并非只凭仓库标题判断。

| 项目 | 已核对的内容 | 适合程度与本次决定 |
| --- | --- | --- |
| [UNION OpenSource MOBA](https://github.com/tammukul/UNION-OpenSource-MOBA) | README 明确包含移动、战斗、防御塔、AI、局内商店，使用 Unity/C#、Photon PUN、PlayFab；仓库许可证为 Apache-2.0。README 称其模型、预制体、音效、代码可用于自己的游戏，但含多个第三方 SDK，需要逐项核对。 | 是真实 MOBA 示例，但偏移动双摇杆，依赖旧 Unity/Photon/PlayFab/Facebook 流程。为做轻量透明桌面、标准鼠键与单线房间，直接移植会增加依赖和维护量。本次没有复制代码或美术。 |
| [Prime World](https://github.com/nival/Prime-World) | 真实商业 MOBA 战斗部分开源，C++ 自研引擎，含英雄、塔、小兵、编辑器和客户端。官方 [README](https://github.com/nival/Prime-World/blob/main/README.md) 明确提醒它使用 [特殊许可](https://github.com/nival/Prime-World/blob/main/LICENSE.md)，禁止商业用途，限社区、学习与研究等授权范围。 | 内容完整，但不是可随意商用的通用素材库，而且体量及运行架构与本项目差异大。本次没有下载或抽取其英雄和素材。 |
| [Ragin' Mages](https://github.com/ignacioxd/ragin-mages) | README 为 Phaser 3 的小型 MOBA，有单人／联机设想；目录存在 knight_hero、mage_hero 等动画图。检查仓库树未找到明确的仓库 LICENSE，GitHub license 字段为空。 | 技术方向接近，但不能把“公开仓库”直接当作明确许可。未导入代码或骑士／法师动画。 |
| [Kenney Tiny Dungeon 1.0](https://kenney.nl/assets/tiny-dungeon) | 官网和下载包 `License.txt` 均写明 CC0，允许商业、修改和再分发。包内 132 个透明 16×16 图块，包括骑士、法师、怪物、装备、地砖。 | 本次实际采用：从官网直接下载，导入骑士、法师及小兵，保留官方原包和许可。角色美术先做占位，未来可以替换原创素材。 |

## 当前实现边界

当前采用“可替换的 CC0 英雄美术 + 本项目独立规则与联机实现”。不是直接套用一个完整的现成 MOBA：地图、兵线、补刀经济、装备购买、三个技能、塔和基地、复活与房间同步由本项目实现，避免把旧引擎或不明确许可一并带进来。

Kenney 的两位英雄原图是静态像素精灵，非高精度 3D 模型。2.5D 的空间感由地图斜向投影、角色落地影子、遮挡顺序和技能特效呈现。附带的小幅动作衍生图仅用于提升可读性，完整八方向英雄动画后续可替换。

## 已落盘素材

- `public/assets/heroes/knight.png`：透明骑士，16×16。
- `public/assets/heroes/mage.png`：透明法师，16×16。
- `public/assets/hero-knight-sheet.png`、`hero-mage-sheet.png`：128×96 透明序列图，单帧 32×32，4 列 3 行；第 1 行静止、第 2 行行走、第 3 行攻击，详细速率见 manifest。
- `public/assets/minion-melee.png`、`minion-ranged.png`：透明小兵。
- `public/assets/kenney-tiny-dungeon/source.zip`：官方原包（约 96KB），方便追溯来源。
- `public/assets/kenney-tiny-dungeon/original/License.txt`：原许可证，不修改。

建议后续原创时保持角色脚底锚点与技能判定独立，替换美术不用重做对局规则。
