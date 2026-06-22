# 家账 · 剩余开发清单（按阶段）

> 生成：2026-06-22 · 依据 PRD.md 逐流程核对**实际代码**得出（非 MVP.md 的 ✅ 自述）。
> 用途：作为后续分阶段开发的执行清单。完成一项勾一项。

## 决策基线（2026-06-22 已拍板）

1. **离线能力**（WatermelonDB / 本地同步队列）→ **留到远期**，MVP 保持纯在线（Supabase + React Query）。
2. **转让 / 移除二次确认** → 不用「手机号后 4 位」（MVP 无手机号），改为**输入对方昵称**；解散仍为**输入家庭名**。
3. **优先级** → 先做「阶段一·数据安全」，再做「阶段二·体验完整度」。
4. **家庭封面图床** → **现在就接阿里云 OSS**（与储蓄目标封面共用上传链路）。

## ⚠️ 先行技术债（阻塞下列功能，需先处理）

- [x] **`families` 表缺 `cover_url` 列** → 已由 `0017_preview_family_by_code_rpc.sql` 幂等补列并在 Studio 执行。家庭封面（阶段二 #5/#6）的 UI 仍待做。
- [x] **邀请码与 PRD 不符** → 已由 `0018_invitation_code_6char.sql` 改为 6 位排除易混（阶段二 #7）。
- [x] **解散家庭报 `families_member_count_check`** → `dissolve_family` 置 `member_count=0` 违反列级 `between 1 and 8` 约束；已由 [`0019_fix_dissolved_family_member_count.sql`](../supabase/migrations/20260622120019_fix_dissolved_family_member_count.sql) 放宽为「dissolved 家庭允许 0」（**需 Studio 执行**）。
- [ ] **头像/家庭封面上传报 `new row violates row-level security policy`** → `storage.objects` 默认启用 RLS，但缺写入策略。已由 [`0020_storage_policies.sql`](../supabase/migrations/20260622120020_storage_policies.sql) 补 insert/update/delete 策略（头像=本人 uid 文件夹、封面=户主）。**需 Studio 执行**；并先在 Studio 手动创建两个 public 桶 `homebook-user-avatars`、`homebook-family-covers`。（原文件与 0019 撞了版本号，已改名 0020 避免 `db push` 漏跑）

---

## 阶段一 · 数据安全与正确性（P0 缺口，最高优先级）

> 都关系到「误操作 → 丢数据 / 误入家庭」，PRD 列为核心，目前均为简化版。

- [x] **#1 流程 4 加入家庭：预览卡 + 加入影响确认** ✅ 2026-06-22（tsc/eslint 通过，待真机/模拟器验证）
  - 后端：`preview_family_by_code` RPC（[0017 migration](../supabase/migrations/20260622120017_preview_family_by_code_rpc.sql)，已在 Studio 执行）。
  - 前端：[scan-sheet.tsx](../src/features/family/scan-sheet.tsx) 已改为「扫码/手输 → 拉预览卡 → 确认后才 join」；API [usePreviewFamily](../src/api/families.ts)。
  - 预览卡：封面 / 家庭名 / 户主（昵称+头像）/ 成员头像堆叠 / X·8 人。
  - 影响四分支：`none` 直接加入；`delete_origin`（⚠ 删原家庭+二次确认弹窗）；`auto_leave`（⚠ 自动退出当前家庭，直接加入）；`blocked_owner`（⛔ 禁用加入）。
  - 遗留小项：`blocked_owner` 暂只给文字引导，未做「直接跳转转让/解散」按钮（依赖阶段一 #3/#4）；防枚举限频按决策暂不做。
