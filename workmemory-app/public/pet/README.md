# Mascot 资源说明 (Web 开发占位目录)

本目录用于 Web 模式（纯浏览器 / `vite dev`）下加载桌面伙伴 Spritesheet 的占位说明。
**实际生产资源位于 `src-tauri/resources/pet/`**（1~9 共 9 套形象），通过 Tauri 2.x
`assetProtocol`（`asset://localhost/pet/<id>/spritesheet.webp`）暴露给前端。

## Web 模式行为

- Web 浏览器无法访问 `asset://localhost` 协议，因此 `MascotSprite` 组件在
  非 Tauri 环境下降级为 `/pet/<mascotId>/spritesheet.webp`（即尝试读取本目录）。
- 由于本目录未提供真正的 Spritesheet，Web 开发时 Mascot 会渲染为空白透明方块；
  这是预期行为，**不影响 Tauri 桌面包内的真实渲染**。
- Mock 挡板 (`src/src-tauri/mock.ts`) 的 `get_mascot_id` 默认返回 `1`，
  对应 `src-tauri/resources/pet/1/spritesheet.webp`。

## 真实资源

```
src-tauri/resources/pet/
├── 1/  boba       (默认形象)
│   ├── pet.json
│   └── spritesheet.webp
├── 2/  ...
└── 9/
```

每个形象的 `pet.json` 描述布局（rows=9, rowHeight=208, cellWidth=192）与 9 个动画状态
（idle/walk/run/sleep/sit/jump/fall/drag/special）。前端 `MascotSprite.tsx` 中的
`CELL_W=192`、`CELL_H=208`、`STATE_ROWS` 与该布局严格一致。

## 添加 Web 测试图

如需在 Web 模式下查看动画，可将某形象的 `spritesheet.webp` 复制为
`public/pet/<id>/spritesheet.webp`，组件会自动加载。
