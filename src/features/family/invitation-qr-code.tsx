import { useMemo } from 'react';
import type { ImageSourcePropType } from 'react-native';
import Svg, { G, Image, Path, Rect } from 'react-native-svg';

import { createInvitationQrMatrix } from './invitation-qr-matrix';

type InvitationQrCodeProps = {
  value: string;
  size: number;
  logo: ImageSourcePropType;
  logoSize: number;
  logoMargin: number;
  logoBorderRadius: number;
  getRef?: (ref: Svg | null) => void;
};

function matrixToPath(data: Uint8Array, moduleCount: number, moduleSize: number): string {
  let path = '';

  for (let row = 0; row < moduleCount; row += 1) {
    let runStart = -1;
    const y = (row + 0.5) * moduleSize;

    for (let column = 0; column <= moduleCount; column += 1) {
      const isDark = column < moduleCount && data[row * moduleCount + column] === 1;
      if (isDark && runStart < 0) {
        runStart = column;
      } else if (!isDark && runStart >= 0) {
        path += `M${runStart * moduleSize} ${y}H${column * moduleSize} `;
        runStart = -1;
      }
    }
  }

  return path;
}

/** 固定 Version 3 的邀请二维码；保存相册与屏幕展示共用同一张 SVG。 */
export function InvitationQrCode({
  value,
  size,
  logo,
  logoSize,
  logoMargin,
  logoBorderRadius,
  getRef,
}: InvitationQrCodeProps) {
  const { path, moduleSize } = useMemo(() => {
    const matrix = createInvitationQrMatrix(value);
    const moduleSize = size / matrix.modules.size;
    return {
      moduleSize,
      path: matrixToPath(matrix.modules.data, matrix.modules.size, moduleSize),
    };
  }, [size, value]);
  const logoBackgroundSize = logoSize + logoMargin * 2;
  const logoPosition = (size - logoBackgroundSize) / 2;

  return (
    <Svg ref={getRef} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Rect width={size} height={size} fill="#FFFFFF" />
      <Path d={path} stroke="#000000" strokeLinecap="butt" strokeWidth={moduleSize} />
      <G>
        <Rect
          x={logoPosition}
          y={logoPosition}
          width={logoBackgroundSize}
          height={logoBackgroundSize}
          rx={logoBorderRadius}
          ry={logoBorderRadius}
          fill="#FFFFFF"
        />
        <Image
          x={logoPosition + logoMargin}
          y={logoPosition + logoMargin}
          width={logoSize}
          height={logoSize}
          href={logo}
          preserveAspectRatio="xMidYMid slice"
        />
      </G>
    </Svg>
  );
}
