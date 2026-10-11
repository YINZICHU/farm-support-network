# 贡献

只用明确虚构、隔离的数据与本机测试；不得访问原网站/正式后台或上传研究文件。提交源码、空白模板和教程，不提交有值.env、runtime、DB、备份、密钥、日志、截图中的秘密或node_modules/dist。

修改先写目标失败测试，再最小实现，跑 `pnpm test`、`pnpm build`、`pnpm check:release`、`pnpm audit --prod`。Node24.19.0/pnpm11.19.0和依赖锁定版本保持不变，升级另行审阅。维持同源、按村范围、管理员MFA、幂等、版本、人工确认、单写入者、PREPARING和隔离恢复；不能为了示例方便开放注册或自动替用户勾同意。

配置/接口变化须同步字段字典、示例和失败边界测试。Linux持久卷/512MiB workload需要实际证据，不能用Windows预览或workflow文件冒充。CSV仍是线下整理表；新增导入不是默认获准功能。

提交表示你有权按本仓库 [MIT](LICENSE) 提供贡献；保留出处和第三方许可证。原项目文章、照片、报告和研究资料不在此授权内。安全问题按 [SECURITY](SECURITY.md) 私下报告。
