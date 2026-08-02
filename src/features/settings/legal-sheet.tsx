/**
 * 用户协议 / 隐私政策 内容 Sheet（B2，PRD §3.6 / §18.3.8；DESIGN §9.9「内容型 Sheet」）。
 * 系统 pageSheet（下滑关 + 系统抓手）承载纯阅读内容（不外链）；顶部右上角保留 X 关闭按钮。
 * 登录页与「关于家账」共用本组件（单一信源）。正文为产品发布前的公开文本草稿，正式上线前仍应完成法律审核。
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { ThemedText } from '@/components/themed-text';
import { Space, useSheetPalette } from '@/constants/design';

export type LegalKind = 'terms' | 'privacy';

const TITLES: Record<LegalKind, string> = { terms: '用户协议', privacy: '隐私政策' };

/** 公开条款正文。每段一个小标题 + 正文；主体名称与联系方式集中在正文中，避免额外增加信息章节。 */
const SECTIONS: Record<LegalKind, { h: string; p: string }[]> = {
  terms: [
    {
      h: '协议说明',
      p: '欢迎使用家账（HomeBook）。本应用由个人开发者运营，提供家庭记账、账本协作、预算、储蓄目标和统计报表等服务。隐私及客服邮箱：homebook-feedback@outlook.com。点击同意、注册、登录或实际使用本应用，即表示你已阅读、理解并同意本协议及《隐私政策》。',
    },
    {
      h: '一、服务范围',
      p: '本应用用于辅助家庭记录收入、支出、预算、储蓄目标和相关统计信息。本应用不提供投资、理财、借贷、支付、税务、会计或其他专业建议，数据和统计结果仅供你参考。',
    },
    {
      h: '二、账号使用',
      p: '你应提供真实、准确、合法的信息，并妥善保管账号、密码和验证码。账号下的操作原则上视为由你本人进行。发现账号异常时，请及时通过 homebook-feedback@outlook.com 联系我们。',
    },
    {
      h: '三、家庭账本与成员协作',
      p: '家庭账本数据属于对应家庭的数据，家庭成员可在其权限范围内查看和使用。你应确保自己有权提交和分享家庭名称、图片、备注及其他内容。普通成员退出或注销后，历史流水可能继续保留在原家庭，以保证家庭账本的连续性。',
    },
    {
      h: '四、用户行为规范',
      p: '你不得利用本应用从事违法犯罪、欺诈、洗钱、侵害他人权益、冒用身份、传播违法或侵权内容、恶意获取家庭数据、批量注册、攻击系统或反向工程等行为。违反本协议时，我们可能限制功能、暂停服务、删除违规内容或注销账号；涉嫌违法的，将依法配合有关部门处理。',
    },
    {
      h: '五、用户内容与知识产权',
      p: '你保留对自己提交内容的合法权利，但授予我们在提供、维护和改进本应用所必要范围内存储、同步、展示和处理该内容的许可。本应用的程序、界面、商标、图标、文字和设计等知识产权归家账运营者或相关权利人所有。',
    },
    {
      h: '六、服务变更与中断',
      p: '我们会持续改进本应用，可能调整功能、界面、服务范围或服务方式。因网络故障、设备故障、系统维护、不可抗力、第三方服务异常或其他无法合理控制的原因，服务可能暂时中断或延迟。我们会在合理范围内采取措施恢复服务。',
    },
    {
      h: '七、协议更新与其他',
      p: '我们可能根据法律法规、业务变化或安全需要更新本协议。更新后的版本将在应用内公布并标明生效日期；更新生效后继续使用本应用，视为接受更新后的协议。本协议适用中华人民共和国法律；如发生争议，双方应先协商解决。',
    },
  ],
  privacy: [
    {
      h: '政策说明',
      p: '本政策适用于家账（HomeBook）。本应用由个人开发者运营，隐私及客服邮箱为 homebook-feedback@outlook.com。本政策用于说明我们如何收集、使用、保存、共享和保护你的个人信息。',
    },
    {
      h: '一、我们收集的信息',
      p: '为提供账号和家庭记账服务，我们可能处理手机号、邮箱、登录凭据、昵称、头像、家庭名称和封面、家庭成员关系、邀请码、收入和支出金额、分类、备注、发生时间、预算、储蓄目标、定期记账规则、报表统计、通知记录，以及你主动提交的反馈内容和图片。',
    },
    {
      h: '二、设备与权限信息',
      p: '在你使用对应功能时，本应用可能申请相机权限以扫描家庭邀请二维码，申请相册权限以选择头像、家庭封面或反馈截图，申请媒体写入权限以保存二维码，申请通知权限以发送系统通知。提交反馈时，我们可能附带应用版本、平台、系统版本、设备型号、设备品牌和时区等诊断信息。',
    },
    {
      h: '三、信息的使用',
      p: '我们使用上述信息用于账号登录和安全、家庭账本协作、数据同步、预算和储蓄统计、通知提醒、处理意见反馈、定位故障、防止滥用和履行法律义务。我们不会出售个人信息，不会将家庭账本数据用于广告画像或与本应用无关的商业用途。',
    },
    {
      h: '四、信息共享与第三方服务',
      p: '家庭账本信息会在对应家庭成员的权限范围内共享。为提供服务器、数据库、短信、邮件、对象存储、登录或推送服务，我们可能委托阿里云、Apple、Expo Push Service 或其他实际启用的服务商处理必要信息，并要求其仅在约定目的和范围内处理。除法律法规要求、保护用户和服务安全或经你授权外，我们不会向无关第三方提供你的个人信息。',
    },
    {
      h: '五、图片和公开访问地址',
      p: '你主动上传的头像、家庭头像、家庭封面或反馈图片可能通过公开访问地址展示。任何获得图片链接的人均可能访问对应图片，请不要上传身份证件、银行卡、账单、住址或其他不适合公开传播的内容。',
    },
    {
      h: '六、信息保存与安全',
      p: '核心业务数据部署在中华人民共和国境内。我们仅在实现服务目的所必需的期限内保存个人信息，法律法规另有规定或处理争议、安全事件所必需的除外。我们会采取访问控制、身份验证、权限隔离、传输加密、备份和安全管理等措施保护信息，但任何网络服务都无法保证绝对安全。',
    },
    {
      h: '七、账号注销与数据删除',
      p: '你可以在应用内发起账号注销。注销后，手机号、邮箱、密码、第三方登录身份和设备推送令牌将被解绑或删除，个人头像等资料将被删除。你在家庭中的历史流水可能继续保留在原家庭中；与个人身份有关的信息将被匿名化为非个人化标识。注销操作可能无法恢复。',
    },
    {
      h: '八、你的权利',
      p: '在符合法律法规和技术条件的情况下，你可以查询、复制、更正、删除个人信息，撤回部分授权，关闭通知权限，注销账号，或要求我们解释个人信息处理规则。你可以通过应用内设置或发送邮件至 homebook-feedback@outlook.com 行使上述权利；为保护账号安全，我们可能需要验证你的身份。',
    },
    {
      h: '九、未成年人保护与政策更新',
      p: '本应用不以未成年人为主要服务对象。未满十八周岁的用户应在监护人同意和指导下使用本应用。我们可能根据法律法规、业务变化或安全需要更新本政策，并在应用内标明最新版本和生效日期。',
    },
  ],
};

