import * as QRCode from 'qrcode';

/**
 * 邀请码保持 6 位原文；固定 Version 3 只增加标准填充码元，令 176pt 展示的码点更细密。
 * 高纠错等级为居中的 HomeBook 符号留出恢复空间。
 */
export const INVITATION_QR_VERSION = 3;
export const INVITATION_QR_ERROR_CORRECTION = 'H' as const;

export function createInvitationQrMatrix(value: string): QRCode.QRCode {
  return QRCode.create(value, {
    version: INVITATION_QR_VERSION,
    errorCorrectionLevel: INVITATION_QR_ERROR_CORRECTION,
  });
}
