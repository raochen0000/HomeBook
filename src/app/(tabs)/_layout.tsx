/**
 * Tab 组布局（`(tabs)` 路由组）：承载四 Tab 的原生 Tab Bar（NativeTabs）。
 * 从根 Stack 下沉到本组后，「我的」等子页可用 `router.push` 全屏叠加于 Tab 之上（IA §6 G）。
 * 路由组名 `(tabs)` 不进 URL——`/`、`/report`、`/family`、`/mine`、`/dev` 路径保持不变。
 */
export { default } from '@/components/app-tabs';
