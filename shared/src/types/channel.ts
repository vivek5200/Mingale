// @discord/shared — Channel types

export type ChannelType = 'text' | 'voice';

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  topic: string | null;
  type: ChannelType;
  position: number;
  createdAt: string;
  updatedAt: string;
}
