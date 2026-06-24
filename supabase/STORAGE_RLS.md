# Storage 上传踩坑总结（自托管 Supabase）

> 头像/封面上传到 Supabase Storage 反复报 `new row violates row-level security policy`（HTTP 400）的完整排查与定论。下次再遇到 Storage 上传问题，先看本文的「快速排查清单」。

相关迁移：[`0020`](migrations/20260622120020_storage_policies.sql) → [`0021`](migrations/20260624120021_storage_policies_flat_paths.sql) → [`0022`](migrations/20260624120022_storage_policies_owner_based.sql)；上传实现见 [`src/adapters/storage.ts`](../src/adapters/storage.ts)。

---

## 一、最终定论（结论先行）

本项目自托管实例（`spb-…opentrust.net`）上，Storage 上传能跑通需要同时满足三点：

1. **路径落桶根目录、不建子文件夹**（`{id}.jpg`，不是 `{id}/avatar.jpg`）。
   子文件夹会触发 `storage.objects` 的 BEFORE INSERT 触发器向 `storage.prefixes` 写前缀行；而 `storage.prefixes` 开了 RLS 却归 `supabase_storage_admin` 独占、`postgres`（含 Studio SQL Editor）无权加策略，导致整笔上传在 objects 策略被检查**之前**就被拒。根对象不触发 prefixes 写入，从根上规避。

2. **`storage.objects` 上要有 SELECT 策略**（这是最大的坑）。
   storage 的上传是 **upsert**：`insert into objects (...) values (...) on conflict (name,bucket_id) do update set ... returning *`。`ON CONFLICT` 要读冲突行、`RETURNING *` 要读回行——**两步都需要 SELECT 策略**。只建 insert/update 的「只写」策略，upsert 必然被 RLS 拒。

3. **写策略用 `owner` 列判归属，不要用 `auth.uid()`**。
   本实例 storage 执行时**角色确实是 `authenticated`、JWT 声明也在**，但 `auth.uid()` 在 storage 上下文里取不到 `sub`（GUC 名不一致）。好在 storage 会把上传者真实 uid 盖到 `objects.owner` / `owner_id`（服务端按已验证 JWT 盖、检查时已有值、客户端伪造不了），所以用 owner 列判归属：
   - 头像：`split_part(name,'.',1) = coalesce(owner::text, owner_id)`（文件名去扩展名 = 上传者）
   - 封面：`private.is_user_family_owner(coalesce(owner::text,owner_id)::uuid, split_part(name,'.',1)::uuid)`（显式传 user，不靠 auth.uid()）

最终策略集（6 条，全 `TO public`）：avatars / covers 各 `select + insert + update`。**不开放客户端 DELETE**（App 不需要，删除走控制台 service_role）。

> 覆盖安全性是确认可靠的：upsert 的 `on conflict do update set owner=$7, owner_id=$8` 会把 owner **重新盖成当前上传者**，所以冒名覆盖他人对象会在 WITH CHECK 处因「文件名 ≠ 新 owner」被挡。

---

## 二、被带偏的弯路（别再走）

| 当时的判断 | 为什么是错的 / 干扰项 |
|---|---|
| 「要去修 `storage.prefixes` 的 RLS / 用 psql 进超级用户」 | DB 端口被防火墙挡（见 memory），psql 走不通；而且改用根目录扁平路径后根本不碰 prefixes。**客服 AI 把人往这条死路带了很久。** |
| 「storage 把请求当 anon 跑」 | 加 `TO anon` 策略不生效 → 排除。其实角色是 `authenticated`。 |
| 「storage 不切角色、不传身份，只有 `TO public` 命中」 | 半对半错。`TO public` 能成的真正原因是那条全开策略**顺手建了 SELECT**，不是因为角色。 |
| 「`auth.uid()` 是 NULL 是病根」 | auth.uid() 确实取不到，但它只是让 `auth.uid()` 写法的策略失效；**真正卡住 upsert 的是缺 SELECT 策略**。 |
| 「单独给某个角色建写策略」 | 怎么试都不成，因为都缺 SELECT。 |

**教训**：症状（RLS 报错）只说「有策略没过」，不说是哪张表、哪条策略、哪个环节。别靠猜，要让数据库自己说话（见下）。

---

## 三、快速排查清单（下次先跑这套）

> 关键原则：**先确认是哪张表、哪个环节被 RLS 拦的**，再动策略。`400 + RLS` ≠ 401，说明 token 有效、请求已到达 Postgres，问题在策略侧。

1. **确认策略真的生效**（别跑 `_bundle.sql` 整段——它包在一个事务里，遇到「对象已存在」会整体回滚，策略改一起没了；只跑目标那一个迁移文件）：
   ```sql
   select policyname, cmd, roles::text, qual, with_check
   from pg_policies where schemaname='storage' and tablename='objects'
   order by policyname;
   ```

2. **以「该用户」身份在 SQL Editor 重放 INSERT**，让 Postgres 报出**具体哪张表**：
   ```sql
   begin;
     set local "request.jwt.claims" = '{"sub":"<用户uid>","role":"authenticated"}';
     set local role authenticated;
     insert into storage.objects (bucket_id, name, owner)
     values ('<bucket>', '<uid>.jpg', auth.uid());
   rollback;
   ```
   报错里的 `for table "objects"` / `"prefixes"` 就是突破口。

3. **用 RAISE 探针抓 storage 实际身份与 SQL**（最决定性）。把策略临时换成一个无条件 `raise exception` 的函数，把运行期信息抛回 App 的错误响应里：
   ```sql
   create or replace function public.debug_obj(_tag text,_owner text,_owner_id text,_name text)
   returns boolean language plpgsql as $$
   begin
     raise exception 'DBG-% | owner=% | owner_id=% | name=% | role=% | jwt=%',
       _tag, _owner, _owner_id, _name, current_role,
       current_setting('request.jwt.claims', true);
     return false;
   end $$;
   drop policy if exists "avatars_insert_own" on storage.objects;
   create policy "avatars_insert_own" on storage.objects
     for insert to public with check (public.debug_obj('INS', owner::text, owner_id, name));
   -- 上传一次 → 看 Network → Response 里的 DBG 行 → 用完务必恢复真策略
   ```
   这一步直接拿到：**走的是 insert 还是 update、owner 在检查时有没有值、role 是什么、claims 在不在、storage 实际跑的 SQL（含 on conflict / returning）**。本次就是靠它发现「是 upsert，需要 SELECT 策略」的。

4. **验证写策略命中后**，确认有 SELECT 策略放行 upsert 的读，且没有遗留的全开临时策略。

---

## 四、若要做到「零信任」（未来加固）

owner 列方案对本项目（家庭记账 MVP、桶公开读）已足够。若日后需要更强保证（彻底不依赖 storage 盖 owner 的行为），改走 **Edge Function + `service_role`**：函数里校验调用者 JWT、查户主，再用 service key 写入（绕过 RLS），然后把 `storage.objects` 的客户端写策略收紧为拒绝。Studio 左侧已有 Edge Functions 功能。
