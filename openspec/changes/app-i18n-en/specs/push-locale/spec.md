## ADDED Requirements

### Requirement: 设备令牌必须携带界面语言

系统 SHALL 在 `device_tokens` 上存储 `locale`，取值只能是 `zh` 或 `en`。客户端在注册或更新推送令牌时 MUST 上报当前界面语言。用户在 App 内切换语言后，若该设备已注册令牌，系统 MUST 用新语言再次注册以更新该行。旧行无语言信息时 MUST 视为 `zh`。

#### Scenario: 英文用户注册令牌

- **WHEN** 当前界面语言为 English 的已登录用户成功注册推送令牌
- **THEN** 该设备令牌行的 `locale` MUST 为 `en`

#### Scenario: 切语言后更新令牌语言

- **WHEN** 已注册令牌的用户把界面语言从简体中文改为 English
- **THEN** 系统 MUST 更新该设备令牌的 `locale` 为 `en`

### Requirement: 系统推送必须按设备语言投递

推送投递侧 MUST 按目标设备令牌的 `locale` 选择中文或英文标题与正文。同一用户若有多台设备、语言不同，MUST 允许各设备收到对应语言。`locale` 缺失或非法时 MUST 回落中文。

#### Scenario: 英文设备收到户主变更推送

- **WHEN** 投递侧向 `locale = en` 的设备发送 `transfer` 类型通知
- **THEN** 推送标题与正文 MUST 为英文，不得使用中文模板

#### Scenario: 中文设备保持中文推送

- **WHEN** 投递侧向 `locale = zh` 的设备发送同类通知
- **THEN** 推送标题与正文 MUST 为中文

#### Scenario: 旧令牌无 locale

- **WHEN** 令牌行的 `locale` 为空或不是 `zh`/`en`
- **THEN** 投递侧 MUST 使用中文模板