- [x] **#2 流程 6 移除成员二次确认** ✅ 2026-06-22：[family.tsx](../src/app/family.tsx) 改为「输入对方昵称 + 滑动确认」。
- [x] **#3 流程 5 转让户主二次确认** ✅ 2026-06-22：[transfer-sheet.tsx](../src/features/family/transfer-sheet.tsx) 选中成员 →「输入对方昵称 + 滑动确认」+ 转让成功后追问「是否顺便退出家庭」。
- [x] **#4 流程 5 解散家庭二次确认** ✅ 2026-06-22：[family.tsx](../src/app/family.tsx) 改为「输入家庭名 + 滑动确认」。

> #2/#3/#4 共用两个新组件：[SlideToConfirm](../src/components/ui/slide-to-confirm.tsx)（PanResponder 滑动确认，无需 GestureHandlerRootView）+ [DangerConfirmSheet](../src/features/family/danger-confirm-sheet.tsx)（警示 + 文字匹配闸门 + 滑动确认对话框）。tsc/eslint 通过，待真机/模拟器验证。
>
> **阶段一（数据安全与正确性）已全部完成** ✅。`blocked_owner` 一键跳转转让/解散的按钮可在验证阶段一后补（现为文字引导）。

---

## 阶段二 · 体验完整度（P0/P1 被跳过的子功能）

- [ ] **#5 流程 1 §3.5 家庭设置页**：[family.tsx:461](../src/app/family.tsx#L461) 现为「敬请期待」toast → 户主可改家庭名 / 封面（仅户主，成员只读）。依赖 `families.cover_url` 列 + OSS。
- [ ] **#6 流程 1 §3.5 新用户「完善家庭」可选步骤**：注册创建单人家庭后，可选设家庭名+封面，可跳过（默认名+默认占位）。
- [x] **#7 流程 3 邀请页完善**（代码完成 2026-06-22，[invite-sheet.tsx](../src/features/family/invite-sheet.tsx)）
  - [x] 邀请码改 **6 位排除易混**（[0018 migration](../supabase/migrations/20260622120018_invitation_code_6char.sql)，已在 Studio 执行）
  - [x] 文本码 **3+3 分段**展示
  - [x] **有效期倒计时**（实时秒级）
  - [x] **家庭名 / 户主信息**
  - [x] **一键复制**（已复制态）— 用 `expo-clipboard`
  - [x] **保存二维码到相册** — 用 `expo-media-library` + `expo-file-system/legacy` 写 PNG；app.json 已加 media-library 插件（相册权限）
  - ⚠️ **后两项需先重建 dev client**（新增原生模块 `expo-clipboard` / `expo-media-library`）才能生效
- [x] **#8 流程 2 首次记账庆祝** ✅ 2026-06-22：家庭第一笔成功后,**先关闭记账面板、再在父层弹居中庆祝弹窗**（半透明遮罩 + 🎉 + 文案 + 「好的」手动关闭，DESIGN v0.5.0 去礼花），替代顶部 toast。record-sheet 经 `onSaved({firstRecord})` 上报 + `onDismiss` 在面板关闭动画结束后由 [index.tsx](../src/app/index.tsx) 触发 [FirstRecordCelebration](../src/features/record/first-record-celebration.tsx)。判定 = 新建 + 流水列表已加载为空。纯前端，免重建。
- [ ] **#9 横切：接入阿里云 OSS 图床**：家庭封面 + 储蓄目标封面共用上传链路（#5/#6 前置）。

---

## 阶段三 · 发布前补齐（MVP.md §2.4，已明确推迟，非缺陷）

- [ ] **#10 手机号短信 OTP 登录**（现：邮箱密码 + Apple）。
- [ ] **#11 系统推送**（阿里云 EMAS / APNs）（现：App 内通知中心）。
- [ ] **#12 月度总结服务端快照 + 保存图片**（现：客户端实时计算）。

---

## 远期 · 明确不做（PRD 已标注 + 本次决策）

- 离线能力 / WatermelonDB 本地同步（本次决策推迟）
- 流程 7.6 户主继任机制、流程 12 账号注销
- 多家庭、账单导入/导出、周期账单、资产管理、多币种