export function LegalSheet({ kind, onClose }: { kind: LegalKind | null; onClose: () => void }) {
  // iOS 的 pageSheet 在拖拽关闭时会先触发 onRequestClose，再继续原生退出动画。
  // 保留最后打开的正文到 onDismiss，避免动画期间露出 Modal 默认的白色容器。
  const [presentedKind, setPresentedKind] = useState<LegalKind | null>(null);
  const displayedKind = kind ?? presentedKind;

  return (
    <PageSheet
      visible={kind !== null}
      onClose={() => {
        setPresentedKind(kind);
        onClose();
      }}
      onDismiss={() => {
        if (kind === null) setPresentedKind(null);
      }}
    >
      {displayedKind !== null ? <Body kind={displayedKind} /> : null}
    </PageSheet>
  );
}

function Body({ kind }: { kind: LegalKind }) {
  const palette = useSheetPalette();
  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（纯预览型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title={TITLES[kind]} />
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator>
          {SECTIONS[kind].map((s) => (
            <View key={s.h} style={styles.section}>
              <ThemedText style={[styles.h, { color: palette.textPrimary }]}>{s.h}</ThemedText>
              <ThemedText style={[styles.p, { color: palette.textSecondary }]}>{s.p}</ThemedText>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1 },
  bodyContent: { paddingTop: SHEET_CONTENT_TOP_PADDING, paddingHorizontal: Space[6], paddingBottom: Space[6] },
  section: { marginBottom: Space[5] },
  h: { fontSize: 16, fontWeight: '600', marginBottom: Space[2] },
  p: { fontSize: 15, lineHeight: 22 },
  note: { fontSize: 13, lineHeight: 20, marginTop: Space[2] },
});
