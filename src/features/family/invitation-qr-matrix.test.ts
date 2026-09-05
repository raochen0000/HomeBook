import { describe, expect, it } from 'vitest';

import { createInvitationQrMatrix, INVITATION_QR_VERSION } from './invitation-qr-matrix';

describe('invitation QR matrix', () => {
  it('keeps the raw invitation code in a Version 3 matrix', () => {
    const matrix = createInvitationQrMatrix('7NHSL9');

    expect(matrix.version).toBe(INVITATION_QR_VERSION);
    expect(matrix.modules.size).toBe(29);
  });
});
