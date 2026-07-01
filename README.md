# 年报鉴证台

基于 `qwen3.7-plus` 的企业年度报告结构化分析智能体。

## 公开页面

GitHub Pages：

`https://adcyazhou.github.io/-/index.html`

在线上传分析：

`https://fragrances-agent-melbourne-coaches.trycloudflare.com`

GitHub Pages 展示项目说明与真实模型验证结果，在线交互请求由 Cloudflare Quick Tunnel 转发至受控后端。API Key 仅存在于后端环境中，不会进入网页或仓库。该临时地址依赖本机服务和隧道进程持续运行，重启隧道后地址可能变化。

## 核心能力

- 三大财务报表字段提取
- 跨年变动额与变动率计算
- 管理层及治理结构变动分类
- 审计意见定位
- PDF 文件名与页码证据
- 简体、繁体和英文术语归一

## 验证

项目使用比亚迪 2024 年和 2025 年官方年度报告作为固定测试样本，共 659 页。20 项自动化测试覆盖 PDF 解析、证据检索、年份路由、API 参数和前端密钥隔离。

课程研究项目，不构成审计意见或投资建议。
