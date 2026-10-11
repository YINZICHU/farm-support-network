# 独立 Linux 部署

不要连接原项目实例。此模板只支持 Linux、单实例/单写入者、Node24.19.0、pnpm11.19.0及精确持久挂载 `/var/data/farm-support`。不要用临时文件系统、多个副本、自动扩容或 Windows 演示目录。配置真实村庄前先完成授权核验；程序默认 PREPARING，空账号/业务数据。

## 部署前

1. 编辑 [共享配置](../config/project.json)，使用自己项目名称、稳定村ID及可选联系信息；字段不是秘密保险箱。执行安装、测试、build和check:release。编译客户端与服务器必须同一配置；已有村ID不可随意改变。
2. 自行选择托管与费用，确认实际Linux持久卷/权限/地区和服务协议。`render.yaml`仅参考，付费 `0.5c-512mb` + disk，autoDeploy关闭；也须关闭控制台Blueprint自动同步。规格名称依据 [Render Blueprint官方说明](https://render.com/docs/blueprint-spec)，费用查看 [持久磁盘](https://render.com/docs/disks)、[当前官方价格](https://render.com/pricing)，不要把示例当作已开通或费用承诺。
3. 在托管平台私下配置以下变量，不提交有值.env文件：

| 变量 | 要求 |
| --- | --- |
| NODE_ENV | production |
| PORT | 1–65535整数，按平台分配 |
| FARM_ORIGIN | 自己的HTTPS根origin，无凭据、路径、query、hash |
| FARM_DATA_DIR | 精确 `/var/data/farm-support`，实际独立读写挂载 |
| FARM_AUTH_SECRET | 独立随机值，至少32字节 |
| FARM_DATA_KEY_BASE64 | 独立随机32字节的标准Base64，必须保留 |
| FARM_INSTANCE_ID | 自己生成的稳定实例ID，8–80字符：字母数字下划线连字符；不要重用他人ID |

数据密钥、认证密钥与备份密钥是三类独立秘密，各自离线安全保管。丢失原认证/数据密钥或实例origin/ID会阻断身份核验与恢复。生产不是“填一个密码就能共用数据库”。

## 只在首次空卷初始化

构建命令：`pnpm install --frozen-lockfile --prod=false && pnpm build && pnpm check:release`。

首次启动命令：`node scripts/farm-support/provision.mjs --start`，只允许完全空卷；创建存储后即启动。已有数据绝不重新provision；重复操作或部分初始化会拒绝，不要删除文件绕过。

首次成功后改回常规启动 `node scripts/farm-support/production.mjs`（或pnpm start）。持久卷在运行时验证，不在build阶段创建。`/healthz`仅返回ready，服务仍PREPARING。上线本身不会创建管理员、发送邮件或导入示例。

在受控托管控制台按 [账号说明](identity-operations.md) 核实首位管理员并生成私有一次性邀请。受邀本人打开自己的实例激活、自己设置密码、启用TOTP验证器并离线保管恢复码。负责人通过管理员逐人邀请，按村分配权限，居民不用注册。

## 接入真实资料前的人工验收

运行中村庄由加密状态注册表保存，配置仅定义不可变种子 ID；合法新增村不必修改配置或重新部署。旧模板不能自动升级，先停服、核实 bootstrap/管理员绑定、导出配套加密备份，在隔离副本演练 [显式升级](operations.md#旧注册表的显式升级) 后再由部署方执行。

只用虚构数据验证登录/MFA、跨村拒绝、撤权、更新冲突、重启保存、独立加密备份与隔离恢复；在实际大陆/使用地网络验证负责人能打开和登录。核实现场任务安全、告知同意与必要资料范围，明确运营与备份保管人。完成后才按实际情况设置整体和村庄OPEN；复制模板、CI通过或ready不是运营批准。

启动会核对密钥/instance/schema和已有种子村ID集合；合法动态村保留，种子漂移拒绝且不重置。SQLite检查使用私有临时快照含WAL，检查文件会清理；须保留足够磁盘与内存，禁止并行写入者。出现STORAGE_BUSY先停止多余实例并检查，不改密钥“试一试”。文件缺失、容量保护、未完成恢复按 [操作说明](operations.md) 处理；不要卸下持久卷或直接替换数据库。
