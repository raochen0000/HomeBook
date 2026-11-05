import { Button, HStack, Image, Popover, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, background, fixedSize, frame, padding, shapes, tint } from '@expo/ui/swift-ui/modifiers';

import type { FamilyMembership } from '@/api';
import { ListUserAvatar } from '@/components/list-user-avatar';
import { useSheetPalette } from '@/constants/design';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { t } from '@/i18n';

export function MemberPopover({
  members,
  selectedUserId,
  open,
  onOpenChange,
  onSelect,
}: {
  members: FamilyMembership[];
  selectedUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (userId: string) => void;
}) {
  const palette = useSheetPalette();
  const avatars = useAvatarFiles(members.map((member) => ({ id: member.userId, avatar_url: member.avatarUrl })));
  const name = members.find((member) => member.userId === selectedUserId)?.nickname ?? t('common.me');
  return (
    <Popover isPresented={open} onIsPresentedChange={onOpenChange}>
      <Popover.Trigger>
        <Button
          onPress={() => onOpenChange(true)}
          modifiers={[
            padding({ horizontal: 8, vertical: 4 }),
            background(palette.cardPill, shapes.capsule()),
            frame({ minHeight: 44 }),
            tint(palette.accent),
            accessibilityLabel(`${t('record.recorder')}: ${name}`),
            fixedSize({ horizontal: true, vertical: false }),
          ]}
        >
          <HStack spacing={4} alignment="center">
            <ListUserAvatar uri={avatars.get(selectedUserId) ?? null} nickname={name} size={22} />
            <Text>{name}</Text>
          </HStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content>
        <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 10 }), frame({ width: 220 })]}>
          {members.map((member) => {
            const active = member.userId === selectedUserId;
            return (
              <Button
                key={member.id}
                onPress={() => {
                  onSelect(member.userId);
                  onOpenChange(false);
                }}
                modifiers={[
                  frame({ minHeight: 48, maxWidth: 200, alignment: 'leading' }),
                  accessibilityLabel(`${member.nickname}${active ? t('category.selected') : ''}`),
                ]}
              >
                <HStack spacing={10} alignment="center">
                  <ListUserAvatar uri={avatars.get(member.userId) ?? null} nickname={member.nickname} size={32} />
                  <Text>{member.nickname}</Text>
                  <Spacer minLength={0} />
                  {active ? <Image systemName="checkmark" color={palette.accent} size={16} /> : null}
                </HStack>
              </Button>
            );
          })}
        </VStack>
      </Popover.Content>
    </Popover>
  );
}
