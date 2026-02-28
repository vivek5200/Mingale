// @discord/shared — Server types

import type { Channel } from './channel.js';
import type { VoiceState } from './voice.js';

export interface Server {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
  updatedAt: string;
}

/** Server with nested channels — used in READY payload */
export interface ServerWithChannels {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  inviteCode: string;
  channels: Channel[];
  memberCount: number;
  onlineMemberCount: number;
  voiceStates: VoiceState[];
}
