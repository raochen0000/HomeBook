## ADDED Requirements

### Requirement: 主路径界面壳必须按当前语言显示

登录、四 Tab 主界面、记一笔、流水详情、家庭协作入口、报表壳、设置与账号子页、帮助中心、关于页的系统文案（按钮、标题、空态、错误、Toast、Alert、导航标题）MUST 来自当前语言资源，MUST NOT 在英文模式下大段显示中文壳文案。用户生成内容（备注、自定义分类名、家庭名、昵称、目标名）MUST 保持原文。

#### Scenario: 英文模式下打开首页与记一笔

- **WHEN** 界面语言为 English 的用户打开首页并打开记一笔
- **THEN** 系统 MUST 以英文显示导航、空态、按钮与表单标签，流水备注仍显示用户当初输入的文字

#### Scenario: 中文模式保持原语义

- **WHEN** 界面语言为简体中文
- **THEN** 系统 MUST 显示与现网一致的中文产品文案，不得因 i18n 改写业务口径

### Requirement: 系统分类必须翻译显示名且不改库存名

系统预设分类 MUST 在英文界面显示对应英文名（如餐饮 → Dining，工资 → Salary）。库内 `categories.name` MUST 保持中文。自定义分类 MUST 显示用户填写的名称。储蓄资金闭环仍按中文系统分类名查找。

#### Scenario: 英文界面查看餐饮分类

- **WHEN** 界面语言为 English 且流水使用系统分类「餐饮」
- **THEN** 系统 MUST 显示 Dining，且数据库中该分类 `name` 仍为「餐饮」

#### Scenario: 自定义分类不翻译

- **WHEN** 家庭有一个名为「周末brunch」的自定义分类
- **THEN** 系统 MUST 在中文和英文界面都显示「周末brunch」

### Requirement: 搜索必须同时命中存库名与显示名

关键词搜索分类时，系统 MUST 匹配系统分类的存库中文名以及当前语言下的显示名。

#### Scenario: 英文界面搜索 Dining

- **WHEN** 界面语言为 English 的用户用关键词 `Dining` 搜索
- **THEN** 系统 MUST 能命中系统分类「餐饮」的流水

#### Scenario: 英文界面搜索餐饮

- **WHEN** 界面语言为 English 的用户用关键词 `餐饮` 搜索
- **THEN** 系统 MUST 仍能命中系统分类「餐饮」的流水

### Requirement: 日期人性化标签必须跟随语言

问候语、今天 / 昨天、月份标题等客户端格式化标签 MUST 跟随当前界面语言。金额展示 MUST 继续使用 `¥` 与两位小数，不随语言改币种。

#### Scenario: 英文界面的今天

- **WHEN** 界面语言为 English 且流水发生在当天
- **THEN** 系统 MUST 使用英文的当天标签，而不是「今天」

### Requirement: 帮助与法律文案必须提供英文并进包

帮助中心 FAQ、用户协议、隐私政策 MUST 在英文模式下显示英文正文，译文 MUST 打进客户端包，不依赖联网拉取。

#### Scenario: 英文模式打开隐私政策

- **WHEN** 界面语言为 English 的用户打开隐私政策
- **THEN** 系统 MUST 显示英文政策正文，而不是中文原文
