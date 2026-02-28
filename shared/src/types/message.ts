// @discord/shared — Message types

export type MessageType = 'text' | 'image' | 'system';

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  type: MessageType;
  createdAt: string;
  updatedAt: string;
  /** Joined from users table for display */
  author?: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
}

/** Cursor-paginated message response */
export interface PaginatedMessages {
  messages: Message[];
  nextCursor: string | null;
}
