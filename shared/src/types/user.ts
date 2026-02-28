// @discord/shared — User types

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Subset of User sent in READY payload and public profiles */
export interface UserProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
}

/** What the auth endpoints return */
export interface AuthResponse {
  user: UserProfile;
  token: string;
}
