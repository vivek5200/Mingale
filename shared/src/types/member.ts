// @discord/shared — Member types

export type MemberRole = 'owner' | 'admin' | 'member';

export interface Member {
  userId: string;
  username: string;
  avatarUrl: string | null;
  role: MemberRole;
  joinedAt: string;
}

/** Cursor-paginated member response */
export interface PaginatedMembers {
  members: Member[];
  nextCursor: string | null;
}
