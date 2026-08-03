## ADDED Requirements

### Requirement: 首页流水必须使用有限首屏页

系统 SHALL 将首页流水作为独立数据源加载。首次请求 MUST 最多返回 30 条当前家庭的未删除流水，并按 `occurred_at DESC, id DESC` 排序。

#### Scenario: 首页初次打开

- **WHEN** 已登录用户打开拥有流水的首页
- **THEN** 系统 MUST 只请求并渲染最多 30 条最近流水

#### Scenario: 首页没有家庭

- **WHEN** 已登录用户尚未属于任何家庭
- **THEN** 系统 MUST 不发起首页流水请求，并保留现有空状态与创建家庭记账流程

### Requirement: 首页流水必须稳定地追加下一页

系统 SHALL 使用上一页最后一条记录的 `(occurred_at, id)` 作为下一页游标。下一页 MUST 只包含时间更早的记录，或者在相同时间下 id 更小的记录。

#### Scenario: 同一时间的连续记录

- **WHEN** 两条或多条流水拥有相同的 `occurred_at`
- **THEN** 用户加载下一页时 MUST 不重复或遗漏这些流水

#### Scenario: 追加到末页

- **WHEN** 用户滚动到已加载流水末尾且仍有下一页
- **THEN** 系统 MUST 请求下一页并将新流水追加到现有列表，而不替换已加载的流水

### Requirement: 首页流水查询必须限定当前家庭

系统 SHALL 将当前家庭标识作为流水查询条件，同时保留现有 RLS 授权约束。

#### Scenario: 请求中的家庭标识不匹配

- **WHEN** 客户端提供的家庭标识不属于当前用户
- **THEN** 系统 MUST 不返回其他家庭的流水

### Requirement: 交易变更必须刷新首页流水

系统 SHALL 在新增、编辑或软删除流水成功后，使首页流水的缓存失效并重新获取受影响内容。

#### Scenario: 首页创建一笔流水

- **WHEN** 用户在首页成功保存一笔流水
- **THEN** 首页的首个流水页 MUST 刷新并包含该笔新流水
