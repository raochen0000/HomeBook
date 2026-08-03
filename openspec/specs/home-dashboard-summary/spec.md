# home-dashboard-summary Specification

## Purpose
TBD - created by archiving change home-load-optimization. Update Purpose after archive.
## Requirements
### Requirement: 当前家庭的首页概览必须完整且受授权保护

系统 SHALL 为已登录且具有有效家庭成员关系的用户提供指定账期的首页概览。概览 MUST 从完整账期的未删除流水聚合，而不得以首页流水分页结果或固定条数上限作为汇总输入。概览 MUST 包含收入、支出、结余、流水笔数、预算总额、预算已用额、当前用户是否为户主和家庭标识。

#### Scenario: 本月流水多于首页首屏容量

- **WHEN** 当前家庭在账期内有多于 30 条流水
- **THEN** Hero 展示的收入、支出、结余和预算已用额 MUST 仍包含该账期全部未删除流水

#### Scenario: 预算已用口径

- **WHEN** 账期包含普通支出、普通收入、储蓄存入和储蓄取出流水
- **THEN** 概览的预算已用额 MUST 仅统计普通支出，收入和储蓄相关流水 MUST 不计入预算已用额

#### Scenario: 非成员请求概览

- **WHEN** 没有有效家庭成员关系的已登录用户请求概览
- **THEN** 系统 MUST 不返回任何家庭的概览数据

### Requirement: 概览必须使用家庭时区解释账期

系统 SHALL 使用当前家庭保存的时区将 `YYYY-MM` 账期转换为半开时间范围 `[账期开始, 下个账期开始)`。

#### Scenario: 账期边界的流水

- **WHEN** 一笔流水在家庭本地时区的月初零点发生，另一笔在下月月初零点发生
- **THEN** 概览 MUST 只包含前者

### Requirement: 首页必须独立展示概览加载状态

首页 SHALL 在概览数据尚未完成时展示 Hero 的局部加载状态，并且 MUST NOT 等待分类、成员头像或流水列表数据才展示 Hero。

#### Scenario: 分类加载较慢

- **WHEN** 概览请求已完成而分类请求仍在进行
- **THEN** 首页 MUST 展示已完成的 Hero，且不得显示全屏首页骨架

