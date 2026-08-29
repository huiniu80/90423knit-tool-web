# 编织图形转针法工具

一个将真实厘米尺寸下的几何图形离散成编织针格，并生成逐行加减针方案的纯前端工具。

## 已实现功能

- 编织小样密度和真实画布尺寸换算。
- 矩形、三角形、圆、椭圆与 Polygon 多边形。
- 图形创建、选择、拖动、缩放与精确 cm 属性编辑。
- Polygon 描点闭合、节点拖动、双击边添加节点和删除节点。
- 自定义贝塞尔路径：开放/闭合路径、边中点弯曲、独立控制手柄和曲线插点。
- 真实比例网格、缩放、平移、轮廓/针格/对比三种显示模式。
- Center、Inside 和 Outside 三种离散策略。
- Bottom-Up 和 Top-Down 逐行编织计划，包含针数、区间和左右加减针。
- 撤销/重做、JSON v2 导入/导出（兼容 v1）和分离区域警告。

## 本地开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run test:run
npm run build
```

## Core 分层原则

所有核心业务数据使用 cm；px 只能出现在未来的 UI/渲染层。`src/core` 不得依赖 Vue、Pinia、Konva、DOM 或 Canvas。

# -
