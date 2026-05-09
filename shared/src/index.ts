export type GameType = "REC" | "DUPR";
export type GameFormat = "SINGLES" | "DOUBLES" | "MIXED";

export interface ContactIdentity {
  email?: string;
  phone?: string;
}

export interface BuddyInvite extends ContactIdentity {
  invitedByUserId: string;
}

