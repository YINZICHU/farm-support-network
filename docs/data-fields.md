# 字段字典与空表

三个 CSV 均只有表头，供线下整理、核对后人工登记。工作台没有 CSV 上传/批量导入接口；不能直接写数据库。使用 UTF-8。多村/技能/星期在 CSV 中用 `|` 分隔，JSON 中转换为数组；转换需要自行开发并保留原校验，不由模板自动执行。

## 人员：people.csv → person.create

| 字段 | 含义与约束 |
| --- | --- |
| name | 本人愿意使用的称呼，非空，最多60字符 |
| phone | 仅协调所需电话，可留空，最多30字符；不用身份证或诊断代替 |
| villages | 本人愿意服务且录入者有权限的稳定ID；至少一个 |
| skills | 已核实的 `sorting`轻量分拣、`packing`轻量包装、`care`经核实短时田间照管；至少一项 |
| consent | 实际告知用途和本人意愿记录；JSON boolean，未核实不能 true |
| verified | 技能、限制与安全核实记录；JSON boolean，未核实不能 true |
| pattern_days | 通常可用星期1–7，周一=1，周日=7；不重复，可留空 |
| pattern_start / pattern_end | 北京时间 HH:mm；同一天、结束晚于开始，与 days 一起组成可选 pattern |

通常时段仅用于推荐，不等于具体日期已同意。状态由程序初始化为 ACTIVE；不能由空表跳过核实。状态后续使用 person.status：ACTIVE、PAUSED、EXITED，并填写 reason。

## 可用时间：availability.csv → person.availability

| 字段 | 含义与约束 |
| --- | --- |
| id | 自己授权范围内已存在人员ID，不是姓名 |
| version | 最新记录整数版本；每次成功更新后递增 |
| start / end | 具体 ISO 8601 时间，明确 +08:00；开始不早于当前时间，结束晚于开始且不超过24小时 |
| evidence | 本人核实方式/依据编号，非空最多120字符；不要写病情、账户或证件 |
| consent | 此具体时段由本人确认，未确认不能 true |

例 `2026-10-12T07:00:00+08:00` 只说明格式，真实登记必须使用实际日期。界面时区 Asia/Shanghai。作业前后各30分钟的往返/交接也须由可用时间覆盖。

## 需求：requests.csv → request.create

| 字段 | 含义与约束 |
| --- | --- |
| village | 注册表内已存在、录入者有权限且实际开放的稳定村ID |
| household | 新服务家庭编码，非空最多80字符，不沿用原研究样本编号 |
| name / phone | 必要联系称呼/电话，分别最多60/30字符，非空 |
| task | sorting、packing、care；不得用这些标签掩盖禁止作业 |
| note | 一项主要任务说明，最多300字符，不写病情 |
| source | phone、in-person、paper；记录真实提出方式 |
| actualAt | 带时区ISO时间，不能未来或距当前超过30天 |
| consent | 已说明用途并核实本人/委托人服务意愿，未确认不能 true |

新需求状态 RECEIVED；须经 request.verify 核实安全范围才到 VERIFIED。候补/退出等去向单独记录。正常作业最长4小时；不能通过修改模板取消限制。费用使用整数“分”，未知值 null，不是默认为零。

JSON 示例的 consent/verified=false 将被实际 API 拒绝，这是安全默认，不是错误。不要为了让示例成功而替真实居民勾选同意；仅隔离测试会显式使用虚构同意。匹配输入里的 request/version 必须换成自己有权限的当前记录，示例日期不可永久照抄。

## 村庄注册表与授权

共享配置只定义不可变 `seedVillageIds`；运行中村庄、中文/英文名称与当前权限均在加密状态中。`villageRegistryVersion=1`，`registryRevision` 为正整数，新增时递增。稳定村ID由服务器生成 `v-` 加 UUID，不根据姓名或村名生成。名称每种语言1–80字符，拒绝控制字符；查重用NFKC、trim及英文大小写归一化，展示字形不自动改写。

新村默认 PREPARING、capacity=1、contact=null、version=1。容量按每半天1–10单；设置更新用当前version。暂停/关闭不删除历史，阻止新受理、预留及开工，但允许已开始作业安全收尾。

角色仍为 admin/coordinator/analyst/reviewer。`projectAdmin` 仅admin可true；`canCreateVillages` 仅admin/coordinator可true，默认false；`managedVillages` 必须是授权 `villages` 的子集。授权version为正整数，修改后递增。范围缩减先记录恢复边界并清目标会话；旧幂等请求、邀请或备份不能绕过当前权限。项目管理员明确授权，不能由“覆盖全部村”推断全局能力。
