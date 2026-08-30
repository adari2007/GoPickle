export interface QpPlacement {
  position: number;
  label: string;
  playerIds: string[];
}

export interface QpSession {
  id: string;
  name: string;
  format: "SINGLES" | "ROUND_ROBIN";
  rrType: "SET" | "SWITCH";
  courtCount: number;
  courtLabels: string[];
  playerIds: string[];
  guestNames: Array<{ id: string; name: string }>;
  placements: QpPlacement[];
  matchesPerPlayer: number;
  setsPerMatch: number;
  teams: string[][];
  status: "SETUP" | "SCHEDULED" | "ACTIVE" | "PLAYOFFS" | "COMPLETED";
  createdBy: string;
  createdAt: string;
}

export interface QpMatch {
  id: string;
  sessionId: string;
  roundNumber: number;
  court?: string;
  team1Ids: string[];
  team2Ids: string[];
  scoreTeam1?: number;
  scoreTeam2?: number;
  setScores?: Array<[number, number]>;
  winnerIds?: string[];
  status: string;
  isPlayoff: boolean;
}

export interface QpStanding {
  playerId: string;
  teamIds?: string[];
  playerName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface TournamentEvent {
  id: string;
  tournamentId: string;
  eventType: string;
  skillLevel: string;
  ageBracket: string;
  rrFinalized: boolean;
  scheduleFinalized: boolean;
  groupsFinalized: boolean;
  createdAt: string;
}

export interface TournamentGroup {
  id: string;
  tournamentId: string;
  eventId: string;
  name: string;
  memberRegistrationIds: string[];
}

export interface TournamentSubDivision {
  id: string;
  tournamentId: string;
  eventId: string;
  tier: "GRAND_MASTERS" | "MASTERS" | "EXPERTS" | "ADVANCED";
  members: Array<{ registrationId: string; seed: number }>;
}

export interface ClubSummary {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  memberIds: string[];
  privacy: "PUBLIC" | "PRIVATE";
  allowDirectJoin: boolean;
  location?: string;
  joinCode?: string;
}

export interface ClubSession {
  id: string;
  clubId: string;
  name: string;
  sessionType: string;
  format: string;
  skillMin?: string;
  skillMax?: string;
  status: string;
  createdBy: string;
  scheduledAt?: string;
  createdAt: string;
}

export interface LeagueSummary {
  id: string;
  name: string;
  clubId?: string;
  format: "FIXED_PARTNER" | "ROTATIONAL";
  durationWeeks: number;
  dropWeeks: number;
  playersPerCourt: number;
  skillLevel?: string;
  location?: string;
  description?: string;
  startDate?: string;
  status: "REGISTRATION" | "ACTIVE" | "COMPLETED";
  createdBy: string;
  createdAt: string;
}

export interface LeagueWeek {
  id: string;
  leagueId: string;
  weekNumber: number;
  scheduledAt?: string;
  status: string;
  createdAt: string;
}

export interface LeagueWeekResult {
  id: string;
  weekId: string;
  leagueId: string;
  playerId: string;
  playerName: string;
  court: number;
  wins: number;
  pointsScored: number;
  pointsAgainst: number;
  attended: boolean;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

// Tenant + auth context, set once at bootstrap (main.tsx) and on login.
let orgSlug: string | null = null;
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setOrgSlug(slug: string | null) { orgSlug = slug; }
export function setAuthToken(token: string | null) { authToken = token; }
export function setOnUnauthorized(fn: (() => void) | null) { onUnauthorized = fn; }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hadToken = !!authToken;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(orgSlug ? { "X-Org-Slug": orgSlug } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    // A 401 while holding a token means it expired or was revoked — reset the
    // stored session. (401s from the login form itself carry no token.)
    if (response.status === 401 && hadToken && onUnauthorized) onUnauthorized();
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {}
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export interface OrgUserInfo { id: string; name: string; email?: string; phone?: string; role: "ADMIN" | "MEMBER"; duprRating?: number }

export const api = {
  login: (payload: { email?: string; phone?: string; password: string }) =>
    request<{ token: string; user: { id: string; name: string; email?: string; phone?: string; duprId?: string; duprRating?: number; duprRatingSingles?: number; duprRatingDoubles?: number; duprRatingMixed?: number; role?: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  register: (payload: { name: string; email?: string; phone?: string; password: string }) =>
    request<{ token: string; user: { id: string; name: string; email?: string; phone?: string; duprId?: string; duprRating?: number; duprRatingSingles?: number; duprRatingDoubles?: number; duprRatingMixed?: number; role?: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  searchUsers: (q: string, userId: string) =>
    request<{ users: Array<{ id: string; name: string; email?: string; phone?: string }> }>(
      `/users/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`
    ),

  addBuddy: (payload: { userId: string; buddyId?: string; buddyEmail?: string; buddyPhone?: string; buddyName?: string }) =>
    request<{ buddy: { id: string; name: string; email?: string; phone?: string } }>("/buddies/add", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  listBuddies: (userId: string) => request<{ buddies: Array<{ id: string; name: string; email?: string; phone?: string }> }>(`/buddies/${userId}`),

  createClub: (payload: { createdBy: string; name: string; description?: string; privacy?: "PUBLIC" | "PRIVATE"; allowDirectJoin?: boolean; location?: string }) =>
    request<{ club: ClubSummary }>("/clubs", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  updateClub: (clubId: string, payload: { directorId: string; privacy?: "PUBLIC" | "PRIVATE"; allowDirectJoin?: boolean; location?: string; description?: string; regenerateCode?: boolean }) =>
    request<{ club: ClubSummary }>(`/clubs/${clubId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  listClubs: () => request<{ clubs: ClubSummary[] }>("/clubs"),

  getClub: (clubId: string) =>
    request<{ club: ClubSummary & { members: Array<{ id: string; name: string; email?: string; phone?: string; duprRating?: number }>; pendingInviteUserIds: string[] } }>(`/clubs/${clubId}`),

  joinClub: (clubId: string, userId: string) =>
    request<{ club?: ClubSummary; status?: string; message?: string }>(`/clubs/${clubId}/join`, {
      method: "POST",
      body: JSON.stringify({ userId })
    }),

  joinClubByCode: (code: string, userId: string) =>
    request<{ club: ClubSummary; message: string }>(`/clubs/join-by-code/${code}`, {
      method: "POST",
      body: JSON.stringify({ userId })
    }),

  getClubJoinRequests: (clubId: string) =>
    request<{ requests: Array<{ id: string; clubId: string; userId: string; userName: string; status: string; createdAt: string }> }>(`/clubs/${clubId}/join-requests`),

  approveJoinRequest: (requestId: string, directorId: string) =>
    request<{ message: string }>(`/club-join-requests/${requestId}/approve`, {
      method: "POST",
      body: JSON.stringify({ directorId })
    }),

  denyJoinRequest: (requestId: string, directorId: string) =>
    request<{ message: string }>(`/club-join-requests/${requestId}/deny`, {
      method: "POST",
      body: JSON.stringify({ directorId })
    }),

  createClubSession: (clubId: string, payload: { createdBy: string; name: string; sessionType?: string; format?: string; skillMin?: string; skillMax?: string; scheduledAt?: string }) =>
    request<{ session: ClubSession }>(`/clubs/${clubId}/sessions`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  getClubSessions: (clubId: string) =>
    request<{ sessions: Array<ClubSession & { gamesCount: number }> }>(`/clubs/${clubId}/sessions`),

  approveClubSession: (sessionId: string, directorId: string) =>
    request<{ message: string }>(`/club-sessions/${sessionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ directorId })
    }),

  getClubAnalytics: (clubId: string) =>
    request<{ memberCount: number; sessionCount: number; approvedSessionCount: number; gameCount: number; avgDuprRating: number | null; topPlayers: Array<{ id: string; name: string; duprRating?: number }> }>(`/clubs/${clubId}/analytics`),

  updateUserRating: (userId: string, duprRating: number) =>
    request<{ user: any }>(`/users/${userId}/rating`, {
      method: "PATCH",
      body: JSON.stringify({ duprRating })
    }),

  updateUserProfile: (userId: string, payload: { duprId?: string; duprRating?: number | null; duprRatingSingles?: number | null; duprRatingDoubles?: number | null; duprRatingMixed?: number | null }) =>
    request<{ user: { id: string; name: string; email?: string; phone?: string; duprId?: string; duprRating?: number; duprRatingSingles?: number; duprRatingDoubles?: number; duprRatingMixed?: number; role?: string } }>(`/users/${userId}/profile`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  inviteToClub: (clubId: string, payload: { invitedBy: string; userId: string }) =>
    request<{ inviteId: string }>(`/clubs/${clubId}/invite`, { method: "POST", body: JSON.stringify(payload) }),

  listClubInvites: (userId: string) =>
    request<{ invites: Array<{ id: string; clubId: string; clubName: string; invitedByName: string; createdAt: string }> }>(`/club-invites/${userId}`),

  acceptClubInvite: (inviteId: string) =>
    request<{ message: string }>(`/club-invites/${inviteId}/accept`, { method: "POST" }),

  declineClubInvite: (inviteId: string) =>
    request<{ message: string }>(`/club-invites/${inviteId}/decline`, { method: "POST" }),

  createGame: (payload: {
    createdBy: string;
    type: "REC" | "DUPR";
    format: "SINGLES" | "DOUBLES" | "MIXED";
    participantIds: string[];
    score: string;
  }) =>
    request<{ game: { id: string; type: string; format: string; score: string; participantIds: string[] } }>("/games", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  listGames: () => request<{ games: Array<{ id: string; type: string; format: string; score: string; participantIds: string[] }> }>("/games"),

  createTournament: (payload: {
    createdBy: string; name: string;
    events: Array<{ eventType: string; skillLevel?: string; ageBracket?: "OPEN" | "YOUNG" | "SENIOR" }>;
    registrationContact?: string; tournamentContact?: string;
    coordinators?: { name: string; contact?: string; role?: string }[]; bannerData?: string;
    format?: string; maxTeams?: number; location?: string;
    startDate?: string; endDate?: string;
    registrationStartDate?: string; registrationEndDate?: string; withdrawDeadline?: string;
    description?: string; roundRobinType?: string; clubId?: string; isDuprReported?: boolean;
  }) =>
    request<{ tournament: { id: string; name: string; eventType: string; format: string; status: string } }>("/tournaments", {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  listTournaments: () =>
    request<{ tournaments: Array<{ id: string; name: string; eventType: string; format: string; skillLevel?: string; location?: string; startDate?: string; participantIds: string[]; status: string }> }>("/tournaments"),

  getTournament: (id: string) =>
    request<{ tournament: any }>(`/tournaments/${id}`),

  registerForTournament: (id: string, payload: { userId: string; tournamentEventId?: string; partnerId?: string; duprId?: string; duprRating?: number; partnerDuprId?: string; partnerDuprRating?: number; teamName?: string; paymentProof?: string }) =>
    request<{ message: string; registrationId: string }>(`/tournaments/${id}/register`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  updateTeamName: (tournamentId: string, regId: string, payload: { userId: string; teamName: string }) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/registrations/${regId}/team-name`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  pairSoloPlayers: (tournamentId: string, payload: { organizerId: string; reg1Id: string; reg2Id: string; teamName?: string }) =>
    request<{ message: string; registrationId: string }>(`/tournaments/${tournamentId}/pair-solo`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  updateTeamMembers: (tournamentId: string, regId: string, payload: { organizerId: string; playerId?: string; partnerId?: string | null }) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/registrations/${regId}/members`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  orgRegisterPlayer: (id: string, payload: { organizerId: string; targetUserId: string; tournamentEventId?: string; partnerId?: string; duprId?: string; duprRating?: number }) =>
    request<{ message: string; registrationId: string }>(`/tournaments/${id}/register-player`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  unregisterFromTournament: (tournamentId: string, registrationId: string, userId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/registrations/${registrationId}`, {
      method: "DELETE",
      body: JSON.stringify({ userId })
    }),

  orgUpdateRegistration: (tournamentId: string, registrationId: string, payload: { organizerId: string; status?: string; tournamentEventId?: string | null; partnerId?: string | null }) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/registrations/${registrationId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  updateTournamentDetails: (id: string, payload: { organizerId: string; name?: string; location?: string | null; startDate?: string | null; endDate?: string | null; registrationStartDate?: string | null; registrationEndDate?: string | null; withdrawDeadline?: string | null; description?: string | null; maxTeams?: number | null; isDuprReported?: boolean; registrationClosed?: boolean ; registrationContact?: string | null; tournamentContact?: string | null; coordinators?: { name: string; contact?: string; role?: string }[]; bannerData?: string | null }) =>
    request<{ tournament: any }>(`/tournaments/${id}/details`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  createTournamentGroups: (id: string, payload: { organizerId: string; eventId: string; groupCount: number; names?: string[] }) =>
    request<{ groups: Array<{ id: string; name: string }> }>(`/tournaments/${id}/groups`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  assignGroupMember: (id: string, groupId: string, payload: { organizerId: string; registrationId: string; action: "add" | "remove" }) =>
    request<{ ok: boolean }>(`/tournaments/${id}/groups/${groupId}/members`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  generateGroupSchedule: (id: string, groupId: string, organizerId: string, opts?: { courtCount?: number; courtLabels?: string[]; scheduleDate?: string; scheduleTime?: string }) =>
    request<{ matchCount: number }>(`/tournaments/${id}/groups/${groupId}/generate`, {
      method: "POST",
      body: JSON.stringify({ organizerId, ...opts })
    }),

  createPlayoffs: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string; count: number; bracketType: string }>(`/tournaments/${tournamentId}/playoffs`, {
      method: "POST",
      body: JSON.stringify({ organizerId, eventId })
    }),

  createThirdPlaceMatch: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/playoffs/third-place`, {
      method: "POST",
      body: JSON.stringify({ organizerId, eventId })
    }),

  declareWinners: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/events/${eventId}/declare-winners`, {
      method: "POST",
      body: JSON.stringify({ organizerId })
    }),

  finalizeGroups: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/events/${eventId}/finalize-groups`, {
      method: "PATCH",
      body: JSON.stringify({ organizerId })
    }),

  finalizeSchedule: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/events/${eventId}/finalize-schedule`, {
      method: "PATCH",
      body: JSON.stringify({ organizerId })
    }),

  finalizeRR: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/events/${eventId}/finalize-rr`, {
      method: "PATCH",
      body: JSON.stringify({ organizerId })
    }),

  createSubDivisions: (id: string, payload: { organizerId: string; eventId: string }) =>
    request<{ subDivisions: Array<{ id: string; tier: string; memberCount: number }> }>(`/tournaments/${id}/sub-divisions`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  generateSubDivBracket: (id: string, subDivId: string, organizerId: string) =>
    request<{ matchCount: number }>(`/tournaments/${id}/sub-divisions/${subDivId}/generate-bracket`, {
      method: "POST",
      body: JSON.stringify({ organizerId })
    }),

  createSubDivThirdPlaceMatch: (tournamentId: string, subDivId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/sub-divisions/${subDivId}/third-place`, {
      method: "POST",
      body: JSON.stringify({ organizerId })
    }),

  declareSubDivWinners: (tournamentId: string, subDivId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/sub-divisions/${subDivId}/declare-winners`, {
      method: "POST",
      body: JSON.stringify({ organizerId })
    }),

  listTournamentPartnerInvites: (userId: string) =>
    request<{ invites: Array<any> }>(`/tournament-partner-invites/${userId}`),

  acceptTournamentPartnerInvite: (inviteId: string, userId: string) =>
    request<{ message: string }>(`/tournament-partner-invites/${inviteId}/accept`, {
      method: "POST",
      body: JSON.stringify({ userId })
    }),

  declineTournamentPartnerInvite: (inviteId: string) =>
    request<{ message: string }>(`/tournament-partner-invites/${inviteId}/decline`, { method: "POST" }),

  generateSchedule: (tournamentId: string, organizerId: string, tournamentEventId?: string, opts?: { courtCount?: number; courtLabels?: string[]; scheduleDate?: string; scheduleTime?: string }) =>
    request<{ message: string; count: number }>(`/tournaments/${tournamentId}/generate-schedule`, {
      method: "POST",
      body: JSON.stringify({ organizerId, tournamentEventId, ...opts })
    }),

  reportMatchScore: (matchId: string, payload: { reportedBy: string; scoreTeam1?: number; scoreTeam2?: number; scoreRaw?: string }) =>
    request<{ message: string }>(`/tournament-matches/${matchId}/report`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  confirmMatchScore: (matchId: string, confirmedBy: string) =>
    request<{ message: string }>(`/tournament-matches/${matchId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmedBy })
    }),

  editMatchScore: (matchId: string, payload: { editedBy: string; scoreTeam1?: number; scoreTeam2?: number; court?: string }) =>
    request<{ message: string }>(`/tournament-matches/${matchId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  updateTournamentStatus: (id: string, payload: { organizerId: string; status: "PLANNED" | "ACTIVE" | "COMPLETED" }) =>
    request<{ message: string }>(`/tournaments/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),

  cancelTournament: (id: string, payload: { organizerId: string; reason: string }) =>
    request<{ message: string }>(`/tournaments/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  closeTournament: (id: string, payload: { organizerId: string; placements: Array<{ position: number; playerIds: string[]; label?: string; note?: string }> }) =>
    request<{ message: string }>(`/tournaments/${id}/close`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),

  // ── Leagues ──────────────────────────────────────────────────────────────

  createLeague: (payload: {
    createdBy: string; name: string; clubId?: string;
    format?: "FIXED_PARTNER" | "ROTATIONAL"; durationWeeks?: number; dropWeeks?: number;
    playersPerCourt?: number; skillLevel?: string; location?: string; description?: string; startDate?: string;
  }) =>
    request<{ league: LeagueSummary }>("/leagues", { method: "POST", body: JSON.stringify(payload) }),

  listLeagues: () => request<{ leagues: LeagueSummary[] }>("/leagues"),

  getLeague: (id: string) => request<{ league: LeagueSummary & { registrations: any[]; weeks: LeagueWeek[] } }>(`/leagues/${id}`),

  registerForLeague: (id: string, payload: { userId: string; partnerId?: string }) =>
    request<{ message: string; registrationId: string }>(`/leagues/${id}/register`, { method: "POST", body: JSON.stringify(payload) }),

  generateLeagueWeek: (id: string, payload: { organizerId: string; scheduledAt?: string }) =>
    request<{ message: string; weekId: string; courts: number }>(`/leagues/${id}/generate-week`, { method: "POST", body: JSON.stringify(payload) }),

  getWeekResults: (weekId: string) =>
    request<{ results: LeagueWeekResult[] }>(`/league-weeks/${weekId}/results`),

  updateWeekResult: (resultId: string, payload: { organizerId: string; wins?: number; pointsScored?: number; pointsAgainst?: number; attended?: boolean }) =>
    request<{ message: string }>(`/league-week-results/${resultId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  updateLeagueStatus: (id: string, payload: { organizerId: string; status: "REGISTRATION" | "ACTIVE" | "COMPLETED" }) =>
    request<{ message: string }>(`/leagues/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) }),

  getLeagueStandings: (id: string) =>
    request<{ standings: Array<{ playerId: string; playerName: string; totalWins: number; totalPoints: number; weeksPlayed: number; droppedWeeks: number }> }>(`/leagues/${id}/standings`),

  // ── Quick Play ──────────────────────────────────────────────────────────────

  createQpSession: (payload: { createdBy: string; name: string; format?: "SINGLES" | "ROUND_ROBIN"; rrType?: "SET" | "SWITCH"; courtCount?: number; courtLabels?: string[]; playerIds?: string[]; guestNames?: string[]; matchesPerPlayer?: number; setsPerMatch?: number }) =>
    request<{ session: QpSession }>("/quick-play", { method: "POST", body: JSON.stringify(payload) }),

  listQpSessions: () => request<{ sessions: QpSession[] }>("/quick-play"),

  getQpSession: (id: string) =>
    request<{ session: QpSession; matches: QpMatch[]; playerNames: Record<string, string> }>(`/quick-play/${id}`),

  updateQpPlayers: (id: string, payload: { playerIds?: string[]; guestNames?: string[]; addPlayerId?: string; removePlayerId?: string; addGuestName?: string; removeGuestId?: string }) =>
    request<{ session: QpSession }>(`/quick-play/${id}/players`, { method: "PATCH", body: JSON.stringify(payload) }),

  updateQpSettings: (id: string, payload: { courtCount?: number; courtLabels?: string[]; matchesPerPlayer?: number; setsPerMatch?: number }) =>
    request<{ session: QpSession }>(`/quick-play/${id}/settings`, { method: "PATCH", body: JSON.stringify(payload) }),

  saveQpTeams: (id: string, teams: string[][]) =>
    request<{ session: QpSession }>(`/quick-play/${id}/teams`, { method: "PATCH", body: JSON.stringify({ teams }) }),

  generateQpSchedule: (id: string, organizerId: string) =>
    request<{ message: string; rounds: number; games: number }>(`/quick-play/${id}/generate`, { method: "POST", body: JSON.stringify({ organizerId }) }),

  finalizeQpSession: (id: string) =>
    request<{ message: string }>(`/quick-play/${id}/finalize`, { method: "PATCH", body: "{}" }),

  deleteQpMatch: (matchId: string) =>
    request<{ message: string }>(`/quick-play/matches/${matchId}`, { method: "DELETE" }),

  editQpMatch: (matchId: string, payload: { court?: string; scoreTeam1?: number; scoreTeam2?: number }) =>
    request<{ match: QpMatch }>(`/quick-play/matches/${matchId}`, { method: "PATCH", body: JSON.stringify(payload) }),

  submitQpScore: (matchId: string, payload: { scoreTeam1: number; scoreTeam2: number } | { sets: Array<[number, number]> }) =>
    request<{ message: string }>(`/quick-play/matches/${matchId}/score`, { method: "POST", body: JSON.stringify(payload) }),

  getQpStandings: (id: string) =>
    request<{ standings: QpStanding[] }>(`/quick-play/${id}/standings`),

  createQpPlayoffs: (id: string) =>
    request<{ message: string; semifinals: any[] }>(`/quick-play/${id}/playoffs`, { method: "POST", body: "{}" }),

  createQpThirdPlace: (id: string) =>
    request<{ message: string; matchId: string }>(`/quick-play/${id}/third-place`, { method: "POST", body: "{}" }),

  declareQpWinner: (id: string) =>
    request<{ message: string; placements: QpPlacement[] }>(`/quick-play/${id}/declare-winner`, { method: "POST", body: "{}" }),

  closeQpSession: (id: string) =>
    request<{ message: string }>(`/quick-play/${id}/close`, { method: "PATCH", body: "{}" }),

  deleteQpSession: (id: string, organizerId: string) =>
    request<{ message: string }>(`/quick-play/${id}`, { method: "DELETE", body: JSON.stringify({ organizerId }) }),
  // ── Organizations ─────────────────────────────────────────────────────────
  getOrgBranding: (slug: string) =>
    request<{ slug: string; name: string; logoUrl: string | null; theme: { primary?: string; accent?: string; bg?: string; preset?: string }; features: { buddies: boolean; clubs: boolean; games: boolean; tournaments: boolean; leagues: boolean; quickPlay: boolean }; settings?: { defaultTournamentMode?: "none" | "active" | "specific"; defaultTournamentId?: string | null } }>(`/orgs/${slug}/branding`),

  createOrg: (payload: { slug: string; name: string; logoUrl?: string; theme?: { primary?: string; accent?: string; bg?: string; preset?: string }; admin: { name: string; email?: string; phone?: string; password: string } }) =>
    request<{ org: any; user: { id: string; name: string; email?: string; phone?: string; role: string } }>("/orgs", { method: "POST", body: JSON.stringify(payload) }),

  updateOrg: (slug: string, patch: { name?: string; logoUrl?: string | null; logoData?: string | null; theme?: { primary?: string; accent?: string; bg?: string; preset?: string }; settings?: { defaultTournamentMode?: "none" | "active" | "specific"; defaultTournamentId?: string | null } }) =>
    request<{ org: any }>(`/orgs/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }),

  getOrgMembers: (slug: string) =>
    request<{ members: OrgUserInfo[] }>(`/orgs/${slug}/members`),

  setMemberRole: (slug: string, userId: string, role: "ADMIN" | "MEMBER") =>
    request<{ member: { id: string; name: string; role: string } }>(`/orgs/${slug}/members/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),

  // ── Super admin (platform) ────────────────────────────────────────────────
  superLogin: (payload: { email: string; password: string }) =>
    request<{ token: string }>("/super/login", { method: "POST", body: JSON.stringify(payload) }),

  superListOrgs: () =>
    request<{ orgs: any[] }>("/super/orgs"),

  superUpdateOrg: (slug: string, patch: { name?: string; logoUrl?: string | null; logoData?: string | null; theme?: any; features?: any; settings?: any; status?: "READY" | "SUSPENDED" }) =>
    request<{ org: any }>(`/super/orgs/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }),

  superListAdmins: () =>
    request<{ admins: { id: string; email: string; createdAt: string }[] }>("/super/admins"),

  superAddAdmin: (payload: { email: string; password: string }) =>
    request<{ admin: { id: string; email: string } }>("/super/admins", { method: "POST", body: JSON.stringify(payload) }),

  superRemoveAdmin: (id: string) =>
    request<{ message: string }>(`/super/admins/${id}`, { method: "DELETE" }),

  superChangePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ message: string }>("/super/password", { method: "PATCH", body: JSON.stringify(payload) }),

  // ── Membership plans ───────────────────────────────────────────────────────
  superListPlans: () =>
    request<{ plans: { id: string; label: string; price: number | null; billingCycle: string; unlockedFeatures: string[]; credits: number | null; expiryDays: number | null }[] }>("/super/plans"),

  superAssignBilling: (slug: string, payload: { planId: string; pricePaid?: number | null; notes?: string }) =>
    request<{ org: any }>(`/super/orgs/${slug}/billing`, { method: "POST", body: JSON.stringify(payload) }),

  getOrgPlan: (slug: string) =>
    request<{ plan: { id: string; label: string; pricePaid: number | null; startedAt: string; expiresAt: string | null; creditsRemaining: number | null } | null }>(`/orgs/${slug}/plan`),

  superGetOrgMembers: (slug: string) =>
    request<{ members: { id: string; name: string; email?: string; phone?: string; role: "ADMIN" | "MEMBER" }[] }>(`/super/orgs/${slug}/members`),

  superAddOrgMember: (slug: string, payload: { name: string; email?: string; phone?: string; password: string; role?: "ADMIN" | "MEMBER" }) =>
    request<{ member: { id: string; name: string; role: string } }>(`/super/orgs/${slug}/members`, { method: "POST", body: JSON.stringify(payload) }),

  superSetOrgMemberRole: (slug: string, userId: string, role: "ADMIN" | "MEMBER") =>
    request<{ member: { id: string; name: string; role: string } }>(`/super/orgs/${slug}/members/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),

  // ── Tournament payment proof ──────────────────────────────────────────────
  uploadPaymentProof: (tournamentId: string, regId: string, payload: { userId: string; paymentProof: string }) =>
    request<{ message: string; paymentStatus: string }>(`/tournaments/${tournamentId}/registrations/${regId}/payment-proof`, { method: "POST", body: JSON.stringify(payload) }),

  getPaymentProof: (tournamentId: string, regId: string, organizerId: string) =>
    request<{ proof: string }>(`/tournaments/${tournamentId}/registrations/${regId}/payment-proof?organizerId=${encodeURIComponent(organizerId)}`),

  addTournamentEvent: (tournamentId: string, payload: { organizerId: string; eventType: string; skillLevel?: string; ageBracket?: "OPEN" | "YOUNG" | "SENIOR" }) =>
    request<{ event: TournamentEvent }>(`/tournaments/${tournamentId}/events`, { method: "POST", body: JSON.stringify(payload) }),

  removeTournamentEvent: (tournamentId: string, eventId: string, organizerId: string) =>
    request<{ message: string }>(`/tournaments/${tournamentId}/events/${eventId}`, { method: "DELETE", body: JSON.stringify({ organizerId }) }),

  reviewPayment: (tournamentId: string, regId: string, payload: { organizerId: string; action: "APPROVE" | "REJECT" }) =>
    request<{ registrationId: string; paymentStatus: string }>(`/tournaments/${tournamentId}/registrations/${regId}/payment-review`, { method: "POST", body: JSON.stringify(payload) })
};
