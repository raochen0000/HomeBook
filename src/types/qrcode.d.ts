declare module 'qrcode' {
  export type QRCodeErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  export type QRCodeOptions = {
    version?: number;
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
  };

  export type QRCode = {
    modules: {
      size: number;
      data: Uint8Array;
    };
    version: number;
  };

  export function create(value: string, options?: QRCodeOptions): QRCode;
}
