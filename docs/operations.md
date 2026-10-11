# 操作、备份与隔离恢复

软件发布不代表服务运营验收。项目运营方自己负责必要授权、现场安全、账号范围和备份；不公开病历、证件、起点位置或研究样本。定期复查权限、容量、服务开放状态与待办，终止不用的账号。

## 独立备份

日常使用后、重要权限变更/撤权/联系资料删除后，将加密备份导出到服务器之外。至少保留 `.bundle`、最新 `.boundary`、`.receipt.json` 三份配套材料，核对checkpointId及SHA256；备份密钥与包分开保管。服务器磁盘快照不代替本程序一致性备份。不要复制正在写入的SQLite文件作为备份。

只有明确projectAdmin+已验证MFA才能备份；仅覆盖全部村的普通admin也不能。备份暂锁维护，并发操作会拒绝重试，不关闭认证或扩大CORS。备份密钥必须独立随机32字节，不能与FARM_DATA_KEY或FARM_AUTH_SECRET相同。

模板提供命令（在受控电脑、自己的实例运行）：

```sh
node scripts/farm-support/backup.mjs --authenticated-export < /private/backup-input.json
```

私有输入JSON字段为 origin、sessionCookie、backupKeyBase64、outputDirectory。origin是自己的HTTPS根origin；cookie仅使用自己当前管理员会话，不写进命令行或聊天；输出目录必须是新的绝对路径，父目录非symlink。输入文件必须私有权限（Linux0600）且不进入Git/共享云盘，导出后私下安全移除会话输入。脚本只输出状态，不输出秘密。会话Cookie是临时秘密，不是API token，不要收藏为永久登录方式。

定期核对独立保存包的hash/最新checkpoint，实际做隔离恢复，不只检查“下载成功”。保存的数据包包括身份资料：业务状态AES-GCM加密，但认证数据库的邮箱/密码哈希/TOTP等受整体备份加密和存储权限保护；不要声称每个SQLite字段都独立加密。

## 恢复先隔离，不覆盖原卷

```sh
node scripts/farm-support/restore.mjs --isolated-restore --latest-checkpoint-verified < /private/restore-input.json
```

输入字段 backupKeyBase64、bundleFile、latestBoundaryFile、expectedCheckpoint、targetDir。使用最新可信receipt的checkpointId、最新boundary，不以旧备份的撤权/删除状态为准。FARM_*配置须为原实例正确的origin、ID、认证密钥及数据密钥；另加备份密钥，缺任何一类都不能承诺恢复。

targetDir必须是新的绝对路径，不是正在用的dataDir；脚本不会切换线上目录。恢复验证包、身份、哈希和最新隐私边界；清全部会话、待用邀请/挑战并要求重新核实管理员，保留撤权及联系资料删除，避免旧备份重新泄露。按 [身份恢复](identity-operations.md) 私下重新建立合规账号/MFA，逐项验证权限和记录后才能由部署方另行决定切换，禁止直接复制覆盖正式卷。

## 日常村庄管理

项目管理员在“村庄与权限”新增村庄、授予新增权或指定村管理范围；受限管理者只修改自己的managedVillages，并只能邀请本范围普通协调人。新增村不自动开放、也不给其他普通账号自动扩权。更名保留ID；暂停和关闭不物理删除。授权/身份变化清私人界面，减少权限清会话并写最新恢复边界；之后导出新的配套备份。

## 旧注册表的显式升级

普通启动发现 `REGISTRY_UPGRADE_REQUIRED` 会拒绝，不自动改库。先停止所有写入者，在私有隔离副本中完成核验和演练。只读检查：`node scripts/farm-support/registry-upgrade.mjs --check`。旧实例必须保持原种子村 ID、实例身份和三类正确密钥；已激活 bootstrap 邀请必须与认证用户绑定，否则由操作者明确核实一个现存有效 admin，不能把所有 admin 自动变成项目管理员。

正式升级由部署方在停服后执行：`node scripts/farm-support/registry-upgrade.mjs --apply --offline-confirmed --verified-identity --project-admin-user-id <known-user-id>`。确认参数仅表示人工核验，不证明程序已经检测停服或身份。独立备份密钥通过私有 `FARM_BACKUP_KEY_BASE64` 环境变量提供，不放参数、日志或 Git。先生成 `pending-backup.bundle`、`.boundary`、`.receipt.json`，核对后再进行单事务升级；业务记录及原 ID 不改变。保管三份材料到服务器之外，失败时不删除数据库、不重新初始化。已有待保管备份会阻止覆盖，先安全保管和核验。

升级锁用于阻止同时启动/重复升级，不替代停服。重复 apply 不重新写状态。事务失败保留已验证备份，注册表仍未升级；按既有隔离恢复流程恢复到新目录，不能将旧包直接覆盖在线卷。升级成功后再以普通启动检查，确认唯一已核实的项目管理员、其他账号无新增/管理权限，然后重新建立 MFA 和复核现场权限。

恢复升级前的安全备份时，常规 restore 必须另外核验原管理员身份，并在私有标准输入加入 `legacyUpgrade: { verifiedIdentity: true, projectAdminUserId: "<known-user-id>" }`。恢复程序先验证实例证明、旧种子村ID、最新恢复边界和有效认证用户，再在隔离目标的同一事务升级注册表；不会绕过 `.restoring` 直接启动旧库。缺少核验或管理员已被撤权时拒绝，失败目标继续不可启动。恢复后所有管理账号仍停用、会话和旧MFA清空，需要既有受控账号恢复和新MFA核验；此选项不直接重新激活账号，不覆盖在线目录。

后来明确重新授予的权限具有更新版本，普通重启不会重新套用已纳入的历史缩减。旧备份或失败事务仍受未纳入的更新边界限制；恢复仍清会话并停用管理权限。每次村庄新增、更名/状态修改和授权变化均在既有audit保存操作者、对象、最小核实依据编号和受影响版本，不写病情或密码。

## 失败处理

STORAGE_READ_ONLY或SQLite容量错误：先停止新增写入、核对持久卷及空间，由管理员维护/导出；不关闭容量保护，不自动扩容。CONFIG_VILLAGE_MISMATCH：核对部署前稳定种子村ID、恢复原正确配置重新构建；不是重置数据库的理由。STORAGE_IDENTITY/SCHEMA/MISSING/PARTIAL、RESTORE_INCOMPLETE：保留原文件，停止“重新初始化”，检查正确密钥和已验证备份，使用受控恢复。

恢复操作、审核和现场确认都要保留必要编码依据，不写完整健康信息。联系资料保留提示90天后复核，不自动判定该删；未结事项/费用争议/投诉阻止移除。撤权与隐私删除会记录独立恢复边界，导出最新配套备份后再私下保管。
