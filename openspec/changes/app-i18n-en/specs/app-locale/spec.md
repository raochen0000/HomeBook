## ADDED Requirements

### Requirement: 应用必须解析并持久化界面语言

系统 SHALL 只支持短码 `zh`（简体中文）与 `en`（English）。无本机存档时，MUST 根据设备首选语言决定：`languageCode` 以 `zh` 开头则用 `zh`，否则用 `en`。用户一旦在设置中选择语言，MUST 将短码写入本机存储，之后重启仍使用该选择，不再跟随设备语言变化。

#### Scenario: 中文设备首次启动

- **WHEN** 用户首次安装且设备首选语言为 `zh-Hans` 或其它 `zh*`，且本机没有语言存档
- **THEN** 系统 MUST 以简体中文渲染界面

#### Scenario: 非中文设备首次启动

- **WHEN** 用户首次安装且设备首选语言不是 `zh*`，且本机没有语言存档
- **THEN** 系统 MUST 以 English 渲染界面

#### Scenario: 用户选择后重启

- **WHEN** 用户将语言改为 English 后杀掉并重新打开 App
- **THEN** 系统 MUST 仍以 English 渲染，即使设备系统语言为中文

### Requirement: 我的页必须真正切换语言

「我的 → 语言」行内菜单 MUST 显示当前语言并允许在「简体中文」与「English」之间切换。选中 English MUST 立即切换界面语言，MUST NOT 再显示「暂仅支持简体中文」。当前选中项 MUST 显示 checkmark。

#### Scenario: 从中文切到英文

- **WHEN** 当前语言为简体中文的用户在「我的」选择 English
- **THEN** 系统 MUST 把界面改为 English，菜单勾选留在 English，且不弹出「暂仅支持简体中文」

#### Scenario: 从英文切回中文

- **WHEN** 当前语言为 English 的用户选择简体中文
- **THEN** 系统 MUST 把界面改回简体中文

### Requirement: 原生 Tab 标签必须跟随界面语言

四 Tab 的标签（首页 / 报表 / 家庭 / 我的）MUST 使用当前界面语言。切语言后 MUST 更新 Tab 标签，不得长期停留在旧语言。

#### Scenario: 切到英文后查看 Tab

- **WHEN** 用户把语言切到 English 并查看底部 Tab
- **THEN** 系统 MUST 显示对应英文标签，而不是「首页」「报表」「家庭」「我的」
