import type { User } from '@noilink/shared';

/**
 * 세션·메트릭·리포트 등에서 actor가 targetUserId 사용자를 대리할 수 있는지
 * (본인, 관리자, 동일 조직의 기업 관리자가 소속 멤버인 경우)
 */
export function userCanActOnTargetUserId(
  actor: User,
  targetUserId: string,
  allUsers: User[]
): boolean {
  if (actor.id === targetUserId) return true;
  if (actor.userType === 'ADMIN') return true;
  if (actor.userType === 'ORGANIZATION' && actor.organizationId) {
    const target = allUsers.find((u) => u.id === targetUserId);
    if (!target || target.isDeleted) return false;
    return target.organizationId === actor.organizationId;
  }
  return false;
}

/** 기관 단위 리포트·세션 트렌드 등 */
export function canAccessOrganizationResource(actor: User, organizationId: string): boolean {
  if (actor.userType === 'ADMIN') return true;
  if (actor.userType === 'ORGANIZATION' && actor.organizationId === organizationId) return true;
  return false;
}
