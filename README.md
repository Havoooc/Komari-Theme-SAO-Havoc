# Komari-Theme-SAO-Havoc

基于 `Komari-Theme-SAO` 深度定制并独立维护的 Komari 监控面板主题（已移除上游自动更新关联，防止覆盖定制功能）。

## 定制特性

- **三网去程 / 回程原位融合** (`dist/assets/komari-sao-routes.js`, `komari-sao-routes.css`)
  - 适配 `classic` 一体白卡模式，在底部三网延迟 / 丢包行原位嵌入去程 `↗` 与回程 `↙` 路由芯片（电信 / 联通 / 移动）。
  - 支持虚线边框提示末跳未完整响应（保留完整运营商名称与路由短名不截断），悬停可查看完整探测时间、来源与原因。
- **Hero 消耗流量热力图** (`dist/assets/komari-sao-heatmap.js`, `komari-sao-heatmap.css`)
  - 替换顶部左侧 6 张小卡片为 38 周 × 7 天（周一至周日）经典宝石蓝日历热力图，与右侧「集群状态」卡片底边齐平。
  - 接入 `/api/rpc2` (`public:queryMetrics`) 真实流量数据与浏览器 `localStorage` 历史持久化，支持 **每天 / 每周 / 累计总量** 切换与悬停详情气泡。
- **Google Drive 周一备份同步轨道**
  - 在热力矩阵上方集成每周一对齐的同步圆点轨道（接入 `/routes/api?kind=backup`），绿色成功 / 红色失败，悬停可查看归档大小与执行时间。
- **双模式与响应式**
  - 完整适配浅色（Light）与深色（Dark）模式，桌面端与移动端（`393px` / `320px`）零横向溢出。
