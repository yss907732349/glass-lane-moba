# 第三方内容说明

## Kenney Tiny Dungeon 1.0

- 作者：Kenney（https://kenney.nl/）
- 官方来源：https://kenney.nl/assets/tiny-dungeon
- 许可：Creative Commons Zero 1.0（CC0-1.0），允许个人、教育及商业用途、修改和再分发，不要求署名。
- 许可证原文：`public/assets/kenney-tiny-dungeon/original/License.txt`
- 官方许可链接：https://creativecommons.org/publicdomain/zero/1.0/
- 下载日期：2026-11-25（中国标准时间）
- 保留的原始压缩包：`public/assets/kenney-tiny-dungeon/source.zip`
- 原包 SHA-256：`c109438ab06f65fd80f9b2686a4cf9c7c11dc64444b47333ec71d602f8bb5fc7`

当前骑士取自 `Tiles/tile_0097.png`，法师取自 `Tiles/tile_0084.png`，近战／远程小兵取自 `tile_0110.png`、`tile_0111.png`。武器和盾牌图来自同一包。

`public/assets/heroes/knight.png` 和 `mage.png` 是原始透明 16×16 精灵的兼容路径；`hero-*-sheet.png` 是在透明 32×32 网格中添加轻微上下移动、攻击位移及独立武器图层的衍生动作图。它们不是原包提供的完整方向动画。衍生素材也按 CC0-1.0 提供，生成说明和帧索引见 `public/assets/heroes.manifest.json`，可用 `prepare_kenney_assets.py` 重建。

游戏角色名称、数值、技能逻辑和联机玩法为本项目实现，没有复制商业 MOBA 的角色立绘、模型、音效或游戏代码。

## 开源项目调研

项目曾检查 UNION OpenSource MOBA、Prime World、Ragin' Mages 的官方仓库及说明，仅用来判断可行性；没有将这些仓库的源代码或素材并入本项目。调研结论和链接见 `docs/open-source-research.md`。这些项目的许可不因此成为本项目的许可。

## Phaser runtime

The MIT License (MIT)

Copyright (c) 2024 Richard Davey, Phaser Studio Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


## ws runtime

Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
Copyright (c) 2013 Arnout Kazemier and contributors
Copyright (c) 2016 Luigi Pinca and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

