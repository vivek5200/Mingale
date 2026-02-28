// @discord/shared — Voice state types

export interface VoiceState {
  channelId: string;
  userId: string;
  selfMute: boolean;
  selfDeaf: boolean;
}
