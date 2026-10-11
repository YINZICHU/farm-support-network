# 农忙支援 Network / Farm Support Network

一个可独立运行的村庄短时农活协调工具模板。居民无需账号，由负责人核实登记；管理员通过一次性邀请分配按村权限。提供方技能、通常时段、具体可用时间与已占用排班生成候选，但系统不会自动接单。任务、费用、交接、验收与回访分别记录。

源自殷子楚 Yin Zichu 的“农时有医 / Care in Farming Seasons”项目。此仓库是独立软件模板，不是原项目主网站或正式后台，不连接原实例。复制模板不代表已开展社区服务，也不构成医疗或健康效果证据。

## 先在本机看一看

需要 Node **24.19.0**、pnpm **11.19.0**：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo
```

打开终端显示的本机地址；随机虚构账号在私有临时文件中，不在代码里。[快速开始](docs/quick-start.md) 说明登录和停止方式。演示仅可录入虚构资料，不能作为真实服务或持久存储。

## 配置自己的项目

首次初始化前编辑 [config/project.json](config/project.json)：项目中英文名称、可选联系邮箱、可选 HTTPS 主网站根地址、稳定种子村庄 ID 与名称。默认两个村完全虚构。配置中不能放密码、token 或联系人资料。编辑后重新构建并重启；客户端与服务端配置不一致时拒绝进入。已有数据库的种子 ID 集合不能直接改变，不会自动重置或迁移。

运行后在“村庄与权限”管理：项目级管理员可新增村庄，也可明确授权 admin/coordinator 新增村庄或管理指定村。新村默认筹备、每半天容量1单，不会自动开放；更名保留稳定 ID，暂停/关闭保留历史与安全收尾。合法新增村保存在加密数据库，不需要改配置或重新部署。普通负责人不能自行扩大权限。界面可切换完整中文/英文，业务姓名、备注与核实依据保持原文；“操作与运维指南”按角色说明日常操作和人工备份责任。

## 公开模板与工具

`/zh/tools/` 与 `/en/tools/` 提供10项经过审核、按原字节保留的工具：摩擦评估空表、中英摩擦框架、农事健康日历、健康指南、就医导航卡、公交卡和出行提醒。英文界面明确标注中文原件，不虚构英文下载。19项候选中另9项暂未纳入，见 [逐项审核](docs/tool-resource-review.json) 和 [工具使用说明](docs/tools-usage.md)。纸质医疗、地址和公交信息具有地方性，使用前必须按当地情况核实；工具库不公开居民记录，也不访问私人业务接口。

## 表格和接口

- [人员空表](templates/people.csv)、[可用时间空表](templates/availability.csv)、[需求空表](templates/requests.csv) 只有表头，用于线下整理和人工核对。没有一键 CSV 导入或批量导入接口。
- [字段字典](docs/data-fields.md) 与 [接口契约](docs/api.md) 对应实际程序。
- [JSON 示例](templates/examples/person-create.json) 全部为虚构，告知同意/核实默认 false，不能直接用于真实登记。接口要求自己实例的同源登录会话、授权村、版本和幂等键；不是匿名公共数据 API。

## 正式部署前

仅支持 Linux 单实例、单写入者及 `/var/data/farm-support` 持久卷。Windows 本地演示不等于生产验证。参阅 [部署](docs/deployment.md)、[账号权限](docs/identity-operations.md)、[备份与恢复](docs/operations.md)。默认 PREPARING，无居民、业务资料或共享管理员；首次管理员由部署方在受控控制台核实并创建邀请，自己设置密码和 MFA。

真实启用前，部署方必须明确服务范围、现场安全、必要数据授权、运营责任人、独立备份保管人与隔离恢复验收。没有身份核实、权限/保存/恢复验收前不接入真实资料。CI 和启动成功不能替代这些工作。软件不提供诊疗、医疗建议、急救调度、支付或保证安排成功。紧急情况在中国请拨打 120，不等待农活匹配。

## 检查与许可

```sh
pnpm test
pnpm build
pnpm check:release
pnpm audit --prod
```

CI 仅验证，不部署或创建付费资源。`render.yaml` 是需人工审阅的付费部署样例，自动部署关闭。不要直接导入以为免费。

[源文件清单](docs/source-manifest.json) 记录允许发布文件的 SHA256：文本按 UTF-8/LF 规范化，审核工具按原始二进制字节核验。清单排除自身，不包括 Git、依赖、构建产物或运行资料。改动源码后先人工检查，再运行 `node scripts/source-manifest.mjs` 更新；`check:release` 同时检查工作目录、所有本仓库历史和构建输出，不能代替真人隐私审查。实际本地验收与未验项目见 [验收记录](docs/network-acceptance.md)。

[MIT 许可证](LICENSE)，Copyright (c) 2026 Yin Zichu，适用于软件代码及新编配套文档、空白CSV/JSON模板，允许使用、修改、分发和商用并保留版权及许可声明。第三方依赖仍按 [各自许可证](THIRD_PARTY_NOTICES.md)。10项审核工具原件单独采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，不是 MIT；保留“农时有医 / Care in Farming Seasons · 殷子楚 Yin Zichu”署名、许可链接并注明修改，不暗示原作者认可改编或服务。授权范围、原件清单及适用边界见 [工具使用说明](docs/tools-usage.md)。仓库不包含原网站文章、照片、报告、问卷回答、访谈或原始研究数据。[安全报告](SECURITY.md) / [贡献说明](CONTRIBUTING.md) / [English overview](README.en.md)。

## 复制这个独立模板

在 [GitHub 仓库](https://github.com/YINZICHU/farm-support-network) 点击 **Use this template → Create a new repository**，或 **Code → Download ZIP**。复制后按本仓库的快速开始、配置和运维说明建立自己的实例；复制代码不会获得原项目的账号、数据、服务器或服务承诺，也不会自动部署。
