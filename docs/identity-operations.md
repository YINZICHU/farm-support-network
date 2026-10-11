# 邀请、授权与账号恢复

居民和农活提供方不用注册；经核实的负责人登记必要资料。没有开放注册/自动邮件/共享默认密码。管理员核实成年人职责、本人身份及负责村，再逐人邀请；模板作者不替其他项目管理账号。

## 第一个管理员

先完成空卷provision。在本人有权限的托管控制台，按实际核验生成私有输入（仅 email、name，无password）：

```sh
node scripts/farm-support/account-recovery.mjs --bootstrap --identity-verified < /private/administrator-input.json
```

生产检查Linux及真实挂载；只允许一次bootstrap。脚本在持久目录生成权限0600的 `administrator-activation.txt`，控制台不打印链接。仅私下交给已核实本人；链接属于敏感认证材料，不截图、不进日志、Issue、聊天或Git。本人在24小时内激活、设置12–128位密码，登录后配置TOTP验证器。私下取回并使用后删除确切handoff文件，勿删目录或数据库。

## 按村邀请

工作台“村庄与权限”通过 `/invitation` 创建一次性邀请，选择role和villages并实际核实adultVerified。项目级管理员明确授权；受限管理者只能邀请自己managedVillages内的普通coordinator，不能授予admin、项目权限、新增权或管理权。协调人只看/操作其村，analyst只看编码汇总，reviewer只处理指派且未涉事投诉。仅projectAdmin且已验证MFA可导出整库备份；全村范围admin不自动获得项目权限。

所有admin、canCreateVillages或非空managedVillages账号在生产必须完成MFA，普通协调人不强制。权限默认没有新增权/管理村；projectAdmin仅admin，新增权仅admin/coordinator，managedVillages必须属于villages。项目管理员可授予、缩减这些能力，但不能修改自己或撤最后一个有效项目管理员。管理邀请激活前后都重新核对当前授予者权限，旧邀请不能恢复已缩减权限。

邀请只是身份/职责/村庄绑定，不代表服务已OPEN。激活一次性消费，过程中失败须审核，不重复提交token。管理人员不用ChatGPT账号，使用本实例受邀邮箱和自设密码。不给居民共享负责人账号。

## 撤权与恢复

仅项目级管理员可执行 `grant.revoke` 或 `grant.permissions`；立即撤权/缩减范围会删除会话，拒绝修改自己或撤最后一个有效项目管理员，不删除历史业务记录。授权修改和撤权后导出新的配套加密备份。不能以老备份恢复绕过撤权或缩减范围。隔离恢复后，所有有管理能力账号停用并清全部会话、MFA信任、待用邀请/挑战，必须受控核实并重新建立验证器，不自动恢复原来的更大权限。

忘记密码/丢验证器：先私下核实身份，不收集原密码/验证码/恢复码。必要时在受控控制台运行：

```sh
node scripts/farm-support/account-recovery.mjs --recover --identity-verified < /private/recovery-input.json
```

输入只有 claimId 和 resetMfa（是否经过核实需要重设验证器），不接受密码。原受邀身份claimId需由有权管理员在自己实例私下核对，不能猜邮箱或接收陌生激活链接。新handoff也按一次性敏感材料交付；恢复前撤销旧权限/会话并记录隐私边界，重新核实才激活。用户已被普通撤权且无合法恢复状态时拒绝，不给未核实者“直接开通”。恢复可能失败，应保留存储并审阅，不能关闭MFA、清空user表或偷偷新建全村管理员解决。
