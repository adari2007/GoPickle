import { FormEvent, useEffect, useRef, useState } from "react";
import { api, LeagueSummary, LeagueWeek, LeagueWeekResult, TournamentEvent, TournamentGroup, TournamentSubDivision, QpSession, QpMatch, QpStanding, QpPlacement } from "./lib/api";
import logo from "./assets/logo-pickle.svg";
import buddyIcon from "./assets/icon-buddy.svg";
import clubIcon from "./assets/icon-club.svg";
import gameIcon from "./assets/icon-game.svg";
import trophyIcon from "./assets/icon-trophy.svg";
import quickplayIcon from "./assets/icon-quickplay.svg";
import leagueIcon from "./assets/icon-league.svg";

type User       = { id: string; name: string; email?: string; phone?: string; duprId?: string; duprRating?: number; duprRatingSingles?: number; duprRatingDoubles?: number; duprRatingMixed?: number };
type Club       = { id: string; name: string; description?: string; createdBy: string; memberIds: string[]; privacy: "PUBLIC" | "PRIVATE"; allowDirectJoin: boolean; location?: string; joinCode?: string };
type ClubMember = User & { duprRating?: number };
type ClubDetail = Club & { members: ClubMember[]; pendingInviteUserIds: string[] };
type ClubInvite = { id: string; clubId: string; clubName: string; invitedByName: string; createdAt: string };
type ClubSession = { id: string; clubId: string; name: string; sessionType: string; format: string; skillMin?: string; skillMax?: string; status: string; createdBy: string; scheduledAt?: string; createdAt: string; gamesCount?: number };
type ClubJoinRequest = { id: string; clubId: string; userId: string; userName: string; status: string; createdAt: string };
type ClubAnalytics = { memberCount: number; sessionCount: number; approvedSessionCount: number; gameCount: number; avgDuprRating: number | null; topPlayers: ClubMember[] };
type Game        = { id: string; type: string; format: string; score: string; participantIds: string[] };
type Tournament  = { id: string; name: string; eventType: string; format: string; skillLevel?: string; location?: string; startDate?: string; participantIds: string[]; status: string; isDuprReported?: boolean };
type TournamentRegistration = { id: string; tournamentId: string; playerId: string; playerName: string; playerEmail?: string; playerPhone?: string; partnerId?: string; partnerName?: string; teamName?: string; playerDuprRating?: number; partnerDuprId?: string; partnerDuprRating?: number; status: string; tournamentEventId?: string };
type TournamentMatch = { id: string; roundNumber: number; matchNumber: number; bracket: string; court?: string; scheduledAt?: string; team1Ids: string[]; team2Ids: string[]; scoreTeam1?: number; scoreTeam2?: number; winnerIds?: string[]; status: string; reportedBy?: string; tournamentEventId?: string; groupId?: string; subDivisionId?: string };
type TournamentPlacement = { id: string; position: number; playerIds: string[]; label?: string; note?: string; eventId?: string; subDivisionId?: string };
type TournamentDetail = Tournament & { createdBy: string; clubId?: string; ageBracket: string; maxTeams?: number; description?: string; roundRobinType: string; endDate?: string; registrationStartDate?: string; registrationEndDate?: string; withdrawDeadline?: string; registrationClosed?: boolean; cancelledReason?: string; cancelledAt?: string; registrations: TournamentRegistration[]; matches: TournamentMatch[]; placements: TournamentPlacement[]; events: TournamentEvent[]; groups: TournamentGroup[]; subDivisions: TournamentSubDivision[] };

const EVENT_TYPES = [
  { value: "MEN_SINGLES",    label: "Men's Singles",    isDoubles: false },
  { value: "WOMEN_SINGLES",  label: "Women's Singles",  isDoubles: false },
  { value: "MEN_DOUBLES",    label: "Men's Doubles",    isDoubles: true  },
  { value: "WOMEN_DOUBLES",  label: "Women's Doubles",  isDoubles: true  },
  { value: "MIXED_DOUBLES",  label: "Mixed Doubles",    isDoubles: true  },
] as const;

const SKILL_LEVELS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0+", "OPEN"] as const;

const AGE_BRACKETS = [
  { value: "OPEN",   label: "Open Age"    },
  { value: "YOUNG",  label: "Young (<13)" },
  { value: "SENIOR", label: "Senior (55+)" },
] as const;

function etLabel(v: string) {
  return EVENT_TYPES.find(e => e.value === v)?.label ?? v;
}
function fmt12hr(scheduledAt: string) {
  // "YYYY-MM-DD HH:MM" → "Mon May 5 · 9:30 AM"
  const parts = scheduledAt.split(" ");
  if (parts.length < 2) return scheduledAt;
  const [datePart, timePart] = parts;
  const [h, m] = timePart.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const d = new Date(datePart + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${dateLabel} · ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function abLabel(v: string) {
  return AGE_BRACKETS.find(a => a.value === v)?.label ?? v;
}
function isDoublesEvent(v: string) {
  return v.includes("DOUBLES");
}
function evCategory(v: string) {
  if (v === "MIXED_DOUBLES") return "MIXED_DOUBLES";
  if (v.includes("DOUBLES")) return "DOUBLES";
  return "SINGLES";
}
type TournamentPartnerInvite = { id: string; tournamentId: string; tournamentName: string; eventType: string; inviterId: string; inviterName: string };
type LeagueDetail = LeagueSummary & {
  registrations: Array<{ id: string; leagueId: string; playerId: string; playerName: string; partnerId?: string; partnerName?: string; status: string }>;
  weeks: LeagueWeek[];
};
type Tab = "home" | "buddies" | "clubs" | "quick-play" | "tournaments" | "leagues";
type QpDetailTab = "schedule" | "standings";

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "home",        label: "Home",        emoji: "⌂" },
  { id: "buddies",     label: "Buddies",     emoji: "👥" },
  { id: "clubs",       label: "Clubs",       emoji: "🏢" },
  { id: "quick-play",  label: "Quick Play",  emoji: "🏓" },
  { id: "tournaments", label: "Tournaments", emoji: "🏆" },
  { id: "leagues",     label: "Leagues",     emoji: "📅" },
];

function teamKey(ids: string[]) { return [...ids].sort().join("+"); }

function computeStandings(matches: TournamentMatch[], registrations: TournamentRegistration[]) {
  const standings = new Map<string, { names: string; wins: number; losses: number; spread: number; duprRating?: string }>();
  const processed = new Set<string>();
  for (const reg of registrations) {
    if (reg.status !== "CONFIRMED" || processed.has(reg.playerId)) continue;
    processed.add(reg.playerId);
    if (reg.partnerId) processed.add(reg.partnerId);
    const ids = [reg.playerId, reg.partnerId].filter(Boolean) as string[];
    let duprRating: string | undefined;
    if (reg.playerDuprRating !== undefined && reg.partnerDuprRating !== undefined) {
      duprRating = `${reg.playerDuprRating} / ${reg.partnerDuprRating}`;
    } else if (reg.playerDuprRating !== undefined) {
      duprRating = String(reg.playerDuprRating);
    } else if (reg.partnerDuprRating !== undefined) {
      duprRating = String(reg.partnerDuprRating);
    }
    standings.set(teamKey(ids), {
      names: reg.teamName ?? (reg.partnerId ? `${reg.playerName} & ${reg.partnerName ?? "?"}` : reg.playerName),
      wins: 0, losses: 0, spread: 0, duprRating
    });
  }
  for (const m of matches) {
    if (m.status !== "CONFIRMED" || !m.winnerIds?.length) continue;
    const k1 = teamKey(m.team1Ids), k2 = teamKey(m.team2Ids), wk = teamKey(m.winnerIds);
    const t1 = standings.get(k1), t2 = standings.get(k2);
    if (!t1 || !t2) continue;
    if (wk === k1) { t1.wins++; t2.losses++; } else { t2.wins++; t1.losses++; }
    if (m.scoreTeam1 !== undefined && m.scoreTeam2 !== undefined) {
      t1.spread += m.scoreTeam1 - m.scoreTeam2;
      t2.spread += m.scoreTeam2 - m.scoreTeam1;
    }
  }
  return [...standings.values()].sort((a, b) => b.wins - a.wins || b.spread - a.spread);
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-label={name}
    >
      {initials}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [contact, setContact] = useState({ email: "", phone: "", name: "", password: "" });
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [profileDuprId, setProfileDuprId] = useState("");
  const [profileDuprRatingSingles, setProfileDuprRatingSingles] = useState("");
  const [profileDuprRatingDoubles, setProfileDuprRatingDoubles] = useState("");
  const [profileDuprRatingMixed, setProfileDuprRatingMixed] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [buddyInput, setBuddyInput] = useState({ buddyEmail: "", buddyPhone: "" });
  const [buddyQuery, setBuddyQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clubName, setClubName] = useState("");
  const [clubCreatePrivacy, setClubCreatePrivacy] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [clubCreateLocation, setClubCreateLocation] = useState("");
  const [clubJoinCode, setClubJoinCode] = useState("");
  const [selectedClub, setSelectedClub] = useState<ClubDetail | null>(null);
  const [clubDetailTab, setClubDetailTab] = useState<"overview" | "sessions" | "members" | "director">("overview");
  const [clubSessions, setClubSessions] = useState<ClubSession[]>([]);
  const [clubJoinRequests, setClubJoinRequests] = useState<ClubJoinRequest[]>([]);
  const [clubAnalytics, setClubAnalytics] = useState<ClubAnalytics | null>(null);
  const [newSession, setNewSession] = useState({ name: "", sessionType: "COMPETITIVE", format: "DOUBLES", skillMin: "", skillMax: "", scheduledAt: "" });
  const [clubSettings, setClubSettings] = useState({ description: "", location: "", privacy: "PUBLIC" as "PUBLIC" | "PRIVATE", allowDirectJoin: true });
  const [editingRatingId, setEditingRatingId] = useState<string | null>(null);
  const [ratingInput, setRatingInput] = useState("");
  const [clubInvites, setClubInvites] = useState<ClubInvite[]>([]);
  const [clubInviteQuery, setClubInviteQuery] = useState("");
  const [clubInviteResults, setClubInviteResults] = useState<User[]>([]);
  const [clubInviteSearching, setClubInviteSearching] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [pendingInviteIds, setPendingInviteIds] = useState<Set<string>>(new Set());
  const clubInviteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameInput, setGameInput] = useState({ type: "REC", format: "DOUBLES", score: "", participants: "" });

  // ── Quick Play state ─────────────────────────────────────────────────────────
  const [qpSessions, setQpSessions] = useState<QpSession[]>([]);
  const [selectedQp, setSelectedQp] = useState<{ session: QpSession; matches: QpMatch[]; playerNames: Record<string, string> } | null>(null);
  const [qpDetailTab, setQpDetailTab] = useState<QpDetailTab>("schedule");
  const [qpStandings, setQpStandings] = useState<QpStanding[]>([]);
  const [qpForm, setQpForm] = useState({ name: "", format: "ROUND_ROBIN" as "SINGLES" | "ROUND_ROBIN", rrType: "SET" as "SET" | "SWITCH", courtCount: "2", courtLabels: "", guestNames: "", matchesPerPlayer: "", setsPerMatch: "1", includeSelf: true });
  const [qpPlayerQuery, setQpPlayerQuery] = useState("");
  const [qpPlayerResults, setQpPlayerResults] = useState<User[]>([]);
  const [qpPlayerSearching, setQpPlayerSearching] = useState(false);
  const [qpSelectedPlayers, setQpSelectedPlayers] = useState<User[]>([]);
  const [qpGuestInput, setQpGuestInput] = useState("");
  const [qpScoreInputs, setQpScoreInputs] = useState<Record<string, { sets: Array<{ s1: string; s2: string }> }>>({});
  const [qpReportingId, setQpReportingId] = useState<string | null>(null);
  const [qpEditGuestInput, setQpEditGuestInput] = useState("");
  const [qpEditSettings, setQpEditSettings] = useState<{ courtCount: string; courtLabels: string; matchesPerPlayer: string; setsPerMatch: string } | null>(null);
  const [qpLocalTeams, setQpLocalTeams] = useState<string[][]>([]);
  const [qpTeamFirstPick, setQpTeamFirstPick] = useState<string | null>(null);
  const [qpEditPlayerQuery, setQpEditPlayerQuery] = useState("");
  const [qpEditPlayerResults, setQpEditPlayerResults] = useState<User[]>([]);
  const [qpEditPlayerSearching, setQpEditPlayerSearching] = useState(false);
  const qpEditPlayerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qpPlayerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eventDivisions: Record<eventType, Record<skillLevel, ageBracket[]>>
  const [eventDivisions, setEventDivisions] = useState<Record<string, Record<string, string[]>>>({});
  const [tourneyInput, setTourneyInput] = useState({ name: "", format: "ROUND_ROBIN", roundRobinType: "FIXED", location: "", startDate: "", endDate: "", registrationStartDate: "", registrationEndDate: "", withdrawDeadline: "", maxTeams: "", description: "", clubId: "", isDuprReported: false });
  const [selectedTournament, setSelectedTournament] = useState<TournamentDetail | null>(null);
  const [tourneyDetailTab, setTourneyDetailTab] = useState<"overview" | "players" | "divisions" | "winners">("overview");
  const [showOrgRegPanel, setShowOrgRegPanel] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showCreateTourney, setShowCreateTourney] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showCreateLeague, setShowCreateLeague] = useState(false);
  const [divisionTab, setDivisionTab] = useState<"players" | "groups" | "schedule" | "standings" | "subdiv" | "brackets">("schedule");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [divPartners, setDivPartners] = useState<Record<string, User | null>>({});
  const [partnerAssignEventId, setPartnerAssignEventId] = useState<string | null>(null);
  // Per-event-type expanded age brackets for the structured registration UI
  const [regAgeExpanded, setRegAgeExpanded] = useState<Record<string, string[]>>({});
  const [orgRegAgeExpanded, setOrgRegAgeExpanded] = useState<Record<string, string[]>>({});
  const [partnerInvites, setPartnerInvites] = useState<TournamentPartnerInvite[]>([]);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [partnerResults, setPartnerResults] = useState<User[]>([]);
  const [partnerSearching, setPartnerSearching] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<User | null>(null);
  const [regDuprId, setRegDuprId] = useState("");
  const [regDuprRating, setRegDuprRating] = useState("");
  const [regPartnerDuprId, setRegPartnerDuprId] = useState("");
  const [regPartnerDuprRating, setRegPartnerDuprRating] = useState("");
  const [divDuprRatings, setDivDuprRatings] = useState<Record<string, string>>({});
  const [divPartnerDuprIds, setDivPartnerDuprIds] = useState<Record<string, string>>({});
  const [divPartnerDuprRatings, setDivPartnerDuprRatings] = useState<Record<string, string>>({});
  const [divTeamNames, setDivTeamNames] = useState<Record<string, string>>({});
  const [regTeamName, setRegTeamName] = useState("");
  const [editingTeamNameRegId, setEditingTeamNameRegId] = useState<string | null>(null);
  const [editTeamNameValue, setEditTeamNameValue] = useState("");
  const [pairReg1Id, setPairReg1Id] = useState("");
  const [pairReg2Id, setPairReg2Id] = useState("");
  const [pairTeamName, setPairTeamName] = useState("");
  const [editingMembersRegId, setEditingMembersRegId] = useState<string | null>(null);
  const [memberPlayerQuery, setMemberPlayerQuery] = useState("");
  const [memberPlayerResults, setMemberPlayerResults] = useState<User[]>([]);
  const [memberPlayerSearching, setMemberPlayerSearching] = useState(false);
  const [memberPlayerSelected, setMemberPlayerSelected] = useState<User | null>(null);
  const [memberPartnerQuery, setMemberPartnerQuery] = useState("");
  const [memberPartnerResults, setMemberPartnerResults] = useState<User[]>([]);
  const [memberPartnerSearching, setMemberPartnerSearching] = useState(false);
  const [memberPartnerSelected, setMemberPartnerSelected] = useState<User | null>(null);
  const [memberRemovePartner, setMemberRemovePartner] = useState(false);
  const memberPlayerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const memberPartnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reportingMatchId, setReportingMatchId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState({ s1: "", s2: "" });
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  // Division controls panel toggles
  const [showGroupsPanel, setShowGroupsPanel] = useState(false);
  const [showRrConfig, setShowRrConfig] = useState(false);
  const [rrCourtCount, setRrCourtCount] = useState("1");
  const [rrCourtLabels, setRrCourtLabels] = useState("");
  const [rrScheduleDate, setRrScheduleDate] = useState("");
  const [rrScheduleTime, setRrScheduleTime] = useState("");
  const [showEditTourney, setShowEditTourney] = useState(false);
  const [editTourneyInput, setEditTourneyInput] = useState({ name: "", location: "", startDate: "", endDate: "", registrationStartDate: "", registrationEndDate: "", withdrawDeadline: "", description: "", maxTeams: "", isDuprReported: false });
  // Organizer player registration
  const [orgRegQuery, setOrgRegQuery] = useState("");
  const [orgRegResults, setOrgRegResults] = useState<User[]>([]);
  const [orgRegSearching, setOrgRegSearching] = useState(false);
  const [orgRegEventIds, setOrgRegEventIds] = useState<string[]>([]);
  const [orgRegTarget, setOrgRegTarget] = useState<User | null>(null);
  const [orgDuprId, setOrgDuprId] = useState("");
  const [orgDuprRatings, setOrgDuprRatings] = useState<Record<string, string>>({});
  const [orgDivPartners, setOrgDivPartners] = useState<Record<string, User | null>>({});
  const [orgPartnerAssignEventId, setOrgPartnerAssignEventId] = useState<string | null>(null);
  const [orgPartnerQuery, setOrgPartnerQuery] = useState("");
  const [orgPartnerResults, setOrgPartnerResults] = useState<User[]>([]);
  const [orgPartnerSearching, setOrgPartnerSearching] = useState(false);
  const [orgDivTeamNames, setOrgDivTeamNames] = useState<Record<string, string>>({});
  const orgRegTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orgPartnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tournament groups
  const [groupCountInput, setGroupCountInput] = useState("2");
  const [groupEventId, setGroupEventId] = useState<string | null>(null);
  const [placementInputs, setPlacementInputs] = useState([
    { position: 1, label: "🥇 1st Place", teamRegId: "", note: "" },
    { position: 2, label: "🥈 2nd Place", teamRegId: "", note: "" },
    { position: 3, label: "🥉 3rd Place", teamRegId: "", note: "" },
  ]);

  const [buddies, setBuddies] = useState<User[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<LeagueDetail | null>(null);
  const [leagueDetailTab, setLeagueDetailTab] = useState<"overview" | "schedule" | "standings">("overview");
  const [leagueInput, setLeagueInput] = useState({ name: "", format: "ROTATIONAL" as "ROTATIONAL" | "FIXED_PARTNER", durationWeeks: "8", dropWeeks: "1", playersPerCourt: "4", skillLevel: "", location: "", description: "", startDate: "", clubId: "" });
  const [weekResults, setWeekResults] = useState<LeagueWeekResult[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [weekScheduleInput, setWeekScheduleInput] = useState("");
  const [editingResultId, setEditingResultId] = useState<string | null>(null);
  const [resultInput, setResultInput] = useState({ wins: "", pointsScored: "", pointsAgainst: "" });
  const [leagueStandings, setLeagueStandings] = useState<Array<{ playerId: string; playerName: string; totalWins: number; totalPoints: number; weeksPlayed: number; droppedWeeks: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = buddyQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setSearchResults(res.users);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [buddyQuery]);

  async function refreshAll(uid: string) {
    const [c, g, t, b, inv, pi, lg, qp] = await Promise.all([
      api.listClubs(), api.listGames(), api.listTournaments(), api.listBuddies(uid),
      api.listClubInvites(uid), api.listTournamentPartnerInvites(uid), api.listLeagues(),
      api.listQpSessions()
    ]);
    setClubs(c.clubs);
    setGames(g.games);
    setTournaments(t.tournaments);
    setBuddies(b.buddies);
    setClubInvites(inv.invites);
    setPartnerInvites(pi.invites);
    setLeagues(lg.leagues);
    setQpSessions(qp.sessions);
  }

  // Debounced search for club invite player picker
  useEffect(() => {
    if (clubInviteTimer.current) clearTimeout(clubInviteTimer.current);
    const q = clubInviteQuery.trim();
    if (q.length < 2) { setClubInviteResults([]); return; }
    clubInviteTimer.current = setTimeout(async () => {
      setClubInviteSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setClubInviteResults(res.users);
      } catch { setClubInviteResults([]); }
      finally { setClubInviteSearching(false); }
    }, 350);
    return () => { if (clubInviteTimer.current) clearTimeout(clubInviteTimer.current); };
  }, [clubInviteQuery]);

  // Reset invite search and sub-tab state when selected club changes
  useEffect(() => {
    setClubInviteQuery("");
    setClubInviteResults([]);
    setClubDetailTab("overview");
    setClubSessions([]);
    setClubJoinRequests([]);
    setClubAnalytics(null);
    if (selectedClub) {
      setPendingInviteIds(new Set(selectedClub.pendingInviteUserIds));
      setClubSettings({
        description: selectedClub.description ?? "",
        location: selectedClub.location ?? "",
        privacy: selectedClub.privacy,
        allowDirectJoin: selectedClub.allowDirectJoin
      });
    } else {
      setPendingInviteIds(new Set());
    }
  }, [selectedClub?.id]);

  // Organizer player registration search debounce
  useEffect(() => {
    if (orgRegTimer.current) clearTimeout(orgRegTimer.current);
    const q = orgRegQuery.trim();
    if (q.length < 2) { setOrgRegResults([]); return; }
    orgRegTimer.current = setTimeout(async () => {
      setOrgRegSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setOrgRegResults(res.users);
      } catch { setOrgRegResults([]); }
      finally { setOrgRegSearching(false); }
    }, 350);
    return () => { if (orgRegTimer.current) clearTimeout(orgRegTimer.current); };
  }, [orgRegQuery]);

  // Partner search debounce (for tournament registration)
  useEffect(() => {
    if (partnerSearchTimer.current) clearTimeout(partnerSearchTimer.current);
    const q = partnerQuery.trim();
    if (q.length < 2) { setPartnerResults([]); return; }
    partnerSearchTimer.current = setTimeout(async () => {
      setPartnerSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setPartnerResults(res.users);
      } catch { setPartnerResults([]); }
      finally { setPartnerSearching(false); }
    }, 350);
    return () => { if (partnerSearchTimer.current) clearTimeout(partnerSearchTimer.current); };
  }, [partnerQuery]);

  // Organizer partner search debounce
  useEffect(() => {
    if (orgPartnerTimer.current) clearTimeout(orgPartnerTimer.current);
    const q = orgPartnerQuery.trim();
    if (q.length < 2) { setOrgPartnerResults([]); return; }
    orgPartnerTimer.current = setTimeout(async () => {
      setOrgPartnerSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setOrgPartnerResults(res.users);
      } catch { setOrgPartnerResults([]); }
      finally { setOrgPartnerSearching(false); }
    }, 350);
    return () => { if (orgPartnerTimer.current) clearTimeout(orgPartnerTimer.current); };
  }, [orgPartnerQuery]);

  // Team member edit — player search debounce
  useEffect(() => {
    if (memberPlayerTimer.current) clearTimeout(memberPlayerTimer.current);
    const q = memberPlayerQuery.trim();
    if (q.length < 2) { setMemberPlayerResults([]); return; }
    memberPlayerTimer.current = setTimeout(async () => {
      setMemberPlayerSearching(true);
      try { const res = await api.searchUsers(q, user?.id ?? ""); setMemberPlayerResults(res.users); }
      catch { setMemberPlayerResults([]); }
      finally { setMemberPlayerSearching(false); }
    }, 350);
    return () => { if (memberPlayerTimer.current) clearTimeout(memberPlayerTimer.current); };
  }, [memberPlayerQuery]);

  // Team member edit — partner search debounce
  useEffect(() => {
    if (memberPartnerTimer.current) clearTimeout(memberPartnerTimer.current);
    const q = memberPartnerQuery.trim();
    if (q.length < 2) { setMemberPartnerResults([]); return; }
    memberPartnerTimer.current = setTimeout(async () => {
      setMemberPartnerSearching(true);
      try { const res = await api.searchUsers(q, user?.id ?? ""); setMemberPartnerResults(res.users); }
      catch { setMemberPartnerResults([]); }
      finally { setMemberPartnerSearching(false); }
    }, 350);
    return () => { if (memberPartnerTimer.current) clearTimeout(memberPartnerTimer.current); };
  }, [memberPartnerQuery]);

  // Quick Play player search debounce (create form)
  useEffect(() => {
    if (qpPlayerTimer.current) clearTimeout(qpPlayerTimer.current);
    const q = qpPlayerQuery.trim();
    if (q.length < 2) { setQpPlayerResults([]); return; }
    qpPlayerTimer.current = setTimeout(async () => {
      setQpPlayerSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setQpPlayerResults(res.users);
      } catch { setQpPlayerResults([]); }
      finally { setQpPlayerSearching(false); }
    }, 350);
    return () => { if (qpPlayerTimer.current) clearTimeout(qpPlayerTimer.current); };
  }, [qpPlayerQuery]);

  // Quick Play player search debounce (edit panel)
  useEffect(() => {
    if (qpEditPlayerTimer.current) clearTimeout(qpEditPlayerTimer.current);
    const q = qpEditPlayerQuery.trim();
    if (q.length < 2) { setQpEditPlayerResults([]); return; }
    qpEditPlayerTimer.current = setTimeout(async () => {
      setQpEditPlayerSearching(true);
      try {
        const res = await api.searchUsers(q, user?.id ?? "");
        setQpEditPlayerResults(res.users);
      } catch { setQpEditPlayerResults([]); }
      finally { setQpEditPlayerSearching(false); }
    }, 350);
    return () => { if (qpEditPlayerTimer.current) clearTimeout(qpEditPlayerTimer.current); };
  }, [qpEditPlayerQuery]);

  // Reset tournament detail state when selection changes
  useEffect(() => {
    setPartnerQuery(""); setPartnerResults([]); setSelectedPartner(null);
    setTourneyDetailTab("overview"); setReportingMatchId(null); setScoreInput({ s1: "", s2: "" });
    setSelectedEventId(null);
    setSelectedEventIds([]); setDivPartners({}); setDivTeamNames({}); setPartnerAssignEventId(null); setRegAgeExpanded({}); setOrgRegAgeExpanded({});
    setRegDuprId(user?.duprId ?? "");
    setRegDuprRating(""); setRegPartnerDuprId(""); setRegPartnerDuprRating("");
    // Pre-fill per-event ratings from discipline-specific profile fields
    const initRatings: Record<string, string> = {};
    for (const ev of selectedTournament?.events ?? []) {
      const evType = ev.eventType ?? "";
      const r = evType.includes("MIXED") ? user?.duprRatingMixed
        : evType.includes("DOUBLES") ? user?.duprRatingDoubles
        : user?.duprRatingSingles;
      if (r != null) initRatings[ev.id] = r.toString();
    }
    setDivDuprRatings(initRatings); setDivPartnerDuprIds({}); setDivPartnerDuprRatings({});
    setShowCancelForm(false); setCancelReason("");
    setShowCloseForm(false); setShowEditTourney(false);
    setOrgRegQuery(""); setOrgRegResults([]); setOrgRegTarget(null); setOrgRegEventIds([]);
    setShowOrgRegPanel(false);
    setGroupCountInput("1"); setGroupEventId(null);
    setDivisionTab("schedule");
    setRegTeamName(""); setEditingTeamNameRegId(null); setEditTeamNameValue("");
    setPairReg1Id(""); setPairReg2Id(""); setPairTeamName("");
    setEditingMembersRegId(null); setMemberPlayerQuery(""); setMemberPlayerResults([]); setMemberPlayerSelected(null);
    setMemberPartnerQuery(""); setMemberPartnerResults([]); setMemberPartnerSelected(null); setMemberRemovePartner(false);
    setPlacementInputs([
      { position: 1, label: "🥇 1st Place", teamRegId: "", note: "" },
      { position: 2, label: "🥈 2nd Place", teamRegId: "", note: "" },
      { position: 3, label: "🥉 3rd Place", teamRegId: "", note: "" },
    ]);
  }, [selectedTournament?.id]);

  // Auto-create 1 group for a division when Groups tab is opened and no groups exist yet
  useEffect(() => {
    if (!showProfileMenu) return;
    const close = () => setShowProfileMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [showProfileMenu]);

  useEffect(() => {
    if (!user || !selectedTournament || divisionTab !== "groups" || tourneyDetailTab !== "divisions") return;
    if (selectedTournament.createdBy !== user.id) return;
    const t = selectedTournament;
    const activeDivId = selectedEventId ?? groupEventId ?? t.events[0]?.id ?? null;
    if (!activeDivId) return;
    const existingGroups = t.groups.filter(g => g.eventId === activeDivId);
    const activeDiv = t.events.find(e => e.id === activeDivId);
    const isDivDoubles = activeDiv ? isDoublesEvent(activeDiv.eventType) : false;
    const confirmedRegs = t.registrations.filter(r =>
      r.tournamentEventId === activeDivId && r.status === "CONFIRMED" &&
      (!isDivDoubles || !!r.partnerId)
    );
    if (existingGroups.length === 0 && confirmedRegs.length >= 3) {
      api.createTournamentGroups(t.id, { organizerId: user.id, eventId: activeDivId, groupCount: 1 })
        .then(() => selectTournament(t.id))
        .catch(() => {});
    }
  }, [divisionTab, selectedEventId, groupEventId, selectedTournament?.id, tourneyDetailTab]);

  async function withError(fn: () => Promise<void>) {
    setError(null);
    setLoading(true);
    try { await fn(); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  function handleContactChange(val: string) {
    const isPhone = /^[+\d]/.test(val);
    setContact({ ...contact, email: isPhone ? "" : val, phone: isPhone ? val : "" });
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    await withError(async () => {
      const r = await api.login({
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        password: contact.password,
      });
      setUser(r.user);
      await refreshAll(r.user.id);
    });
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    if (!contact.name.trim()) { setError("Name is required."); return; }
    await withError(async () => {
      const r = await api.register({
        name: contact.name,
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        password: contact.password,
      });
      setUser(r.user);
      await refreshAll(r.user.id);
    });
  }

  async function onAddBuddyById(buddyId: string) {
    if (!user) return;
    setAddingId(buddyId);
    try {
      await api.addBuddy({ userId: user.id, buddyId });
      await refreshAll(user.id);
      // remove the added person from search results
      setSearchResults(prev => prev.filter(u => u.id !== buddyId));
    } catch (e) { setError((e as Error).message); }
    finally { setAddingId(null); }
  }

  async function onAddBuddy(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    await withError(async () => {
      const isPhone = /^[+\d]/.test(buddyInput.buddyEmail);
      await api.addBuddy({
        userId: user.id,
        buddyEmail: isPhone ? undefined : buddyInput.buddyEmail || undefined,
        buddyPhone: isPhone ? buddyInput.buddyEmail : buddyInput.buddyPhone || undefined,
      });
      setBuddyInput({ buddyEmail: "", buddyPhone: "" });
      await refreshAll(user.id);
    });
  }

  async function onCreateClub(e: FormEvent) {
    e.preventDefault();
    if (!user || !clubName) return;
    await withError(async () => {
      await api.createClub({ createdBy: user.id, name: clubName, privacy: clubCreatePrivacy, location: clubCreateLocation || undefined });
      setClubName(""); setClubCreateLocation("");
      await refreshAll(user.id);
    });
  }

  async function selectClub(clubId: string) {
    try {
      const res = await api.getClub(clubId);
      setSelectedClub(res.club as ClubDetail);
    } catch (e) { setError((e as Error).message); }
  }

  async function loadClubSessions(clubId: string) {
    try {
      const res = await api.getClubSessions(clubId);
      setClubSessions(res.sessions);
    } catch { /* ignore */ }
  }

  async function loadClubDirectorData(clubId: string) {
    try {
      const [jrRes, analyticsRes] = await Promise.all([
        api.getClubJoinRequests(clubId),
        api.getClubAnalytics(clubId)
      ]);
      setClubJoinRequests(jrRes.requests);
      setClubAnalytics(analyticsRes);
    } catch { /* ignore */ }
  }

  async function onJoinClub(clubId: string) {
    if (!user) return;
    await withError(async () => {
      const result = await api.joinClub(clubId, user.id);
      if (result.status === "requested") {
        setError(null);
        alert("Join request submitted — awaiting director approval.");
        return;
      }
      await Promise.all([refreshAll(user.id), selectClub(clubId)]);
    });
  }

  async function onJoinByCode(e: FormEvent) {
    e.preventDefault();
    if (!user || !clubJoinCode.trim()) return;
    await withError(async () => {
      const res = await api.joinClubByCode(clubJoinCode.trim().toUpperCase(), user.id);
      setClubJoinCode("");
      alert(res.message);
      await refreshAll(user.id);
    });
  }

  async function onCreateSession(e: FormEvent) {
    e.preventDefault();
    if (!user || !selectedClub || !newSession.name) return;
    await withError(async () => {
      await api.createClubSession(selectedClub.id, {
        createdBy: user.id,
        name: newSession.name,
        sessionType: newSession.sessionType,
        format: newSession.format,
        skillMin: newSession.skillMin || undefined,
        skillMax: newSession.skillMax || undefined,
        scheduledAt: newSession.scheduledAt || undefined
      });
      setNewSession({ name: "", sessionType: "COMPETITIVE", format: "DOUBLES", skillMin: "", skillMax: "", scheduledAt: "" });
      await loadClubSessions(selectedClub.id);
    });
  }

  async function onApproveSession(sessionId: string) {
    if (!user || !selectedClub) return;
    await withError(async () => {
      await api.approveClubSession(sessionId, user.id);
      await loadClubSessions(selectedClub.id);
    });
  }

  async function onApproveJoinRequest(requestId: string) {
    if (!user || !selectedClub) return;
    await withError(async () => {
      await api.approveJoinRequest(requestId, user.id);
      await Promise.all([selectClub(selectedClub.id), loadClubDirectorData(selectedClub.id)]);
    });
  }

  async function onDenyJoinRequest(requestId: string) {
    if (!user || !selectedClub) return;
    await withError(async () => {
      await api.denyJoinRequest(requestId, user.id);
      await loadClubDirectorData(selectedClub.id);
    });
  }

  async function onSaveClubSettings(e: FormEvent) {
    e.preventDefault();
    if (!user || !selectedClub) return;
    await withError(async () => {
      const res = await api.updateClub(selectedClub.id, {
        directorId: user.id,
        privacy: clubSettings.privacy,
        allowDirectJoin: clubSettings.allowDirectJoin,
        location: clubSettings.location || undefined,
        description: clubSettings.description || undefined
      });
      setSelectedClub(prev => prev ? { ...prev, ...res.club, members: prev.members, pendingInviteUserIds: prev.pendingInviteUserIds } : null);
    });
  }

  async function onRegenerateJoinCode() {
    if (!user || !selectedClub) return;
    await withError(async () => {
      const res = await api.updateClub(selectedClub.id, { directorId: user.id, regenerateCode: true });
      setSelectedClub(prev => prev ? { ...prev, joinCode: res.club.joinCode } : null);
    });
  }

  async function onSaveMemberRating(memberId: string) {
    if (!user || !selectedClub) return;
    const rating = parseFloat(ratingInput);
    if (isNaN(rating)) { setEditingRatingId(null); return; }
    await withError(async () => {
      await api.updateUserRating(memberId, rating);
      setEditingRatingId(null);
      await selectClub(selectedClub.id);
    });
  }

  // ── League handlers ─────────────────────────────────────────────────────

  async function onCreateLeague(e: FormEvent) {
    e.preventDefault();
    if (!user || !leagueInput.name) return;
    await withError(async () => {
      await api.createLeague({
        createdBy: user.id,
        name: leagueInput.name,
        format: leagueInput.format,
        durationWeeks: parseInt(leagueInput.durationWeeks) || 8,
        dropWeeks: parseInt(leagueInput.dropWeeks) || 1,
        playersPerCourt: parseInt(leagueInput.playersPerCourt) || 4,
        skillLevel: leagueInput.skillLevel || undefined,
        location: leagueInput.location || undefined,
        description: leagueInput.description || undefined,
        startDate: leagueInput.startDate || undefined,
        clubId: leagueInput.clubId || undefined
      });
      setLeagueInput({ name: "", format: "ROTATIONAL", durationWeeks: "8", dropWeeks: "1", playersPerCourt: "4", skillLevel: "", location: "", description: "", startDate: "", clubId: "" });
      await refreshAll(user.id);
    });
  }

  async function selectLeague(leagueId: string) {
    try {
      const res = await api.getLeague(leagueId);
      setSelectedLeague(res.league as LeagueDetail);
      setLeagueDetailTab("overview");
      setSelectedWeekId(null);
      setWeekResults([]);
      setLeagueStandings([]);
    } catch (e) { setError((e as Error).message); }
  }

  async function onRegisterForLeague(leagueId: string) {
    if (!user) return;
    await withError(async () => {
      await api.registerForLeague(leagueId, { userId: user.id });
      await selectLeague(leagueId);
    });
  }

  async function onGenerateLeagueWeek() {
    if (!user || !selectedLeague) return;
    await withError(async () => {
      await api.generateLeagueWeek(selectedLeague.id, {
        organizerId: user.id,
        scheduledAt: weekScheduleInput || undefined
      });
      setWeekScheduleInput("");
      await selectLeague(selectedLeague.id);
    });
  }

  async function loadWeekResults(weekId: string) {
    try {
      const res = await api.getWeekResults(weekId);
      setWeekResults(res.results);
      setSelectedWeekId(weekId);
    } catch (e) { setError((e as Error).message); }
  }

  async function onSaveWeekResult(resultId: string) {
    if (!user || !selectedLeague) return;
    await withError(async () => {
      await api.updateWeekResult(resultId, {
        organizerId: user.id,
        wins: resultInput.wins ? parseInt(resultInput.wins) : undefined,
        pointsScored: resultInput.pointsScored ? parseInt(resultInput.pointsScored) : undefined,
        pointsAgainst: resultInput.pointsAgainst ? parseInt(resultInput.pointsAgainst) : undefined
      });
      setEditingResultId(null);
      if (selectedWeekId) await loadWeekResults(selectedWeekId);
    });
  }

  async function loadLeagueStandings() {
    if (!selectedLeague) return;
    try {
      const res = await api.getLeagueStandings(selectedLeague.id);
      setLeagueStandings(res.standings);
    } catch (e) { setError((e as Error).message); }
  }

  async function onUpdateLeagueStatus(status: "REGISTRATION" | "ACTIVE" | "COMPLETED") {
    if (!user || !selectedLeague) return;
    await withError(async () => {
      await api.updateLeagueStatus(selectedLeague.id, { organizerId: user.id, status });
      await selectLeague(selectedLeague.id);
    });
  }

  // ── Club invite handler ─────────────────────────────────────────────────

  async function onInviteToClub(clubId: string, targetUserId: string) {
    if (!user) return;
    setInvitingId(targetUserId);
    try {
      await api.inviteToClub(clubId, { invitedBy: user.id, userId: targetUserId });
      setPendingInviteIds(prev => new Set([...prev, targetUserId]));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.includes("already")) {
        setPendingInviteIds(prev => new Set([...prev, targetUserId]));
      } else { setError(msg); }
    } finally { setInvitingId(null); }
  }

  async function onAcceptInvite(inviteId: string) {
    if (!user) return;
    await withError(async () => {
      await api.acceptClubInvite(inviteId);
      await refreshAll(user.id);
    });
  }

  async function onDeclineInvite(inviteId: string) {
    if (!user) return;
    await withError(async () => {
      await api.declineClubInvite(inviteId);
      await refreshAll(user.id);
    });
  }

  async function onCreateGame(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    const participantIds = gameInput.participants.split(",").map(x => x.trim()).filter(Boolean);
    await withError(async () => {
      await api.createGame({
        createdBy: user.id,
        type: gameInput.type as "REC" | "DUPR",
        format: gameInput.format as "SINGLES" | "DOUBLES" | "MIXED",
        score: gameInput.score,
        participantIds: [user.id, ...participantIds],
      });
      await refreshAll(user.id);
    });
  }

  // ── Quick Play handlers ─────────────────────────────────────────────────────

  async function onCreateQpSession(e: FormEvent) {
    e.preventDefault();
    if (!user || !qpForm.name.trim()) return;
    const courtCount = parseInt(qpForm.courtCount) || 1;
    const courtLabels = qpForm.courtLabels.trim()
      ? qpForm.courtLabels.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const guestNames = qpGuestInput.trim()
      ? qpGuestInput.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    await withError(async () => {
      await api.createQpSession({
        createdBy: user.id,
        name: qpForm.name,
        format: qpForm.format,
        rrType: qpForm.rrType,
        courtCount,
        courtLabels: courtLabels.length > 0 ? courtLabels : undefined,
        playerIds: [...(qpForm.includeSelf ? [user.id] : []), ...qpSelectedPlayers.map(p => p.id)],
        guestNames,
        matchesPerPlayer: qpForm.matchesPerPlayer ? parseInt(qpForm.matchesPerPlayer) || 0 : 0,
        setsPerMatch: parseInt(qpForm.setsPerMatch) || 1
      });
      setQpForm({ name: "", format: "ROUND_ROBIN", rrType: "SET", courtCount: "2", courtLabels: "", guestNames: "", matchesPerPlayer: "", setsPerMatch: "1", includeSelf: true });
      setQpSelectedPlayers([]);
      setQpGuestInput("");
      await refreshAll(user.id);
    });
  }

  async function selectQpSession(id: string) {
    try {
      const res = await api.getQpSession(id);
      setSelectedQp(res);
      setQpDetailTab("schedule");
      setQpStandings([]);
      setQpReportingId(null);
      setQpScoreInputs({});
      setQpEditGuestInput("");
      setQpEditPlayerQuery("");
      setQpEditPlayerResults([]);
      setQpEditSettings({
        courtCount: String(res.session.courtCount),
        courtLabels: res.session.courtLabels.join(", "),
        matchesPerPlayer: res.session.matchesPerPlayer > 0 ? String(res.session.matchesPerPlayer) : "",
        setsPerMatch: String(res.session.setsPerMatch)
      });
      setQpLocalTeams(res.session.teams ?? []);
      setQpTeamFirstPick(null);
    } catch (e) { setError((e as Error).message); }
  }

  async function onQpAddPlayer(u: User) {
    if (!selectedQp) return;
    await withError(async () => {
      await api.updateQpPlayers(selectedQp.session.id, { addPlayerId: u.id });
      await selectQpSession(selectedQp.session.id);
      setQpEditPlayerQuery(""); setQpEditPlayerResults([]);
    });
  }

  async function onQpRemovePlayer(playerId: string) {
    if (!selectedQp) return;
    await withError(async () => {
      await api.updateQpPlayers(selectedQp.session.id, { removePlayerId: playerId });
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onQpAddGuest() {
    if (!selectedQp || !qpEditGuestInput.trim()) return;
    const names = qpEditGuestInput.split(",").map(s => s.trim()).filter(Boolean);
    await withError(async () => {
      for (const name of names) {
        await api.updateQpPlayers(selectedQp.session.id, { addGuestName: name });
      }
      await selectQpSession(selectedQp.session.id);
      setQpEditGuestInput("");
    });
  }

  async function onQpRemoveGuest(guestId: string) {
    if (!selectedQp) return;
    await withError(async () => {
      await api.updateQpPlayers(selectedQp.session.id, { removeGuestId: guestId });
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onSaveQpSettings() {
    if (!selectedQp || !qpEditSettings) return;
    const courtCount = parseInt(qpEditSettings.courtCount) || 1;
    const courtLabels = qpEditSettings.courtLabels.trim()
      ? qpEditSettings.courtLabels.split(",").map(s => s.trim()).filter(Boolean)
      : Array.from({ length: courtCount }, (_, i) => `Court ${i + 1}`);
    await withError(async () => {
      await api.updateQpSettings(selectedQp.session.id, {
        courtCount,
        courtLabels,
        matchesPerPlayer: qpEditSettings.matchesPerPlayer ? parseInt(qpEditSettings.matchesPerPlayer) || 0 : 0,
        setsPerMatch: parseInt(qpEditSettings.setsPerMatch) || 1
      });
      await selectQpSession(selectedQp.session.id);
    });
  }

  function onPickTeamPlayer(id: string) {
    if (qpTeamFirstPick === null) {
      setQpTeamFirstPick(id);
    } else if (qpTeamFirstPick === id) {
      setQpTeamFirstPick(null);
    } else {
      setQpLocalTeams(t => [...t, [qpTeamFirstPick, id]]);
      setQpTeamFirstPick(null);
    }
  }

  function onRemoveLocalTeam(idx: number) {
    setQpLocalTeams(t => t.filter((_, i) => i !== idx));
    setQpTeamFirstPick(null);
  }

  async function onSaveQpTeams() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.saveQpTeams(selectedQp.session.id, qpLocalTeams);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onGenerateQpSchedule() {
    if (!user || !selectedQp) return;
    await withError(async () => {
      await api.generateQpSchedule(selectedQp.session.id, user.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onFinalizeQpSession() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.finalizeQpSession(selectedQp.session.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onDeleteQpMatch(matchId: string) {
    if (!selectedQp) return;
    await withError(async () => {
      await api.deleteQpMatch(matchId);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onSubmitQpScore(matchId: string) {
    const inp = qpScoreInputs[matchId];
    if (!inp) return;
    const setsPerMatch = selectedQp?.session.setsPerMatch ?? 1;
    if (setsPerMatch > 1) {
      // Only submit sets that have both scores entered; allow early finish (e.g. 2-0 in Bo3)
      const played = inp.sets
        .map(s => [parseInt(s.s1), parseInt(s.s2)] as [number, number])
        .filter(([a, b]) => !isNaN(a) && !isNaN(b));
      if (played.length === 0) { setError("Enter at least one set score."); return; }
      await withError(async () => {
        await api.submitQpScore(matchId, { sets: played });
        setQpReportingId(null);
        setQpScoreInputs(prev => { const n = { ...prev }; delete n[matchId]; return n; });
        if (selectedQp) await selectQpSession(selectedQp.session.id);
      });
    } else {
      const s = inp.sets[0] ?? { s1: "", s2: "" };
      const s1 = parseInt(s.s1), s2 = parseInt(s.s2);
      if (isNaN(s1) || isNaN(s2)) { setError("Enter valid scores."); return; }
      await withError(async () => {
        await api.submitQpScore(matchId, { scoreTeam1: s1, scoreTeam2: s2 });
        setQpReportingId(null);
        setQpScoreInputs(prev => { const n = { ...prev }; delete n[matchId]; return n; });
        if (selectedQp) await selectQpSession(selectedQp.session.id);
      });
    }
  }

  async function loadQpStandings() {
    if (!selectedQp) return;
    try {
      const res = await api.getQpStandings(selectedQp.session.id);
      setQpStandings(res.standings);
    } catch (e) { setError((e as Error).message); }
  }

  async function onCreateQpPlayoffs() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.createQpPlayoffs(selectedQp.session.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onCloseQpSession() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.closeQpSession(selectedQp.session.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onCreateQpThirdPlace() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.createQpThirdPlace(selectedQp.session.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onDeclareQpWinner() {
    if (!selectedQp) return;
    await withError(async () => {
      await api.declareQpWinner(selectedQp.session.id);
      await selectQpSession(selectedQp.session.id);
    });
  }

  async function onDeleteQpSession() {
    if (!selectedQp || !user) return;
    if (!confirm(`Delete "${selectedQp.session.name}" and all its games? This cannot be undone.`)) return;
    await withError(async () => {
      await api.deleteQpSession(selectedQp.session.id, user.id);
      setSelectedQp(null);
      await refreshAll(user.id);
    });
  }

  // ── Event division helpers ─────────────────────────────────────────────────

  function toggleEventType(et: string) {
    setEventDivisions(prev => {
      const next = { ...prev };
      if (et in next) delete next[et]; else next[et] = {};
      return next;
    });
  }

  function toggleSkillLevel(et: string, sl: string) {
    setEventDivisions(prev => {
      const skills = { ...(prev[et] ?? {}) };
      if (sl in skills) delete skills[sl]; else skills[sl] = ["OPEN"];
      return { ...prev, [et]: skills };
    });
  }

  function toggleAgeBracket(et: string, sl: string, ab: string) {
    setEventDivisions(prev => {
      const current = prev[et]?.[sl] ?? [];
      const next = current.includes(ab) ? current.filter(x => x !== ab) : [...current, ab];
      return { ...prev, [et]: { ...prev[et], [sl]: next } };
    });
  }

  function flattenEvents() {
    return Object.entries(eventDivisions).flatMap(([et, skills]) =>
      Object.entries(skills).flatMap(([sl, abs]) =>
        abs.map(ab => ({ eventType: et, skillLevel: sl, ageBracket: ab as "OPEN" | "YOUNG" | "SENIOR" }))
      )
    );
  }

  async function onCreateTournament(e: FormEvent) {
    e.preventDefault();
    if (!user || !tourneyInput.name) return;
    const events = flattenEvents();
    if (events.length === 0) { setError("Add at least one event division."); return; }
    await withError(async () => {
      await api.createTournament({
        endDate: tourneyInput.endDate || undefined,
        registrationStartDate: tourneyInput.registrationStartDate || undefined,
        registrationEndDate: tourneyInput.registrationEndDate || undefined,
        withdrawDeadline: tourneyInput.withdrawDeadline || undefined,
        createdBy: user.id,
        name: tourneyInput.name,
        events,
        format: tourneyInput.format,
        maxTeams: tourneyInput.maxTeams ? parseInt(tourneyInput.maxTeams) : undefined,
        location: tourneyInput.location || undefined,
        startDate: tourneyInput.startDate || undefined,
        description: tourneyInput.description || undefined,
        clubId: tourneyInput.clubId || undefined,
        roundRobinType: tourneyInput.roundRobinType,
        isDuprReported: tourneyInput.isDuprReported,
      });
      setTourneyInput(p => ({ ...p, name: "", location: "", startDate: "", endDate: "", registrationStartDate: "", registrationEndDate: "", withdrawDeadline: "", maxTeams: "", description: "", clubId: "", isDuprReported: false }));
      setEventDivisions({});
      await refreshAll(user.id);
    });
  }

  async function selectTournament(id: string) {
    try { setSelectedTournament((await api.getTournament(id)).tournament); }
    catch (e) { setError((e as Error).message); }
  }

  async function onRegisterForTournament(tournamentId: string) {
    if (!user) return;
    const duprId = regDuprId.trim() || undefined;
    await withError(async () => {
      if (selectedEventIds.length > 0) {
        // Multi-division registration
        for (const evId of selectedEventIds) {
          const ratingStr = divDuprRatings[evId]?.trim();
          const partnerRatingStr = divPartnerDuprRatings[evId]?.trim();
          await api.registerForTournament(tournamentId, {
            userId: user.id,
            tournamentEventId: evId,
            partnerId: divPartners[evId]?.id,
            duprId,
            duprRating: ratingStr ? parseFloat(ratingStr) : undefined,
            partnerDuprId: divPartnerDuprIds[evId]?.trim() || undefined,
            partnerDuprRating: partnerRatingStr ? parseFloat(partnerRatingStr) : undefined,
            teamName: divTeamNames[evId]?.trim() || undefined
          });
        }
        setSelectedEventIds([]); setDivPartners({}); setDivTeamNames({}); setPartnerAssignEventId(null); setPartnerQuery(""); setPartnerResults([]);
        setDivDuprRatings({}); setDivPartnerDuprIds({}); setDivPartnerDuprRatings({});
      } else {
        // Legacy single-event
        const ratingStr = regDuprRating.trim();
        const partnerRatingStr = regPartnerDuprRating.trim();
        await api.registerForTournament(tournamentId, {
          userId: user.id,
          tournamentEventId: selectedEventId ?? undefined,
          partnerId: selectedPartner?.id,
          duprId,
          duprRating: ratingStr ? parseFloat(ratingStr) : undefined,
          partnerDuprId: regPartnerDuprId.trim() || undefined,
          partnerDuprRating: partnerRatingStr ? parseFloat(partnerRatingStr) : undefined,
          teamName: regTeamName.trim() || undefined
        });
        setSelectedPartner(null); setPartnerQuery(""); setPartnerResults([]);
        setRegDuprRating(""); setRegPartnerDuprId(""); setRegPartnerDuprRating("");
      }
      // Persist DUPR info to user profile and update local state
      const savedDuprId = regDuprId.trim() || undefined;
      const profileUpdate: { duprId?: string; duprRatingSingles?: number | null; duprRatingDoubles?: number | null; duprRatingMixed?: number | null } = {};
      if (savedDuprId) profileUpdate.duprId = savedDuprId;
      const eventsForProfile = selectedTournament?.events ?? [];
      for (const evId of selectedEventIds) {
        const ev = eventsForProfile.find(e => e.id === evId);
        if (!ev) continue;
        const rStr = divDuprRatings[evId]?.trim();
        if (!rStr) continue;
        const evType = ev.eventType ?? "";
        if (evType.includes("MIXED")) profileUpdate.duprRatingMixed = parseFloat(rStr);
        else if (evType.includes("DOUBLES")) profileUpdate.duprRatingDoubles = parseFloat(rStr);
        else profileUpdate.duprRatingSingles = parseFloat(rStr);
      }
      if (Object.keys(profileUpdate).length > 0) {
        try {
          const res = await api.updateUserProfile(user.id, profileUpdate);
          setUser(u => u ? {
            ...u,
            duprId: res.user.duprId ?? u.duprId,
            duprRatingSingles: res.user.duprRatingSingles ?? u.duprRatingSingles,
            duprRatingDoubles: res.user.duprRatingDoubles ?? u.duprRatingDoubles,
            duprRatingMixed: res.user.duprRatingMixed ?? u.duprRatingMixed,
          } : u);
        } catch { /* non-critical */ }
      }
      setRegDuprId("");
      await Promise.all([selectTournament(tournamentId), refreshAll(user.id)]);
    });
  }

  async function onUpdateTeamName(tournamentId: string, regId: string) {
    if (!user) return;
    await withError(async () => {
      await api.updateTeamName(tournamentId, regId, { userId: user.id, teamName: editTeamNameValue.trim() });
      setEditingTeamNameRegId(null); setEditTeamNameValue("");
      await selectTournament(tournamentId);
    });
  }

  async function onPairSoloPlayers(tournamentId: string) {
    if (!user) return;
    await withError(async () => {
      await api.pairSoloPlayers(tournamentId, {
        organizerId: user.id,
        reg1Id: pairReg1Id,
        reg2Id: pairReg2Id,
        teamName: pairTeamName.trim() || undefined
      });
      setPairReg1Id(""); setPairReg2Id(""); setPairTeamName("");
      await selectTournament(tournamentId);
    });
  }

  async function onUpdateTeamMembers(tournamentId: string, regId: string) {
    if (!user) return;
    await withError(async () => {
      const payload: { organizerId: string; playerId?: string; partnerId?: string | null } = { organizerId: user.id };
      if (memberPlayerSelected) payload.playerId = memberPlayerSelected.id;
      if (memberRemovePartner) payload.partnerId = null;
      else if (memberPartnerSelected) payload.partnerId = memberPartnerSelected.id;
      await api.updateTeamMembers(tournamentId, regId, payload);
      setEditingMembersRegId(null);
      setMemberPlayerQuery(""); setMemberPlayerResults([]); setMemberPlayerSelected(null);
      setMemberPartnerQuery(""); setMemberPartnerResults([]); setMemberPartnerSelected(null);
      setMemberRemovePartner(false);
      await selectTournament(tournamentId);
    });
  }

  async function onAcceptPartnerInvite(inviteId: string) {
    if (!user) return;
    await withError(async () => {
      await api.acceptTournamentPartnerInvite(inviteId, user.id);
      await Promise.all([refreshAll(user.id), selectedTournament ? selectTournament(selectedTournament.id) : Promise.resolve()]);
    });
  }

  async function onDeclinePartnerInvite(inviteId: string) {
    if (!user) return;
    await withError(async () => {
      await api.declineTournamentPartnerInvite(inviteId);
      await refreshAll(user.id);
    });
  }

  function buildRrOpts() {
    const count = parseInt(rrCourtCount) || 1;
    const labels = rrCourtLabels.trim() ? rrCourtLabels.split(",").map(s => s.trim()).filter(Boolean) : undefined;
    return {
      courtCount: count,
      courtLabels: labels,
      scheduleDate: rrScheduleDate || undefined,
      scheduleTime: rrScheduleTime || undefined,
    };
  }

  async function onGenerateSchedule(tournamentId: string, tournamentEventId?: string) {
    if (!user) return;
    await withError(async () => {
      await api.generateSchedule(tournamentId, user.id, tournamentEventId, buildRrOpts());
      await selectTournament(tournamentId);
    });
  }

  async function onOrgRegisterPlayer(tournamentId: string, tournament: TournamentDetail) {
    if (!user || !orgRegTarget) return;
    await withError(async () => {
      function evCat(evId: string) {
        const ev = tournament.events.find(e => e.id === evId);
        if (!ev) return "General";
        if (ev.eventType === "MIXED_DOUBLES") return "Mixed Doubles";
        if (ev.eventType.includes("DOUBLES")) return "Doubles";
        return "Singles";
      }
      if (orgRegEventIds.length > 0) {
        for (const evId of orgRegEventIds) {
          const cat = evCat(evId);
          const ratingStr = orgDuprRatings[cat]?.trim();
          const partner = orgDivPartners[evId] ?? null;
          await api.orgRegisterPlayer(tournamentId, {
            organizerId: user.id,
            targetUserId: orgRegTarget.id,
            tournamentEventId: evId,
            partnerId: partner?.id,
            duprId: orgDuprId.trim() || undefined,
            duprRating: ratingStr ? parseFloat(ratingStr) : undefined,
          });
        }
      } else {
        await api.orgRegisterPlayer(tournamentId, {
          organizerId: user.id,
          targetUserId: orgRegTarget.id,
          duprId: orgDuprId.trim() || undefined,
        });
      }
      setOrgRegTarget(null); setOrgRegQuery(""); setOrgRegResults([]); setOrgRegEventIds([]); setOrgRegAgeExpanded({});
      setOrgDuprId(""); setOrgDuprRatings({});
      setOrgDivPartners({}); setOrgPartnerAssignEventId(null); setOrgPartnerQuery(""); setOrgPartnerResults([]); setOrgDivTeamNames({});
      await selectTournament(tournamentId);
    });
  }

  async function onUnregister(tournamentId: string, registrationId: string) {
    if (!user) return;
    await withError(async () => {
      await api.unregisterFromTournament(tournamentId, registrationId, user.id);
      setSelectedEventIds(prev => prev); // no-op; just refresh
      await Promise.all([selectTournament(tournamentId), refreshAll(user.id)]);
    });
  }

  async function onOrgWithdrawRegistration(tournamentId: string, registrationId: string) {
    if (!user) return;
    await withError(async () => {
      await api.unregisterFromTournament(tournamentId, registrationId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onUpdateTourneyDetails(tournamentId: string) {
    if (!user) return;
    await withError(async () => {
      await api.updateTournamentDetails(tournamentId, {
        organizerId: user.id,
        name: editTourneyInput.name || undefined,
        location: editTourneyInput.location || null,
        startDate: editTourneyInput.startDate || null,
        endDate: editTourneyInput.endDate || null,
        registrationStartDate: editTourneyInput.registrationStartDate || null,
        registrationEndDate: editTourneyInput.registrationEndDate || null,
        withdrawDeadline: editTourneyInput.withdrawDeadline || null,
        description: editTourneyInput.description || null,
        maxTeams: editTourneyInput.maxTeams ? parseInt(editTourneyInput.maxTeams) : null,
        isDuprReported: editTourneyInput.isDuprReported
      });
      setShowEditTourney(false);
      await selectTournament(tournamentId);
    });
  }

  async function onCreateGroups(tournamentId: string, eventId: string) {
    if (!user) return;
    const count = parseInt(groupCountInput) || 1;
    await withError(async () => {
      await api.createTournamentGroups(tournamentId, { organizerId: user.id, eventId, groupCount: count });
      await selectTournament(tournamentId);
      setDivisionTab("groups");
    });
  }

  async function onAssignGroup(tournamentId: string, groupId: string, registrationId: string, action: "add" | "remove") {
    if (!user) return;
    await withError(async () => {
      await api.assignGroupMember(tournamentId, groupId, { organizerId: user.id, registrationId, action });
      await selectTournament(tournamentId);
    });
  }

  async function onGenerateGroupSchedule(tournamentId: string, groupId: string) {
    if (!user) return;
    await withError(async () => {
      await api.generateGroupSchedule(tournamentId, groupId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onCreateSubDivisions(tournamentId: string, eventId: string) {
    if (!user) return;
    await withError(async () => {
      await api.createSubDivisions(tournamentId, { organizerId: user.id, eventId });
      await selectTournament(tournamentId);
    });
  }

  async function onCreatePlayoffs(tournamentId: string, eventId: string) {
    if (!user) return;
    await withError(async () => {
      await api.createPlayoffs(tournamentId, eventId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onCreateThirdPlaceMatch(tournamentId: string, eventId: string) {
    if (!user) return;
    await withError(async () => {
      await api.createThirdPlaceMatch(tournamentId, eventId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onDeclareWinners(tournamentId: string, eventId: string) {
    if (!user) return;
    await withError(async () => {
      await api.declareWinners(tournamentId, eventId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onGenerateSubDivBracket(tournamentId: string, subDivId: string) {
    if (!user) return;
    await withError(async () => {
      await api.generateSubDivBracket(tournamentId, subDivId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onCreateSubDivThirdPlaceMatch(tournamentId: string, subDivId: string) {
    if (!user) return;
    await withError(async () => {
      await api.createSubDivThirdPlaceMatch(tournamentId, subDivId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onDeclareSubDivWinners(tournamentId: string, subDivId: string) {
    if (!user) return;
    await withError(async () => {
      await api.declareSubDivWinners(tournamentId, subDivId, user.id);
      await selectTournament(tournamentId);
    });
  }

  async function onReportScore(matchId: string) {
    if (!user) return;
    const s1 = parseInt(scoreInput.s1); const s2 = parseInt(scoreInput.s2);
    if (isNaN(s1) || isNaN(s2)) { setError("Enter valid scores."); return; }
    await withError(async () => {
      await api.reportMatchScore(matchId, { reportedBy: user.id, scoreTeam1: s1, scoreTeam2: s2, scoreRaw: `${s1}-${s2}` });
      setReportingMatchId(null); setScoreInput({ s1: "", s2: "" });
      if (selectedTournament) await selectTournament(selectedTournament.id);
    });
  }

  async function onConfirmScore(matchId: string) {
    if (!user) return;
    await withError(async () => {
      await api.confirmMatchScore(matchId, user.id);
      if (selectedTournament) await selectTournament(selectedTournament.id);
    });
  }

  async function onEditScore(matchId: string) {
    if (!user) return;
    const s1 = parseInt(scoreInput.s1); const s2 = parseInt(scoreInput.s2);
    if (isNaN(s1) || isNaN(s2)) { setError("Enter valid scores."); return; }
    await withError(async () => {
      await api.editMatchScore(matchId, { editedBy: user.id, scoreTeam1: s1, scoreTeam2: s2 });
      setReportingMatchId(null); setScoreInput({ s1: "", s2: "" });
      if (selectedTournament) await selectTournament(selectedTournament.id);
    });
  }

  async function onUpdateTournamentStatus(status: "PLANNED" | "ACTIVE" | "COMPLETED") {
    if (!user || !selectedTournament) return;
    await withError(async () => {
      await api.updateTournamentStatus(selectedTournament.id, { organizerId: user.id, status });
      await Promise.all([selectTournament(selectedTournament.id), refreshAll(user.id)]);
    });
  }

  async function onCancelTournament(e: FormEvent) {
    e.preventDefault();
    if (!user || !selectedTournament || !cancelReason.trim()) return;
    await withError(async () => {
      await api.cancelTournament(selectedTournament.id, { organizerId: user.id, reason: cancelReason.trim() });
      setShowCancelForm(false); setCancelReason("");
      await Promise.all([selectTournament(selectedTournament.id), refreshAll(user.id)]);
    });
  }

  async function onCloseTournament(e: FormEvent) {
    e.preventDefault();
    if (!user || !selectedTournament) return;
    const validPlacements = placementInputs
      .filter(p => p.teamRegId)
      .map(p => {
        const reg = selectedTournament.registrations.find(r => r.id === p.teamRegId);
        const playerIds = reg ? [reg.playerId, ...(reg.partnerId ? [reg.partnerId] : [])] : [];
        return { position: p.position, playerIds, label: p.label || undefined, note: p.note || undefined };
      })
      .filter(p => p.playerIds.length > 0);
    if (validPlacements.length === 0) { setError("Select at least one placement winner."); return; }
    await withError(async () => {
      await api.closeTournament(selectedTournament.id, { organizerId: user.id, placements: validPlacements });
      setShowCloseForm(false);
      await Promise.all([selectTournament(selectedTournament.id), refreshAll(user.id)]);
    });
  }

  // ── AUTH SCREEN ──────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="auth-root">
        <div className="auth-brand">
          <div className="auth-brand-inner">
            <img src={logo} alt="GoPickle" className="auth-brand-logo" />
            <h1 className="auth-brand-name">GoPickle</h1>
            <p className="auth-brand-tagline">
              The modern social platform for pickleball — track clubs, buddies, matches, and tournaments.
            </p>
            <ul className="auth-features">
              <li>🏓 Log REC &amp; DUPR games</li>
              <li>👥 Connect with buddies</li>
              <li>🏢 Join &amp; create clubs</li>
              <li>🏆 Run tournaments</li>
            </ul>
          </div>
        </div>

        <div className="auth-panel">
          <div className="auth-card">
            <div className="auth-card-logo-mobile">
              <img src={logo} alt="" />
              <span>GoPickle</span>
            </div>

            <h2 className="auth-title">
              {authMode === "login" ? "Welcome back" : "Join GoPickle"}
            </h2>
            <p className="auth-subtitle">
              {authMode === "login" ? "Sign in to your account" : "Create your free account"}
            </p>

            <form onSubmit={authMode === "login" ? onLogin : onRegister} className="auth-form">
              {authMode === "register" && (
                <div className="field">
                  <label>Full Name</label>
                  <input
                    placeholder="e.g. Alex Rivera"
                    value={contact.name}
                    onChange={e => setContact({ ...contact, name: e.target.value })}
                  />
                </div>
              )}
              <div className="field">
                <label>Email or Phone</label>
                <input
                  placeholder="you@example.com or +1 555…"
                  value={contact.email || contact.phone}
                  autoComplete="username"
                  onChange={e => handleContactChange(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={contact.password}
                  autoComplete={authMode === "login" ? "current-password" : "new-password"}
                  onChange={e => setContact({ ...contact, password: e.target.value })}
                />
              </div>
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Please wait…" : authMode === "login" ? "Sign In" : "Create Account"}
              </button>
            </form>

            <p className="auth-switch">
              {authMode === "login" ? "New to GoPickle?" : "Already have an account?"}{" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setError(null); }}
              >
                {authMode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── DASHBOARD ────────────────────────────────────────────────────────────────
  return (
    <div className="dash-root">
      <nav className="topbar">
        <div className="topbar-brand">
          <img src={logo} alt="GoPickle" className="topbar-logo" />
          <span className="topbar-name">GoPickle</span>
        </div>

        <div className="tab-bar" role="tablist">
          {TABS.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.emoji}</span>
              <span className="tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="topbar-user">
          <button className="avatar-btn" onClick={() => setShowProfileMenu(v => !v)} aria-label="Profile menu">
            <Avatar name={user.name} />
          </button>
          <span className="topbar-username">{user.name.split(" ")[0]}</span>
          <button className="btn-ghost" onClick={() => setUser(null)}>Sign out</button>
          {showProfileMenu && (
            <div className="profile-dropdown" onClick={e => e.stopPropagation()}>
              <div>
                <div className="profile-dropdown-name">{user.name}</div>
                {user.email && <div className="profile-dropdown-email">{user.email}</div>}
              </div>
              {user.duprRating && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  DUPR Rating: <span style={{ color: "var(--text)", fontWeight: 700 }}>{user.duprRating}</span>
                </div>
              )}
              <hr className="profile-dropdown-divider" />
              <button className="btn-ghost" style={{ width: "100%", textAlign: "left" }}
                onClick={() => { setUser(null); setShowProfileMenu(false); }}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="page">
        {error && (
          <div className="toast-error" role="alert" onClick={() => setError(null)}>
            {error} <span aria-hidden>×</span>
          </div>
        )}

        {/* ── HOME ── */}
        {activeTab === "home" && (
          <div className="tab-panel fade-in">
            <div className="page-header">
              <h2>Good to see you, <span className="grad-text">{user.name.split(" ")[0]}</span> 👋</h2>
              <p className="muted">Here's your pickleball snapshot.</p>
            </div>
            <div className="stats-grid">
              {[
                { label: "Buddies",     value: buddies.length,     icon: buddyIcon,  cls: "buddies-icon" },
                { label: "Clubs",       value: clubs.length,       icon: clubIcon,   cls: "clubs-icon"   },
                { label: "Games",       value: games.filter(g => g.participantIds.includes(user.id)).length, icon: gameIcon,      cls: "games-icon"      },
                { label: "Quick Play",  value: qpSessions.filter(s => s.createdBy === user.id || s.playerIds.includes(user.id)).length, icon: quickplayIcon, cls: "quickplay-icon"  },
                { label: "Tournaments", value: tournaments.length, icon: trophyIcon,    cls: "trophy-icon"     },
                { label: "Leagues",     value: leagues.length,     icon: leagueIcon,    cls: "league-icon"     },
              ].map(s => (
                <div key={s.label} className="stat-card">
                  <div className={`stat-icon ${s.cls}`}>
                    <img src={s.icon} alt="" />
                  </div>
                  <div className="stat-val">{s.value}</div>
                  <div className="stat-lbl">{s.label}</div>
                </div>
              ))}
            </div>

            {/* My Profile card */}
            <div className="glass-card" style={{ marginTop: 24, maxWidth: 480 }}>
              <h3 className="card-title">My Profile</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <Avatar name={user.name} size={48} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1rem" }}>{user.name}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{user.email || user.phone}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>DUPR ID</label>
                  <input
                    value={profileDuprId || user.duprId || ""}
                    onChange={e => setProfileDuprId(e.target.value)}
                    placeholder="e.g. 12345678"
                    style={{ fontSize: "0.88rem" }}
                    onFocus={() => { if (!profileDuprId) setProfileDuprId(user.duprId ?? ""); }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Singles Rating", key: "singles" as const, val: profileDuprRatingSingles, set: setProfileDuprRatingSingles, cur: user.duprRatingSingles },
                    { label: "Doubles Rating", key: "doubles" as const, val: profileDuprRatingDoubles, set: setProfileDuprRatingDoubles, cur: user.duprRatingDoubles },
                    { label: "Mixed Rating",   key: "mixed"   as const, val: profileDuprRatingMixed,   set: setProfileDuprRatingMixed,   cur: user.duprRatingMixed },
                  ].map(({ label, val, set, cur }) => (
                    <div key={label} className="field" style={{ margin: 0 }}>
                      <label style={{ fontSize: "0.72rem" }}>{label}</label>
                      <input
                        type="number" min="0" max="8" step="0.01"
                        value={val || (cur != null ? cur.toString() : "")}
                        onChange={e => set(e.target.value)}
                        placeholder="e.g. 3.50"
                        style={{ fontSize: "0.88rem" }}
                        onFocus={() => { if (!val && cur != null) set(cur.toString()); }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  className="btn-primary"
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                  disabled={profileSaving}
                  onClick={async () => {
                    const duprId = profileDuprId.trim() || undefined;
                    const s = profileDuprRatingSingles.trim() ? parseFloat(profileDuprRatingSingles.trim()) : undefined;
                    const d = profileDuprRatingDoubles.trim() ? parseFloat(profileDuprRatingDoubles.trim()) : undefined;
                    const m = profileDuprRatingMixed.trim() ? parseFloat(profileDuprRatingMixed.trim()) : undefined;
                    if (duprId === undefined && s === undefined && d === undefined && m === undefined) return;
                    setProfileSaving(true);
                    try {
                      const res = await api.updateUserProfile(user.id, {
                        duprId,
                        duprRatingSingles: s ?? null,
                        duprRatingDoubles: d ?? null,
                        duprRatingMixed: m ?? null,
                      });
                      setUser(u => u ? {
                        ...u,
                        duprId: res.user.duprId ?? u.duprId,
                        duprRatingSingles: res.user.duprRatingSingles ?? u.duprRatingSingles,
                        duprRatingDoubles: res.user.duprRatingDoubles ?? u.duprRatingDoubles,
                        duprRatingMixed: res.user.duprRatingMixed ?? u.duprRatingMixed,
                      } : u);
                      setProfileDuprId(""); setProfileDuprRatingSingles(""); setProfileDuprRatingDoubles(""); setProfileDuprRatingMixed("");
                    } catch (e) { setError((e as Error).message); }
                    finally { setProfileSaving(false); }
                  }}>
                  {profileSaving ? "Saving…" : "Save Profile"}
                </button>
                {(user.duprId || user.duprRatingSingles != null || user.duprRatingDoubles != null || user.duprRatingMixed != null) && (
                  <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {user.duprId && <span style={{ color: "var(--text)" }}>ID: {user.duprId}</span>}
                    {user.duprRatingSingles != null && <span style={{ color: "#f472b6", fontWeight: 600 }}>Singles ★ {user.duprRatingSingles}</span>}
                    {user.duprRatingDoubles != null && <span style={{ color: "#f472b6", fontWeight: 600 }}>Doubles ★ {user.duprRatingDoubles}</span>}
                    {user.duprRatingMixed != null && <span style={{ color: "#f472b6", fontWeight: 600 }}>Mixed ★ {user.duprRatingMixed}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── BUDDIES ── */}
        {activeTab === "buddies" && (
          <div className="tab-panel fade-in">
            <div className="page-header">
              <h2>Buddies</h2>
              <p className="muted">Find and connect with fellow players.</p>
            </div>
            <div className="content-grid">
              {/* Left: search + invite */}
              <div className="glass-card">
                <h3 className="card-title">Find Players</h3>

                {/* Search input */}
                <div className="search-wrap">
                  <span className="search-icon" aria-hidden>🔍</span>
                  <input
                    className="search-input"
                    placeholder="Search by name, email or phone…"
                    value={buddyQuery}
                    onChange={e => setBuddyQuery(e.target.value)}
                    autoComplete="off"
                  />
                  {searching && <span className="search-spinner" aria-hidden>⟳</span>}
                </div>

                {/* Search results */}
                {buddyQuery.trim().length >= 2 && (
                  <ul className="search-results">
                    {searchResults.length === 0 && !searching && (
                      <li className="search-no-results">No players found.</li>
                    )}
                    {searchResults.map(u => {
                      const already = buddies.some(b => b.id === u.id);
                      return (
                        <li key={u.id} className="search-result-row">
                          <Avatar name={u.name} />
                          <div className="search-result-info">
                            <div className="entity-name">{u.name}</div>
                            <div className="entity-sub">{u.email || u.phone}</div>
                          </div>
                          {already
                            ? <span className="already-badge">Added</span>
                            : (
                              <button
                                className="btn-add-icon"
                                aria-label={`Add ${u.name} as buddy`}
                                disabled={addingId === u.id}
                                onClick={() => onAddBuddyById(u.id)}
                              >
                                {addingId === u.id ? "…" : "+"}
                              </button>
                            )
                          }
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Invite fallback */}
                <div className="invite-divider">
                  <span>Not registered yet? Invite by contact</span>
                </div>
                <form onSubmit={onAddBuddy} className="invite-form">
                  <input
                    placeholder="Email or phone number"
                    value={buddyInput.buddyEmail}
                    onChange={e => setBuddyInput({ ...buddyInput, buddyEmail: e.target.value })}
                  />
                  <button type="submit" className="btn-primary invite-btn" disabled={loading}>
                    + Add
                  </button>
                </form>
              </div>

              {/* Right: your buddies list */}
              <div className="glass-card">
                <h3 className="card-title">
                  Your Buddies <span className="count-badge">{buddies.length}</span>
                </h3>
                {buddies.length === 0
                  ? <p className="empty-state">No buddies yet — search for players above!</p>
                  : <ul className="entity-list">
                      {buddies.map(b => (
                        <li key={b.id}>
                          <Avatar name={b.name} />
                          <div>
                            <div className="entity-name">{b.name}</div>
                            <div className="entity-sub">{b.email || b.phone}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                }
              </div>
            </div>
          </div>
        )}

        {/* ── CLUBS ── */}
        {activeTab === "clubs" && (
          <div className="tab-panel fade-in">
            <div className="page-header">
              <h2>Clubs</h2>
              <p className="muted">Join, create, and manage pickleball clubs.</p>
            </div>

            {/* Pending invites banner */}
            {clubInvites.length > 0 && (
              <div className="glass-card invites-banner">
                <h3 className="card-title">Club Invites <span className="count-badge">{clubInvites.length}</span></h3>
                <div className="invites-list">
                  {clubInvites.map(inv => (
                    <div key={inv.id} className="invite-item">
                      <div className="entity-icon clubs-icon"><img src={clubIcon} alt="" /></div>
                      <div className="invite-info">
                        <div className="entity-name">{inv.clubName}</div>
                        <div className="entity-sub">Invited by {inv.invitedByName}</div>
                      </div>
                      <div className="invite-actions">
                        <button className="btn-accept" onClick={() => onAcceptInvite(inv.id)} disabled={loading}>Accept</button>
                        <button className="btn-decline" onClick={() => onDeclineInvite(inv.id)} disabled={loading}>Decline</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="content-grid">
              {/* Left: Create + Join by Code */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="glass-card">
                  <h3 className="card-title">Create a Club</h3>
                  <form onSubmit={onCreateClub} className="stack-form">
                    <div className="field">
                      <label>Club Name</label>
                      <input placeholder="e.g. Downtown Picklers" value={clubName} onChange={e => setClubName(e.target.value)} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Privacy</label>
                        <select value={clubCreatePrivacy} onChange={e => setClubCreatePrivacy(e.target.value as "PUBLIC" | "PRIVATE")}>
                          <option value="PUBLIC">Public</option>
                          <option value="PRIVATE">Private</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Location</label>
                        <input placeholder="City / facility" value={clubCreateLocation} onChange={e => setClubCreateLocation(e.target.value)} />
                      </div>
                    </div>
                    <button type="submit" className="btn-primary" disabled={loading}>Create Club</button>
                  </form>
                </div>

                <div className="glass-card">
                  <h3 className="card-title">Join by Code</h3>
                  <form onSubmit={onJoinByCode} className="stack-form">
                    <div className="field">
                      <input
                        placeholder="Enter 6-char join code"
                        value={clubJoinCode}
                        onChange={e => setClubJoinCode(e.target.value.toUpperCase())}
                        maxLength={6}
                        style={{ letterSpacing: "0.15em", textTransform: "uppercase" }}
                      />
                    </div>
                    <button type="submit" className="btn-primary" disabled={loading || clubJoinCode.length < 6}>Join</button>
                  </form>
                </div>
              </div>

              {/* Right: Club detail OR list */}
              {selectedClub ? (
                <div className="glass-card club-detail">
                  <button className="btn-back" onClick={() => setSelectedClub(null)}>← All Clubs</button>

                  <div className="club-detail-header">
                    <div>
                      <h3 className="card-title" style={{ marginBottom: 4 }}>{selectedClub.name}</h3>
                      <div className="tourney-meta">
                        <span className={`badge ${selectedClub.privacy === "PRIVATE" ? "badge-de" : "badge-rr"}`}>{selectedClub.privacy}</span>
                        {selectedClub.location && <span className="tourney-meta-item">📍 {selectedClub.location}</span>}
                        <span className="tourney-meta-item">{selectedClub.memberIds.length} member{selectedClub.memberIds.length !== 1 ? "s" : ""}</span>
                      </div>
                    </div>
                    {selectedClub.memberIds.includes(user.id)
                      ? <span className="badge badge-rec">Member ✓</span>
                      : selectedClub.privacy === "PRIVATE" && !selectedClub.allowDirectJoin
                      ? <span className="badge badge-de" title="Contact director or use join code">Closed</span>
                      : <button className="btn-join" onClick={() => onJoinClub(selectedClub.id)} disabled={loading}>
                          {selectedClub.privacy === "PRIVATE" ? "Request to Join" : "Join Club"}
                        </button>
                    }
                  </div>

                  {/* Sub-tabs */}
                  <div className="sub-tab-bar">
                    {(["overview", "sessions", "members"] as const).map(tab => (
                      <button
                        key={tab}
                        className={`sub-tab-btn${clubDetailTab === tab ? " active" : ""}`}
                        onClick={() => {
                          setClubDetailTab(tab);
                          if (tab === "sessions") loadClubSessions(selectedClub.id);
                        }}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                    {selectedClub.createdBy === user.id && (
                      <button
                        className={`sub-tab-btn${clubDetailTab === "director" ? " active" : ""}`}
                        onClick={() => { setClubDetailTab("director"); loadClubDirectorData(selectedClub.id); }}
                      >
                        ⚙ Director
                      </button>
                    )}
                  </div>

                  {/* Overview tab */}
                  {clubDetailTab === "overview" && (
                    <div>
                      {selectedClub.description && <p className="entity-sub" style={{ marginBottom: 12 }}>{selectedClub.description}</p>}
                      <div className="member-avatars" style={{ marginBottom: 12 }}>
                        {selectedClub.members.slice(0, 10).map(m => (
                          <div key={m.id} className="member-avatar-wrap" title={m.name}>
                            <Avatar name={m.name} size={32} />
                          </div>
                        ))}
                        {selectedClub.memberIds.length > 10 && <div className="more-members">+{selectedClub.memberIds.length - 10}</div>}
                      </div>
                      {selectedClub.createdBy === user.id && selectedClub.joinCode && (
                        <div className="join-code-display">
                          <span className="muted">Join Code:</span>
                          <span className="join-code-value">{selectedClub.joinCode}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sessions tab */}
                  {clubDetailTab === "sessions" && (
                    <div>
                      {selectedClub.createdBy === user.id && (
                        <form onSubmit={onCreateSession} className="stack-form" style={{ marginBottom: 16 }}>
                          <div className="field">
                            <label>Session Name</label>
                            <input placeholder="e.g. Tuesday Evening Open Play" value={newSession.name} onChange={e => setNewSession({ ...newSession, name: e.target.value })} />
                          </div>
                          <div className="field-row">
                            <div className="field">
                              <label>Type</label>
                              <select value={newSession.sessionType} onChange={e => setNewSession({ ...newSession, sessionType: e.target.value })}>
                                <option value="COMPETITIVE">Competitive</option>
                                <option value="SOCIAL">Social</option>
                                <option value="DRILL">Drill</option>
                              </select>
                            </div>
                            <div className="field">
                              <label>Format</label>
                              <select value={newSession.format} onChange={e => setNewSession({ ...newSession, format: e.target.value })}>
                                <option value="DOUBLES">Doubles</option>
                                <option value="SINGLES">Singles</option>
                                <option value="MIXED">Mixed</option>
                              </select>
                            </div>
                          </div>
                          <div className="field-row">
                            <div className="field">
                              <label>Skill Min</label>
                              <input placeholder="e.g. 3.0" value={newSession.skillMin} onChange={e => setNewSession({ ...newSession, skillMin: e.target.value })} />
                            </div>
                            <div className="field">
                              <label>Skill Max</label>
                              <input placeholder="e.g. 4.5" value={newSession.skillMax} onChange={e => setNewSession({ ...newSession, skillMax: e.target.value })} />
                            </div>
                          </div>
                          <div className="field">
                            <label>Scheduled At</label>
                            <input placeholder="e.g. 2025-06-10 18:00" value={newSession.scheduledAt} onChange={e => setNewSession({ ...newSession, scheduledAt: e.target.value })} />
                          </div>
                          <button type="submit" className="btn-primary" disabled={loading}>Create Session</button>
                        </form>
                      )}
                      {clubSessions.length === 0
                        ? <p className="empty-state">No sessions yet.</p>
                        : <ul className="entity-list">
                            {clubSessions.map(s => (
                              <li key={s.id}>
                                <div style={{ flex: 1 }}>
                                  <div className="entity-name">{s.name}</div>
                                  <div className="entity-sub">
                                    {s.sessionType} · {s.format}
                                    {s.skillMin && ` · ${s.skillMin}–${s.skillMax ?? "+"}`}
                                    {s.scheduledAt && ` · ${s.scheduledAt}`}
                                    {" · "}{s.gamesCount ?? 0} game{s.gamesCount !== 1 ? "s" : ""}
                                  </div>
                                </div>
                                <span className={`badge ${s.status === "APPROVED" ? "badge-status-active" : s.status === "OPEN" ? "badge-rr" : "badge-de"}`}>{s.status}</span>
                                {selectedClub.createdBy === user.id && s.status === "OPEN" && (
                                  <button className="btn-sm btn-sm-active" disabled={loading} onClick={() => onApproveSession(s.id)}>Approve</button>
                                )}
                              </li>
                            ))}
                          </ul>
                      }
                    </div>
                  )}

                  {/* Members tab */}
                  {clubDetailTab === "members" && (
                    <div>
                      <ul className="entity-list">
                        {selectedClub.members.map(m => (
                          <li key={m.id}>
                            <Avatar name={m.name} size={32} />
                            <div style={{ flex: 1 }}>
                              <div className="entity-name">{m.name}</div>
                              <div className="entity-sub">{m.email || m.phone}</div>
                            </div>
                            {selectedClub.createdBy === user.id ? (
                              editingRatingId === m.id
                                ? <span className="score-input-row">
                                    <input className="score-box" value={ratingInput} onChange={e => setRatingInput(e.target.value)} style={{ width: 56 }} autoFocus />
                                    <button className="btn-sm btn-sm-active" onClick={() => onSaveMemberRating(m.id)}>Save</button>
                                    <button className="btn-sm" onClick={() => setEditingRatingId(null)}>✕</button>
                                  </span>
                                : <button className="btn-sm" onClick={() => { setEditingRatingId(m.id); setRatingInput(m.duprRating?.toString() ?? ""); }}>
                                    {m.duprRating ? `★ ${m.duprRating}` : "Set Rating"}
                                  </button>
                            ) : (
                              m.duprRating ? <span className="badge badge-rr">★ {m.duprRating}</span> : null
                            )}
                          </li>
                        ))}
                      </ul>

                      {/* Invite section */}
                      {selectedClub.memberIds.includes(user.id) && (
                        <>
                          <div className="invite-section-divider"><span>Invite Players</span></div>
                          <div className="search-wrap">
                            <span className="search-icon" aria-hidden>🔍</span>
                            <input className="search-input" placeholder="Search by name, email or phone…" value={clubInviteQuery} onChange={e => setClubInviteQuery(e.target.value)} autoComplete="off" />
                            {clubInviteSearching && <span className="search-spinner" aria-hidden>⟳</span>}
                          </div>
                          {clubInviteQuery.trim().length >= 2 && (
                            <ul className="search-results">
                              {clubInviteResults.length === 0 && !clubInviteSearching && <li className="search-no-results">No players found.</li>}
                              {clubInviteResults.map(u => {
                                const isMember = selectedClub.memberIds.includes(u.id);
                                const isInvited = pendingInviteIds.has(u.id);
                                return (
                                  <li key={u.id} className="search-result-row">
                                    <Avatar name={u.name} />
                                    <div className="search-result-info">
                                      <div className="entity-name">{u.name}</div>
                                      <div className="entity-sub">{u.email || u.phone}</div>
                                    </div>
                                    {isMember ? <span className="already-badge">Member</span>
                                      : isInvited ? <span className="already-badge invited-badge">Invited</span>
                                      : <button className="btn-invite-icon" aria-label={`Invite ${u.name}`} disabled={invitingId === u.id} onClick={() => onInviteToClub(selectedClub.id, u.id)}>{invitingId === u.id ? "…" : "✉"}</button>
                                    }
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {clubInviteQuery.trim().length < 2 && <p className="search-hint">Type at least 2 characters to search.</p>}
                        </>
                      )}
                    </div>
                  )}

                  {/* Director tab */}
                  {clubDetailTab === "director" && selectedClub.createdBy === user.id && (
                    <div>
                      {/* Analytics cards */}
                      {clubAnalytics && (
                        <div className="analytics-grid">
                          <div className="analytics-card"><div className="analytics-value">{clubAnalytics.memberCount}</div><div className="analytics-label">Members</div></div>
                          <div className="analytics-card"><div className="analytics-value">{clubAnalytics.sessionCount}</div><div className="analytics-label">Sessions</div></div>
                          <div className="analytics-card"><div className="analytics-value">{clubAnalytics.gameCount}</div><div className="analytics-label">Games</div></div>
                          <div className="analytics-card"><div className="analytics-value">{clubAnalytics.avgDuprRating ? clubAnalytics.avgDuprRating.toFixed(2) : "—"}</div><div className="analytics-label">Avg DUPR</div></div>
                        </div>
                      )}

                      {/* Pending join requests */}
                      {clubJoinRequests.filter(r => r.status === "PENDING").length > 0 && (
                        <div style={{ marginBottom: 20 }}>
                          <div className="invite-section-divider"><span>Pending Join Requests</span></div>
                          <ul className="entity-list">
                            {clubJoinRequests.filter(r => r.status === "PENDING").map(r => (
                              <li key={r.id}>
                                <Avatar name={r.userName} size={28} />
                                <div style={{ flex: 1 }}>
                                  <div className="entity-name">{r.userName}</div>
                                  <div className="entity-sub">{new Date(r.createdAt).toLocaleDateString()}</div>
                                </div>
                                <button className="btn-sm btn-sm-active" disabled={loading} onClick={() => onApproveJoinRequest(r.id)}>Approve</button>
                                <button className="btn-sm" disabled={loading} onClick={() => onDenyJoinRequest(r.id)}>Deny</button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Club settings */}
                      <div className="invite-section-divider"><span>Club Settings</span></div>
                      <form onSubmit={onSaveClubSettings} className="stack-form">
                        <div className="field">
                          <label>Description</label>
                          <input placeholder="About this club…" value={clubSettings.description} onChange={e => setClubSettings({ ...clubSettings, description: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Location</label>
                          <input placeholder="City / facility" value={clubSettings.location} onChange={e => setClubSettings({ ...clubSettings, location: e.target.value })} />
                        </div>
                        <div className="field-row">
                          <div className="field">
                            <label>Privacy</label>
                            <select value={clubSettings.privacy} onChange={e => setClubSettings({ ...clubSettings, privacy: e.target.value as "PUBLIC" | "PRIVATE" })}>
                              <option value="PUBLIC">Public</option>
                              <option value="PRIVATE">Private</option>
                            </select>
                          </div>
                          {clubSettings.privacy === "PRIVATE" && (
                            <div className="field">
                              <label>Allow Join Requests</label>
                              <select value={clubSettings.allowDirectJoin ? "yes" : "no"} onChange={e => setClubSettings({ ...clubSettings, allowDirectJoin: e.target.value === "yes" })}>
                                <option value="yes">Enabled (pending approval)</option>
                                <option value="no">Disabled (code only)</option>
                              </select>
                            </div>
                          )}
                        </div>
                        <button type="submit" className="btn-primary" disabled={loading}>Save Settings</button>
                      </form>

                      {/* Join code */}
                      <div className="join-code-display" style={{ marginTop: 16 }}>
                        <span className="muted">Join Code:</span>
                        <span className="join-code-value">{selectedClub.joinCode}</span>
                        <button className="btn-sm" disabled={loading} onClick={onRegenerateJoinCode}>Regenerate</button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-card">
                  <h3 className="card-title">All Clubs <span className="count-badge">{clubs.length}</span></h3>
                  {clubs.length === 0
                    ? <p className="empty-state">No clubs yet — create one!</p>
                    : <ul className="entity-list">
                        {clubs.map(c => (
                          <li key={c.id} className="clickable-row" onClick={() => selectClub(c.id)}>
                            <div className="entity-icon clubs-icon"><img src={clubIcon} alt="" /></div>
                            <div style={{ flex: 1 }}>
                              <div className="entity-name">{c.name}</div>
                              <div className="entity-sub">
                                {c.memberIds.length} member{c.memberIds.length !== 1 ? "s" : ""}
                                {c.location && ` · ${c.location}`}
                              </div>
                            </div>
                            <span className={`badge ${c.privacy === "PRIVATE" ? "badge-de" : "badge-rr"}`} style={{ fontSize: "0.62rem" }}>{c.privacy}</span>
                            {c.memberIds.includes(user.id) && <span className="badge badge-rec" style={{ fontSize: "0.62rem" }}>Member</span>}
                            <span className="entity-chevron">›</span>
                          </li>
                        ))}
                      </ul>
                  }
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── QUICK PLAY ── */}
        {activeTab === "quick-play" && (
          <div className="tab-panel fade-in">
            {selectedQp ? (() => {
              const qp = selectedQp.session;
              const matches = selectedQp.matches;
              const isOrganizer = user.id === qp.createdBy;
              const allParticipants = [
                ...qp.playerIds,
                ...qp.guestNames.map(g => g.id)
              ];
              const nameMap = new Map<string, string>();
              qp.guestNames.forEach(g => nameMap.set(g.id, g.name));
              // Registered player names from API
              Object.entries(selectedQp.playerNames ?? {}).forEach(([id, name]) => nameMap.set(id, name));

              function qpName(ids: string[]) {
                return ids.map(id => nameMap.get(id) ?? (user!.id === id ? user!.name : id.slice(-4))).join(" & ");
              }

              const setsPerMatch = qp.setsPerMatch ?? 1;

              function initScoreInput(m: QpMatch) {
                if (setsPerMatch > 1 && m.setScores?.length) {
                  return { sets: m.setScores.map(([a, b]) => ({ s1: a.toString(), s2: b.toString() })) };
                }
                const base = m.scoreTeam1 !== undefined ? m.scoreTeam1.toString() : "";
                const base2 = m.scoreTeam2 !== undefined ? m.scoreTeam2.toString() : "";
                return { sets: Array.from({ length: setsPerMatch }, (_, i) => i === 0 ? { s1: base, s2: base2 } : { s1: "", s2: "" }) };
              }

              function renderQpScore(m: QpMatch) {
                if (!m.setScores || m.setScores.length <= 1) {
                  const t1wins = m.winnerIds?.some(w => m.team1Ids.includes(w));
                  return (
                    <div className="match-score">
                      <span className={`match-score-num${t1wins ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                      <span className="match-score-dash">–</span>
                      <span className={`match-score-num${!t1wins ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                    </div>
                  );
                }
                const t1wins = m.winnerIds?.some(w => m.team1Ids.includes(w));
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
                    <div style={{ fontSize: "0.68rem", color: "var(--muted)", fontWeight: 700 }}>
                      {m.setScores.map(([a, b], i) => <span key={i} style={{ marginRight: 4 }}>{a}–{b}</span>)}
                    </div>
                    <div className="match-score">
                      <span className={`match-score-num${t1wins ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                      <span className="match-score-dash">–</span>
                      <span className={`match-score-num${!t1wins ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                    </div>
                  </div>
                );
              }

              function renderQpScoreInput(m: QpMatch) {
                const inp = qpScoreInputs[m.id] ?? { sets: Array.from({ length: setsPerMatch }, () => ({ s1: "", s2: "" })) };
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {setsPerMatch > 1 && (
                      <span style={{ fontSize: "0.62rem", color: "var(--muted)" }}>Enter sets played — leave unused sets blank</span>
                    )}
                    {inp.sets.map((s, i) => (
                      <div key={i} className="score-input-row">
                        {setsPerMatch > 1 && <span style={{ fontSize: "0.65rem", color: "var(--muted)", minWidth: 28 }}>Set {i + 1}</span>}
                        <input placeholder="11" value={s.s1} onChange={e => setQpScoreInputs(p => {
                          const cur = p[m.id] ?? { sets: inp.sets };
                          const sets = [...cur.sets]; sets[i] = { ...sets[i], s1: e.target.value };
                          return { ...p, [m.id]: { sets } };
                        })} />
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                        <input placeholder="8" value={s.s2} onChange={e => setQpScoreInputs(p => {
                          const cur = p[m.id] ?? { sets: inp.sets };
                          const sets = [...cur.sets]; sets[i] = { ...sets[i], s2: e.target.value };
                          return { ...p, [m.id]: { sets } };
                        })} />
                      </div>
                    ))}
                    <div className="score-input-row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn-confirm" onClick={() => onSubmitQpScore(m.id)} disabled={loading}>✓</button>
                      <button className="btn-decline" onClick={() => setQpReportingId(null)}>✕</button>
                    </div>
                  </div>
                );
              }

              const regMatches = matches.filter(m => !m.isPlayoff);
              const playoffMatches = matches.filter(m => m.isPlayoff);
              const confirmedCount = regMatches.filter(m => m.status === "CONFIRMED").length;
              const rounds = [...new Set(regMatches.map(m => m.roundNumber))].sort((a, b) => a - b);

              // Playoff state helpers
              const semiFinals = playoffMatches.filter(m => m.roundNumber === 1);
              const finalsMatch = playoffMatches.find(m => m.roundNumber === 2);
              const thirdPlaceMatch = playoffMatches.find(m => m.roundNumber === 3);
              const bothSemisConfirmed = semiFinals.length >= 2 && semiFinals.every(m => m.status === "CONFIRMED");
              const finalsConfirmed = finalsMatch?.status === "CONFIRMED";

              return (
                <>
                  <button className="btn-back" onClick={() => setSelectedQp(null)}>← All Sessions</button>

                  <div className="glass-card tourney-header">
                    <div className="tourney-header-top">
                      <div>
                        <h2 className="tourney-name">{qp.name}</h2>
                        <div className="tourney-meta">
                          <span className={`badge badge-rr`}>{qp.format === "SINGLES" ? "Singles" : `Doubles ${qp.rrType}`}</span>
                          <span className="tourney-meta-item">🎾 {qp.courtCount} court{qp.courtCount !== 1 ? "s" : ""}</span>
                          <span className="tourney-meta-item">👥 {allParticipants.length} players</span>
                          {setsPerMatch > 1 && <span className="tourney-meta-item">Bo{setsPerMatch}</span>}
                          {qp.matchesPerPlayer > 0 && <span className="tourney-meta-item">{qp.matchesPerPlayer} max matches/player</span>}
                        </div>
                      </div>
                      <div className="tourney-header-actions">
                        <span className={`badge ${qp.status === "COMPLETED" ? "badge-closed" : qp.status === "ACTIVE" || qp.status === "PLAYOFFS" ? "badge-status-active" : "badge-status-pending"}`}>{qp.status}</span>
                      </div>
                    </div>
                    <div className="tourney-stats-row">
                      <span>{confirmedCount} / {regMatches.length} games scored</span>
                      {playoffMatches.length > 0 && <span>{playoffMatches.length} playoff match{playoffMatches.length !== 1 ? "es" : ""}</span>}
                    </div>
                  </div>

                  {/* Winners Circle */}
                  {qp.status === "COMPLETED" && qp.placements.length > 0 && (
                    <div className="glass-card" style={{ background: "linear-gradient(135deg, rgba(251,191,36,.08) 0%, rgba(124,107,255,.08) 100%)", border: "1px solid rgba(251,191,36,.25)", textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#fbbf24", marginBottom: 16, letterSpacing: ".04em", textTransform: "uppercase" }}>🏆 Winners Circle</div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap" }}>
                        {qp.placements.map(p => (
                          <div key={p.position} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <span style={{ fontSize: "2rem" }}>{p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : "🥉"}</span>
                            <span style={{ fontWeight: 700, fontSize: "0.9rem", color: p.position === 1 ? "#fbbf24" : p.position === 2 ? "#94a3b8" : "#cd7c2b" }}>{qpName(p.playerIds)}</span>
                            <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 600 }}>{p.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Edit panel — players + settings (SETUP / SCHEDULED only) */}
                  {isOrganizer && (qp.status === "SETUP" || qp.status === "SCHEDULED") && qpEditSettings && (
                    <div className="glass-card" style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.8rem", color: "#b8acff", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 12 }}>✏ Edit Session</div>

                      {/* Player list */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Players ({allParticipants.length})</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {qp.playerIds.map(pid => (
                            <span key={pid} className="div-label-chip" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              {nameMap.get(pid) ?? (user.id === pid ? user.name : pid.slice(-4))}
                              <button style={{ all: "unset", cursor: "pointer", color: "var(--muted)", fontSize: "0.8rem" }} onClick={() => onQpRemovePlayer(pid)}>×</button>
                            </span>
                          ))}
                          {qp.guestNames.map(g => (
                            <span key={g.id} className="div-label-chip" style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(251,191,36,.1)", borderColor: "rgba(251,191,36,.3)", color: "#fbbf24" }}>
                              {g.name} (guest)
                              <button style={{ all: "unset", cursor: "pointer", color: "var(--muted)", fontSize: "0.8rem" }} onClick={() => onQpRemoveGuest(g.id)}>×</button>
                            </span>
                          ))}
                        </div>
                        {/* Add registered player */}
                        <div className="search-wrap" style={{ marginBottom: 6 }}>
                          <span className="search-icon">🔍</span>
                          <input className="search-input" placeholder="Add player by name / email…" value={qpEditPlayerQuery}
                            onChange={e => setQpEditPlayerQuery(e.target.value)} autoComplete="off" />
                          {qpEditPlayerSearching && <span className="search-spinner">⟳</span>}
                        </div>
                        {qpEditPlayerQuery.trim().length >= 2 && (
                          <ul className="search-results" style={{ marginBottom: 8 }}>
                            {qpEditPlayerResults.length === 0 && !qpEditPlayerSearching && <li className="search-no-results">No players found.</li>}
                            {qpEditPlayerResults.filter(u => !allParticipants.includes(u.id)).map(u => (
                              <li key={u.id} className="search-result-row">
                                <Avatar name={u.name} />
                                <div className="search-result-info"><div className="entity-name">{u.name}</div><div className="entity-sub">{u.email || u.phone}</div></div>
                                <button className="btn-add-icon" onClick={() => onQpAddPlayer(u)}>+</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {/* Add guest */}
                        <div style={{ display: "flex", gap: 6 }}>
                          <input style={{ flex: 1, fontSize: "0.82rem", padding: "5px 10px", background: "var(--surface)", border: "1px solid var(--border-s)", borderRadius: 8, color: "var(--text)" }}
                            placeholder="Guest name(s), comma-separated"
                            value={qpEditGuestInput} onChange={e => setQpEditGuestInput(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && onQpAddGuest()} />
                          <button className="btn-sm btn-sm-generate" style={{ whiteSpace: "nowrap" }} onClick={onQpAddGuest} disabled={!qpEditGuestInput.trim()}>+ Guest</button>
                        </div>
                      </div>

                      {/* Courts + game settings */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                        <div className="field" style={{ flex: "1 1 80px", minWidth: 80 }}>
                          <label style={{ fontSize: "0.72rem" }}>Courts</label>
                          <input type="number" min="1" max="20" value={qpEditSettings.courtCount}
                            onChange={e => setQpEditSettings(s => s ? { ...s, courtCount: e.target.value } : s)} />
                        </div>
                        <div className="field" style={{ flex: "2 1 160px", minWidth: 160 }}>
                          <label style={{ fontSize: "0.72rem" }}>Court Names (optional)</label>
                          <input placeholder="Court 1, Court 2, …" value={qpEditSettings.courtLabels}
                            onChange={e => setQpEditSettings(s => s ? { ...s, courtLabels: e.target.value } : s)} />
                        </div>
                        <div className="field" style={{ flex: "1 1 90px", minWidth: 90 }}>
                          <label style={{ fontSize: "0.72rem" }}>Sets / Game</label>
                          <select value={qpEditSettings.setsPerMatch} onChange={e => setQpEditSettings(s => s ? { ...s, setsPerMatch: e.target.value } : s)}>
                            <option value="1">Best of 1</option>
                            <option value="3">Best of 3</option>
                            <option value="5">Best of 5</option>
                          </select>
                        </div>
                        {qp.rrType === "SWITCH" && (
                          <div className="field" style={{ flex: "1 1 110px", minWidth: 110 }}>
                            <label style={{ fontSize: "0.72rem" }}>Max Matches/Player</label>
                            <input type="number" min="1" placeholder="Auto" value={qpEditSettings.matchesPerPlayer}
                              onChange={e => setQpEditSettings(s => s ? { ...s, matchesPerPlayer: e.target.value } : s)} />
                          </div>
                        )}
                      </div>
                      <button className="btn-sm btn-sm-active" disabled={loading} onClick={onSaveQpSettings}>Save Settings</button>
                    </div>
                  )}

                  {/* Partner Setup — Doubles SET format only */}
                  {qp.format === "ROUND_ROBIN" && qp.rrType === "SET" && (
                    <div className="glass-card" style={{ marginBottom: 16 }}>
                      <h3 className="card-title">🤝 Partner Setup</h3>
                      {allParticipants.length % 2 !== 0 && (
                        <p style={{ fontSize: "0.78rem", color: "var(--pink)", margin: "0 0 10px" }}>
                          ⚠️ Even number of players required — add or remove one player.
                        </p>
                      )}
                      {(!isOrganizer || !["SETUP", "SCHEDULED"].includes(qp.status)) ? (
                        (qp.teams ?? []).length === 0 ? (
                          <p className="empty-state">No teams assigned yet.</p>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {(qp.teams ?? []).map((team, i) => (
                              <span key={i} className="tourney-meta-item">Team {i + 1}: {qpName(team)}</span>
                            ))}
                          </div>
                        )
                      ) : (() => {
                        const pairedIds = new Set(qpLocalTeams.flat());
                        const unassigned = allParticipants.filter(id => !pairedIds.has(id));
                        return (
                          <>
                            {unassigned.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 6 }}>
                                  {qpTeamFirstPick
                                    ? `Partner for ${qpName([qpTeamFirstPick])}:`
                                    : "Click two players to pair them as a team:"}
                                </p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {unassigned.map(id => (
                                    <button key={id} onClick={() => onPickTeamPlayer(id)}
                                      className="div-label-chip"
                                      style={{ cursor: "pointer", background: qpTeamFirstPick === id ? "rgba(236,72,153,0.3)" : "rgba(139,92,246,0.1)", borderColor: qpTeamFirstPick === id ? "var(--pink)" : "rgba(139,92,246,0.3)", color: qpTeamFirstPick === id ? "var(--pink)" : "var(--text)", fontWeight: qpTeamFirstPick === id ? 700 : 400 }}>
                                      {qpName([id])}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            {qpLocalTeams.length > 0 && (
                              <div style={{ marginBottom: 10 }}>
                                <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 6 }}>Teams:</p>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                  {qpLocalTeams.map((team, i) => (
                                    <span key={i} className="div-label-chip" style={{ background: "rgba(16,185,129,0.1)", borderColor: "rgba(16,185,129,0.4)", color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                                      <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>T{i+1}</span>
                                      {qpName(team)}
                                      <button style={{ all: "unset", cursor: "pointer", color: "var(--muted)", fontSize: "0.8rem" }} onClick={() => onRemoveLocalTeam(i)}>×</button>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <button className="btn-sm btn-sm-active" style={{ marginTop: 6 }}
                              onClick={onSaveQpTeams} disabled={loading || allParticipants.length % 2 !== 0 || qpLocalTeams.length * 2 !== allParticipants.length}>
                              💾 Save Teams{unassigned.length > 0 ? ` (${unassigned.length} unassigned)` : ""}
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Organizer controls */}
                  {isOrganizer && (
                    <div className="organizer-panel">
                      <div className="organizer-panel-title">⚙ Organizer Controls</div>
                      <div className="organizer-controls">
                        {(qp.status === "SETUP" || qp.status === "SCHEDULED") && (
                          qp.format === "ROUND_ROBIN" && qp.rrType === "SET" ? (
                            allParticipants.length < 2 ? null :
                            allParticipants.length % 2 !== 0 ? (
                              <span className="muted" style={{ fontSize: "0.75rem" }}>⚠️ Need even number of players for Set Partners</span>
                            ) : (qp.teams ?? []).length * 2 < allParticipants.length ? (
                              <span className="muted" style={{ fontSize: "0.75rem" }}>⚠️ Save partner teams first (Partner Setup above)</span>
                            ) : (
                              <button className="btn-sm btn-sm-generate" disabled={loading} onClick={onGenerateQpSchedule}>
                                🎲 {qp.status === "SCHEDULED" ? "Re-generate Schedule" : "Generate Schedule"}
                              </button>
                            )
                          ) : (
                            allParticipants.length >= 2 && (
                              <button className="btn-sm btn-sm-generate" disabled={loading} onClick={onGenerateQpSchedule}>
                                🎲 {qp.status === "SCHEDULED" ? "Re-generate Schedule" : "Generate Schedule"}
                              </button>
                            )
                          )
                        )}
                        {qp.status === "SCHEDULED" && (
                          <button className="btn-sm btn-sm-active" disabled={loading} onClick={onFinalizeQpSession}>
                            ✓ Finalize (open scoring)
                          </button>
                        )}
                        {qp.status === "ACTIVE" && confirmedCount >= regMatches.length && regMatches.length > 0 && (
                          <button className="btn-sm btn-sm-generate" disabled={loading} onClick={onCreateQpPlayoffs}>
                            🏆 Create Playoffs (Top 4)
                          </button>
                        )}
                        {qp.status === "PLAYOFFS" && bothSemisConfirmed && !thirdPlaceMatch && (
                          <button className="btn-sm" style={{ background: "rgba(148,163,184,.12)", border: "1px solid rgba(148,163,184,.25)", color: "#94a3b8" }} disabled={loading} onClick={onCreateQpThirdPlace}>
                            🥉 Add 3rd Place Match
                          </button>
                        )}
                        {qp.status === "PLAYOFFS" && finalsConfirmed && (
                          <button className="btn-sm" style={{ background: "rgba(251,191,36,.22)", border: "1px solid rgba(251,191,36,.45)", color: "#fbbf24", fontWeight: 800 }} disabled={loading} onClick={onDeclareQpWinner}>
                            🏆 Declare Winner
                          </button>
                        )}
                      </div>
                      {/* Danger zone — separate row so it never gets squished */}
                      <div className="organizer-danger-row">
                        {!finalsConfirmed && (qp.status === "ACTIVE" || qp.status === "PLAYOFFS") && (
                          <button className="btn-danger-outline" disabled={loading} onClick={onCloseQpSession}>
                            🏁 Close Without Winner
                          </button>
                        )}
                        <button className="btn-danger" disabled={loading} onClick={onDeleteQpSession}>
                          🗑 Delete Session
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="sub-tab-bar">
                    <button className={`sub-tab-btn${qpDetailTab === "schedule" ? " active" : ""}`} onClick={() => setQpDetailTab("schedule")}>
                      Schedule <span className="count-badge" style={{ marginLeft: 6 }}>{matches.length}</span>
                    </button>
                    <button className={`sub-tab-btn${qpDetailTab === "standings" ? " active" : ""}`} onClick={() => { setQpDetailTab("standings"); loadQpStandings(); }}>
                      Standings
                    </button>
                  </div>

                  {/* Schedule tab */}
                  {qpDetailTab === "schedule" && (
                    <div className="glass-card">
                      {matches.length === 0 ? (
                        <p className="empty-state">{isOrganizer ? "Generate the schedule above." : "Schedule not created yet."}</p>
                      ) : (
                        <>
                          {/* Regular rounds */}
                          {rounds.length > 0 && (
                            <>
                              <div style={{ fontWeight: 700, color: "#b8acff", fontSize: "0.8rem", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>Round Robin</div>
                              {rounds.map(rnd => {
                                const rndMatches = regMatches.filter(m => m.roundNumber === rnd);
                                const playingIds = new Set(rndMatches.flatMap(m => [...m.team1Ids, ...m.team2Ids]));
                                const restingIds = allParticipants.filter(id => !playingIds.has(id));
                                return (
                                <div key={rnd}>
                                  <div className="match-round-label" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span>Round {rnd}</span>
                                    {restingIds.length > 0 && (
                                      <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--muted)", background: "rgba(255,255,255,.04)", border: "1px solid var(--border)", borderRadius: 6, padding: "1px 7px" }}>
                                        💤 Resting: {restingIds.map(id => qpName([id])).join(", ")}
                                      </span>
                                    )}
                                  </div>
                                  {rndMatches.map(m => {
                                    const isReporting = qpReportingId === m.id;
                                    const canScore = qp.status === "ACTIVE" && !isOrganizer && (m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id));
                                    const organizerScore = isOrganizer && qp.status === "ACTIVE";
                                    return (
                                      <div key={m.id} className="match-row">
                                        <div className="match-teams">
                                          <span className="match-team-name">{qpName(m.team1Ids)}</span>
                                          <span className="match-vs">vs</span>
                                          <span className="match-team-name">{qpName(m.team2Ids)}</span>
                                        </div>
                                        {m.court && <span className="muted" style={{ fontSize: "0.72rem", marginRight: 4 }}>{m.court}</span>}
                                        {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && renderQpScore(m)}
                                        <div className="match-actions">
                                          <span className={`badge badge-status-${m.status.toLowerCase()}`}>
                                            {m.status === "CONFIRMED" ? "Done" : "Scheduled"}
                                          </span>
                                          {isReporting ? renderQpScoreInput(m) : (
                                            <>
                                              {(canScore || organizerScore) && <button className="btn-report" onClick={() => { setQpReportingId(m.id); setQpScoreInputs(p => ({ ...p, [m.id]: initScoreInput(m) })); }}>{m.status === "CONFIRMED" ? "Edit" : "Score"}</button>}
                                              {isOrganizer && !["PLAYOFFS", "COMPLETED"].includes(qp.status) && <button className="btn-decline" style={{ fontSize: "0.72rem" }} onClick={() => onDeleteQpMatch(m.id)} disabled={loading}>🗑</button>}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                );
                              })}
                            </>
                          )}

                          {/* Playoffs */}
                          {playoffMatches.length > 0 && (
                            <div style={{ marginTop: 20 }}>
                              <div style={{ fontWeight: 700, color: "#fbbf24", fontSize: "0.8rem", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".04em" }}>🏆 Playoffs</div>
                              {[...new Set(playoffMatches.map(m => m.roundNumber))].sort((a, b) => a - b).map(rnd => (
                                <div key={rnd}>
                                  <div className="match-round-label">{rnd === 1 ? "Semi-finals" : rnd === 3 ? "🥉 3rd Place Match" : "Final"}</div>
                                  {playoffMatches.filter(m => m.roundNumber === rnd).map(m => {
                                    // Awaiting semi-final results: show placeholder with whoever is known
                                    const awaitingSemis = m.status === "AWAITING_SEMIS" || (m.team1Ids.length === 0 && m.team2Ids.length === 0);
                                    if (awaitingSemis) {
                                      const knownTeam = m.team1Ids.length > 0 ? `${qpName(m.team1Ids)} (seeded)` : null;
                                      return (
                                        <div key={m.id} className="match-row">
                                          <div className="match-teams">
                                            <span className="match-team-name" style={{ color: "var(--muted)" }}>
                                              {knownTeam ?? "Semi-final winner"} <span style={{ color: "var(--muted)", fontWeight: 400 }}>vs</span> Semi-final winner
                                            </span>
                                          </div>
                                          <div className="match-actions">
                                            <span className="badge badge-status-pending">Awaiting Semis</span>
                                          </div>
                                        </div>
                                      );
                                    }
                                    const isReporting = qpReportingId === m.id;
                                    return (
                                      <div key={m.id} className="match-row">
                                        <div className="match-teams">
                                          <span className="match-team-name">{qpName(m.team1Ids)}</span>
                                          <span className="match-vs">vs</span>
                                          <span className="match-team-name">{qpName(m.team2Ids)}</span>
                                        </div>
                                        {m.court && <span className="muted" style={{ fontSize: "0.72rem", marginRight: 4 }}>{m.court}</span>}
                                        {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && renderQpScore(m)}
                                        <div className="match-actions">
                                          <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Done" : "Scheduled"}</span>
                                          {isReporting ? renderQpScoreInput(m) : (
                                            (() => {
                                              const inMatch = m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id);
                                              const canScorePlayoff = isOrganizer || (inMatch && (qp.status === "PLAYOFFS" || qp.status === "ACTIVE"));
                                              return canScorePlayoff
                                                ? <button className="btn-report" onClick={() => { setQpReportingId(m.id); setQpScoreInputs(p => ({ ...p, [m.id]: initScoreInput(m) })); }}>{m.status === "CONFIRMED" ? "Edit" : "Score"}</button>
                                                : null;
                                            })()
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Standings tab */}
                  {qpDetailTab === "standings" && (
                    <div className="glass-card">
                      <h3 className="card-title">Standings</h3>
                      {qpStandings.length === 0 ? (
                        <p className="empty-state">No results yet — score some games first.</p>
                      ) : (
                        <table className="standings-table">
                          <thead>
                            <tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Pts For</th><th>Pts Against</th></tr>
                          </thead>
                          <tbody>
                            {qpStandings.map((row, i) => (
                              <tr key={row.playerId}>
                                <td className={`rank-cell rank-${i + 1}`}>{i + 1}</td>
                                <td className="entity-name">{row.playerName}</td>
                                <td>{row.wins}</td>
                                <td>{row.losses}</td>
                                <td style={{ fontWeight: 700, color: "var(--pink)" }}>{row.pointsFor}</td>
                                <td className="muted">{row.pointsAgainst}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              );
            })() : (
              /* ── Quick Play list ── */
              <>
                <div className="page-header">
                  <h2>Quick Play</h2>
                  <p className="muted">Rec play sessions — round robin, schedule, score, playoffs.</p>
                </div>
                <div className="content-grid">
                  {/* Create session form */}
                  <div className="glass-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <h3 className="card-title" style={{ margin: 0 }}>Create Session</h3>
                      <button type="button" className="create-toggle-btn"
                        onClick={() => setShowCreateSession(v => !v)}>
                        {showCreateSession ? "✕ Cancel" : "+ New"}
                      </button>
                    </div>
                    <form onSubmit={onCreateQpSession} className={`stack-form create-session-form${showCreateSession ? " open" : ""}`}>
                      <div className="field">
                        <label>Session Name</label>
                        <input placeholder="e.g. Sunday Rec Play" value={qpForm.name} onChange={e => setQpForm({ ...qpForm, name: e.target.value })} />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Format</label>
                          <select value={qpForm.format} onChange={e => setQpForm({ ...qpForm, format: e.target.value as "SINGLES" | "ROUND_ROBIN" })}>
                            <option value="SINGLES">Singles</option>
                            <option value="ROUND_ROBIN">Round Robin (Doubles)</option>
                          </select>
                        </div>
                        {qpForm.format === "ROUND_ROBIN" && (
                          <div className="field">
                            <label>Partner Mode</label>
                            <select value={qpForm.rrType} onChange={e => setQpForm({ ...qpForm, rrType: e.target.value as "SET" | "SWITCH" })}>
                              <option value="SET">Set Partners (fixed)</option>
                              <option value="SWITCH">Switch Partners (rotate)</option>
                            </select>
                          </div>
                        )}
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Number of Courts</label>
                          <input type="number" min="1" max="20" placeholder="2" value={qpForm.courtCount} onChange={e => setQpForm({ ...qpForm, courtCount: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Court Names (optional)</label>
                          <input placeholder="Court 1, Court 2, …" value={qpForm.courtLabels} onChange={e => setQpForm({ ...qpForm, courtLabels: e.target.value })} />
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Sets Per Game</label>
                          <select value={qpForm.setsPerMatch} onChange={e => setQpForm({ ...qpForm, setsPerMatch: e.target.value })}>
                            <option value="1">Best of 1</option>
                            <option value="3">Best of 3</option>
                            <option value="5">Best of 5</option>
                          </select>
                        </div>
                        {qpForm.format === "ROUND_ROBIN" && qpForm.rrType === "SWITCH" && (
                          <div className="field">
                            <label>Max Matches/Player</label>
                            <input type="number" min="1" placeholder="Auto (all)" value={qpForm.matchesPerPlayer} onChange={e => setQpForm({ ...qpForm, matchesPerPlayer: e.target.value })} />
                            <span className="muted" style={{ fontSize: "0.7rem", marginTop: 2 }}>Leave blank for full round-robin</span>
                          </div>
                        )}
                      </div>

                      {/* Include self */}
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
                        <input type="checkbox" checked={qpForm.includeSelf} onChange={e => setQpForm({ ...qpForm, includeSelf: e.target.checked })} style={{ accentColor: "var(--pink)", width: 16, height: 16 }} />
                        Include yourself as a player
                        {qpForm.includeSelf && <span className="div-label-chip" style={{ marginLeft: 4 }}>{user.name}</span>}
                      </label>

                      {/* Player search (registered users) */}
                      <div className="field">
                        <label>Add Registered Players</label>
                        <div className="search-wrap">
                          <span className="search-icon">🔍</span>
                          <input className="search-input" placeholder="Search by name, email…" value={qpPlayerQuery}
                            onChange={e => setQpPlayerQuery(e.target.value)} autoComplete="off" />
                          {qpPlayerSearching && <span className="search-spinner">⟳</span>}
                        </div>
                        {qpPlayerQuery.trim().length >= 2 && (
                          <ul className="search-results" style={{ marginTop: 6 }}>
                            {qpPlayerResults.length === 0 && !qpPlayerSearching && <li className="search-no-results">No players found.</li>}
                            {qpPlayerResults.filter(u => !qpSelectedPlayers.some(p => p.id === u.id) && u.id !== user.id).map(u => (
                              <li key={u.id} className="search-result-row">
                                <Avatar name={u.name} />
                                <div className="search-result-info"><div className="entity-name">{u.name}</div><div className="entity-sub">{u.email || u.phone}</div></div>
                                <button className="btn-add-icon" onClick={() => { setQpSelectedPlayers(p => [...p, u]); setQpPlayerQuery(""); setQpPlayerResults([]); }}>+</button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {qpSelectedPlayers.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {qpSelectedPlayers.map(p => (
                              <span key={p.id} className="div-label-chip" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                {p.name}
                                <button style={{ all: "unset", cursor: "pointer", color: "var(--muted)" }} onClick={() => setQpSelectedPlayers(prev => prev.filter(x => x.id !== p.id))}>×</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Guest players (name only) */}
                      <div className="field">
                        <label>Guest Players (comma-separated names)</label>
                        <input placeholder="Alice, Bob, Carol…" value={qpGuestInput} onChange={e => setQpGuestInput(e.target.value)} />
                        <span className="muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>No account needed — just a name.</span>
                      </div>

                      <button type="submit" className="btn-primary" disabled={loading}>Create Session</button>
                    </form>
                  </div>

                  {/* Session list */}
                  <div className="glass-card">
                    <h3 className="card-title">Sessions <span className="count-badge">{qpSessions.length}</span></h3>
                    {qpSessions.length === 0
                      ? <p className="empty-state">No sessions yet — create one!</p>
                      : (() => {
                          const mySessions = qpSessions.filter(s => s.createdBy === user.id || s.playerIds.includes(user.id));
                          const otherSessions = qpSessions.filter(s => s.createdBy !== user.id && !s.playerIds.includes(user.id));
                          const renderSession = (s: QpSession) => (
                            <li key={s.id} className="clickable-row" onClick={() => selectQpSession(s.id)}>
                              <div className="entity-icon games-icon"><img src={gameIcon} alt="" /></div>
                              <div style={{ flex: 1 }}>
                                <div className="entity-name">{s.name}</div>
                                <div className="entity-sub">
                                  {s.format === "SINGLES" ? "Singles" : `Doubles ${s.rrType}`} · {s.courtCount} court{s.courtCount !== 1 ? "s" : ""} · {s.playerIds.length + s.guestNames.length} players
                                </div>
                              </div>
                              {s.createdBy === user.id
                                ? <span className="badge badge-rr" style={{ fontSize: "0.58rem" }}>Organizer</span>
                                : s.playerIds.includes(user.id)
                                  ? <span className="badge badge-status-active" style={{ fontSize: "0.58rem" }}>Playing</span>
                                  : null}
                              <span className={`badge ${s.status === "COMPLETED" ? "badge-closed" : s.status === "ACTIVE" || s.status === "PLAYOFFS" ? "badge-status-active" : "badge-status-pending"}`} style={{ fontSize: "0.62rem" }}>{s.status}</span>
                              <span className="entity-chevron">›</span>
                            </li>
                          );
                          return (
                            <>
                              {mySessions.length > 0 && (
                                <>
                                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>My Sessions</div>
                                  <ul className="entity-list" style={{ marginBottom: otherSessions.length > 0 ? 16 : 0 }}>
                                    {mySessions.map(renderSession)}
                                  </ul>
                                </>
                              )}
                              {otherSessions.length > 0 && (
                                <>
                                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 }}>Other Sessions</div>
                                  <ul className="entity-list">
                                    {otherSessions.map(renderSession)}
                                  </ul>
                                </>
                              )}
                            </>
                          );
                        })()
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TOURNAMENTS ── */}
        {activeTab === "tournaments" && (
          <div className="tab-panel fade-in">
            {selectedTournament ? (
              /* ── Tournament detail ── */
              (() => {
                const t = selectedTournament;
                const isOrganizer = user.id === t.createdBy;
                const myReg = t.registrations.find(r => r.playerId === user.id || r.partnerId === user.id);
                const confirmedRegs = t.registrations.filter(r => r.status === "CONFIRMED");
                const confirmedMatches = t.matches.filter(m => m.status === "CONFIRMED");
                const formatLabel = t.format === "ROUND_ROBIN" ? "Round Robin" : t.format === "DOUBLE_ELIMINATION" ? "Double Elim." : "Waterfall";
                const formatCls = t.format === "ROUND_ROBIN" ? "badge-rr" : t.format === "DOUBLE_ELIMINATION" ? "badge-de" : "badge-wf";
                const tournamentClub = t.clubId ? clubs.find(c => c.id === t.clubId) : null;
                const isClubMember = !t.clubId || clubs.find(c => c.id === t.clubId)?.memberIds.includes(user.id);

                function tn(ids: string[]) {
                  const reg = t.registrations.find(r =>
                    (r.playerId === ids[0] && (ids.length < 2 || r.partnerId === ids[1])) ||
                    (ids.length > 1 && r.playerId === ids[1] && r.partnerId === ids[0])
                  );
                  if (reg?.teamName) return reg.teamName;
                  return ids.map(id => {
                    const r = t.registrations.find(r => r.playerId === id || r.partnerId === id);
                    if (!r) return id.slice(-4);
                    return r.playerId === id ? r.playerName : (r.partnerName ?? id.slice(-4));
                  }).join(" & ");
                }

                return (
                  <>
                    <button className="btn-back" onClick={() => setSelectedTournament(null)}>← All Tournaments</button>

                    <div className="glass-card tourney-header">
                      <div className="tourney-header-top">
                        <div>
                          <h2 className="tourney-name">{t.name}</h2>
                          <div className="tourney-meta">
                            <span className={`badge ${formatCls}`}>{formatLabel}</span>
                            {(t.events.length > 0
                              ? [...new Set(t.events.map(e => e.eventType))]
                              : t.eventType.split(",").map(s => s.trim())
                            ).map(et => (
                              <span key={et} className="tourney-meta-item">🏓 {etLabel(et)}</span>
                            ))}
                            {t.skillLevel && <span className="tourney-meta-item">⭐ {t.skillLevel}</span>}
                            {t.ageBracket && t.ageBracket !== "OPEN" && <span className="tourney-meta-item">👤 {t.ageBracket}</span>}
                            {t.location && <span className="tourney-meta-item">📍 {t.location}</span>}
                            {t.startDate && <span className="tourney-meta-item">📅 {t.startDate}{(t as any).endDate && (t as any).endDate !== t.startDate ? ` – ${(t as any).endDate}` : ""}</span>}
                          </div>
                        </div>
                        <div className="tourney-header-actions">
                          <span className={`badge ${t.status === "CANCELLED" ? "badge-cancelled" : t.status === "CLOSED" ? "badge-closed" : `badge-status-${t.status.toLowerCase()}`}`}>{t.status}</span>
                          {t.isDuprReported && <span className="badge" style={{ background: "rgba(236,72,153,0.18)", border: "1px solid rgba(236,72,153,0.4)", color: "#f472b6", fontSize: "0.62rem" }}>DUPR</span>}
                          {tournamentClub && <span className="badge badge-de" title={`Club: ${tournamentClub.name}`}>🏢 {tournamentClub.name}</span>}
                          {!myReg && t.status === "PLANNED" && (
                            isClubMember
                              ? t.events.length > 0
                                ? <button className="btn-join" onClick={() => setTourneyDetailTab("overview")}>Register →</button>
                                : <button className="btn-join" disabled={loading} onClick={() => onRegisterForTournament(t.id)}>Register</button>
                              : <span className="badge badge-de" title={`Members of ${tournamentClub?.name ?? "the club"} only`}>Members Only</span>
                          )}
                          {myReg && !["CANCELLED", "CLOSED"].includes(t.status) && <span className="badge badge-status-active">Registered ✓</span>}
                        </div>
                      </div>
                      <div className="tourney-stats-row">
                        <span>{confirmedRegs.length} team{confirmedRegs.length !== 1 ? "s" : ""} registered</span>
                        <span>{confirmedMatches.length} / {t.matches.length} matches confirmed</span>
                        {t.maxTeams && <span>Max {t.maxTeams} teams</span>}
                      </div>
                    </div>

                    {/* Cancelled banner */}
                    {t.status === "CANCELLED" && (
                      <div className="glass-card" style={{ borderColor: "rgba(239,68,68,.35)", background: "rgba(239,68,68,.06)", marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 6 }}>Tournament Cancelled</div>
                        <div style={{ fontSize: "0.875rem", color: "var(--muted)" }}>{t.cancelledReason}</div>
                        {t.cancelledAt && <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: 4 }}>{new Date(t.cancelledAt).toLocaleString()}</div>}
                      </div>
                    )}

                    {/* Closed / winners banner */}
                    {t.status === "CLOSED" && t.placements.length > 0 && (
                      <div className="glass-card" style={{ borderColor: "rgba(251,191,36,.35)", background: "rgba(251,191,36,.06)", marginBottom: 4 }}>
                        <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: 10 }}>Tournament Results</div>
                        {t.placements.map(p => {
                          const names = p.playerIds.map(id => {
                            const reg = t.registrations.find(r => r.playerId === id || r.partnerId === id);
                            if (!reg) return id.slice(-4);
                            return reg.playerId === id ? reg.playerName : (reg.partnerName ?? id.slice(-4));
                          }).join(" & ");
                          return (
                            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                              <span style={{ fontSize: "1.1rem", minWidth: 28 }}>{p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : p.position === 3 ? "🥉" : `#${p.position}`}</span>
                              <span style={{ fontWeight: 600 }}>{names}</span>
                              {p.note && <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>— {p.note}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Organizer panel */}
                    {isOrganizer && !["CANCELLED", "CLOSED"].includes(t.status) && (
                      <div className="organizer-panel">
                        <div className="organizer-panel-title">⚙ Organizer Controls</div>
                        <div className="organizer-controls">
                          <button className="btn-sm" style={{ background: "rgba(124,107,255,.18)", border: "1px solid rgba(124,107,255,.35)", color: "var(--accent)" }} onClick={() => {
                            setEditTourneyInput({ name: t.name, location: t.location ?? "", startDate: t.startDate ?? "", endDate: t.endDate ?? "", registrationStartDate: t.registrationStartDate ?? "", registrationEndDate: t.registrationEndDate ?? "", withdrawDeadline: t.withdrawDeadline ?? "", description: t.description ?? "", maxTeams: t.maxTeams?.toString() ?? "", isDuprReported: t.isDuprReported ?? false });
                            setShowEditTourney(v => !v);
                          }}>✏ Edit Details</button>
                          {t.events.length === 0 && (t.status === "PLANNED" || t.status === "ACTIVE") && confirmedRegs.length >= 2 && (
                            <button className="btn-sm btn-sm-generate" disabled={loading} onClick={() => onGenerateSchedule(t.id)}>
                              🎲 Generate Schedule ({confirmedRegs.length} teams)
                            </button>
                          )}
                          {t.status !== "ACTIVE" && t.matches.length > 0 && (
                            <button className="btn-sm btn-sm-active" disabled={loading} onClick={() => onUpdateTournamentStatus("ACTIVE")}>Set Active</button>
                          )}
                          {t.status === "ACTIVE" && (
                            <button className="btn-sm btn-sm-complete" disabled={loading} onClick={() => onUpdateTournamentStatus("COMPLETED")}>Mark Completed</button>
                          )}
                          {/* Close tournament */}
                          {(t.status === "ACTIVE" || t.status === "COMPLETED") && (
                            <button className="btn-sm" style={{ background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.35)", color: "#fbbf24" }} disabled={loading} onClick={() => { setShowCloseForm(v => !v); setShowCancelForm(false); }}>
                              🏆 Close & Declare Winners
                            </button>
                          )}
                          {/* Close Registration — always available while tournament is open */}
                          {!t.registrationClosed && (
                            <button className="btn-sm" style={{ background: "rgba(251,191,36,.15)", border: "1px solid rgba(251,191,36,.35)", color: "#fbbf24" }}
                              disabled={loading}
                              onClick={() => withError(async () => {
                                await api.updateTournamentDetails(t.id, { organizerId: user.id, registrationClosed: true });
                                await selectTournament(t.id);
                              })}>
                              🔒 Close Registration
                            </button>
                          )}
                          {/* Open Registration — only when closed AND no division winners declared yet */}
                          {t.registrationClosed && t.placements.length === 0 && !["COMPLETED", "CLOSED"].includes(t.status) && (
                            <button className="btn-sm" style={{ background: "rgba(34,197,94,.15)", border: "1px solid rgba(34,197,94,.35)", color: "#4ade80" }}
                              disabled={loading}
                              onClick={() => withError(async () => {
                                await api.updateTournamentDetails(t.id, { organizerId: user.id, registrationClosed: false });
                                await selectTournament(t.id);
                              })}>
                              🔓 Open Registration
                            </button>
                          )}
                          {/* Register Player */}
                          <button className="btn-sm" style={{ background: "rgba(124,107,255,.18)", border: "1px solid rgba(124,107,255,.35)", color: "#b8acff" }}
                            onClick={() => { setShowOrgRegPanel(p => !p); setOrgRegTarget(null); setOrgRegQuery(""); setOrgRegResults([]); setOrgRegEventIds([]); setOrgRegAgeExpanded({}); }}>
                            👤 {showOrgRegPanel ? "Close" : "Register Player"}
                          </button>
                          {/* Cancel tournament */}
                          <button className="btn-sm" style={{ background: "rgba(239,68,68,.15)", border: "1px solid rgba(239,68,68,.3)", color: "#f87171" }} disabled={loading} onClick={() => { setShowCancelForm(v => !v); setShowCloseForm(false); }}>
                            ✕ Cancel Tournament
                          </button>
                        </div>

                        {/* Inline register-player form */}
                        {showOrgRegPanel && (
                          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 10, paddingTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "var(--accent)" }}>Register a Player</div>

                            {/* Step 1: Search */}
                            {!orgRegTarget ? (
                              <>
                                <div className="search-wrap">
                                  <span className="search-icon">🔍</span>
                                  <input className="search-input" placeholder="Search player by name / email…" value={orgRegQuery}
                                    onChange={e => setOrgRegQuery(e.target.value)} autoFocus autoComplete="off" />
                                  {orgRegSearching && <span className="search-spinner">⟳</span>}
                                </div>
                                {orgRegQuery.trim().length >= 2 && (
                                  <ul className="search-results">
                                    {orgRegResults.length === 0 && !orgRegSearching && <li className="search-no-results">No players found.</li>}
                                    {orgRegResults.map(u => (
                                      <li key={u.id} className="search-result-row">
                                        <Avatar name={u.name} />
                                        <div className="search-result-info">
                                          <div className="entity-name">{u.name}</div>
                                          <div className="entity-sub">{u.email || u.phone}</div>
                                        </div>
                                        <button className="btn-add-icon" onClick={() => { setOrgRegTarget(u); setOrgRegQuery(""); setOrgRegResults([]); setOrgDuprId(u.duprId ?? ""); setOrgRegEventIds([]); setOrgRegAgeExpanded({}); }}>+</button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            ) : (() => {
                              // Match by ID (primary), email, or phone — handles duplicate accounts for the same person
                              const targetEmail = orgRegTarget.email?.toLowerCase();
                              const targetPhone = orgRegTarget.phone;
                              const existingRegs = t.registrations.filter(r =>
                                r.playerId === orgRegTarget.id ||
                                r.partnerId === orgRegTarget.id ||
                                (targetEmail && r.playerEmail?.toLowerCase() === targetEmail) ||
                                (targetPhone && r.playerPhone === targetPhone)
                              );
                              // Only block events where there's a real event ID on the registration
                              const alreadyRegEventIds = new Set(
                                existingRegs.map(r => r.tournamentEventId).filter((id): id is string => !!id)
                              );

                              // Gender blocking based on both existing and newly selected events
                              const orgActiveTypes = new Set<string>();
                              orgRegEventIds.forEach(id => { const ev = t.events.find(e => e.id === id); if (ev) orgActiveTypes.add(ev.eventType); });
                              existingRegs.forEach(r => { const ev = t.events.find(e => e.id === r.tournamentEventId); if (ev) orgActiveTypes.add(ev.eventType); });
                              const orgGenderBlocked = new Set<string>();
                              if ([...orgActiveTypes].some(et => et.startsWith("MEN_")))   { orgGenderBlocked.add("WOMEN_SINGLES"); orgGenderBlocked.add("WOMEN_DOUBLES"); }
                              if ([...orgActiveTypes].some(et => et.startsWith("WOMEN_"))) { orgGenderBlocked.add("MEN_SINGLES");   orgGenderBlocked.add("MEN_DOUBLES");   }

                              const categories = [
                                { label: "Singles",       types: ["MEN_SINGLES", "WOMEN_SINGLES"] },
                                { label: "Doubles",       types: ["MEN_DOUBLES", "WOMEN_DOUBLES"] },
                                { label: "Mixed Doubles", types: ["MIXED_DOUBLES"] },
                              ];

                              // Available events = events not yet registered for
                              const availableEvents = t.events.filter(e => !alreadyRegEventIds.has(e.id));

                              return (
                                <>
                                  {/* Selected player chip */}
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "rgba(124,107,255,.1)", border: "1px solid rgba(124,107,255,.3)", borderRadius: 10 }}>
                                    <Avatar name={orgRegTarget.name} size={30} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div className="entity-name">{orgRegTarget.name}</div>
                                      {(orgRegTarget.email || orgRegTarget.phone) && <div className="entity-sub" style={{ fontSize: "0.7rem" }}>{orgRegTarget.email || orgRegTarget.phone}</div>}
                                    </div>
                                    <button className="btn-add-icon" style={{ background: "rgba(248,113,113,.25)", flexShrink: 0 }}
                                      onClick={() => { setOrgRegTarget(null); setOrgRegQuery(""); setOrgDuprId(""); setOrgDuprRatings({}); setOrgRegEventIds([]); setOrgRegAgeExpanded({}); setOrgDivPartners({}); setOrgPartnerAssignEventId(null); setOrgPartnerQuery(""); setOrgPartnerResults([]); setOrgDivTeamNames({}); }}>×</button>
                                  </div>

                                  {/* Division picker — all events grouped by category, mirrors self-registration */}
                                  {t.events.length === 0 ? (
                                    <p className="entity-sub" style={{ fontSize: "0.78rem" }}>No divisions configured for this tournament.</p>
                                  ) : (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                      {categories.map(({ label, types }) => {
                                        const catEvents = t.events.filter(e => types.includes(e.eventType));
                                        if (catEvents.length === 0) return null;
                                        return (
                                          <div key={label} style={{ marginBottom: 16 }}>
                                            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{label}</div>
                                            {types.map(evType => {
                                              const typeEvents = catEvents.filter(e => e.eventType === evType);
                                              if (typeEvents.length === 0) return null;
                                              const isGenderBlocked = orgGenderBlocked.has(evType);
                                              const allAges = [...new Set(typeEvents.map(e => e.ageBracket))];
                                              const expandedAges = orgRegAgeExpanded[evType] ?? [];
                                              const isDoubles = isDoublesEvent(evType);
                                              function canToggleOrgAge(age: string): boolean {
                                                const curr = orgRegAgeExpanded[evType] ?? [];
                                                if (curr.includes(age)) return true;
                                                const next = [...curr, age];
                                                if (next.includes("SENIOR") && next.includes("YOUNG")) return false;
                                                if (next.length > 2) return false;
                                                return true;
                                              }
                                              return (
                                                <div key={evType} style={{ marginBottom: 14, paddingLeft: 4, opacity: isGenderBlocked ? 0.4 : 1, pointerEvents: isGenderBlocked ? "none" : undefined }}>
                                                  {types.length > 1 && (
                                                    <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                                      {etLabel(evType)}
                                                      {isGenderBlocked && <span style={{ fontSize: "0.62rem", color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 4, padding: "1px 5px" }}>gender conflict</span>}
                                                    </div>
                                                  )}
                                                  {/* Already-registered rows for this event type */}
                                                  {typeEvents.map(ev => {
                                                    const myReg = existingRegs.find(r => r.tournamentEventId === ev.id && r.playerId === orgRegTarget.id);
                                                    const asPartnerReg = !myReg ? existingRegs.find(r => r.tournamentEventId === ev.id && r.partnerId === orgRegTarget.id) : null;
                                                    if (!myReg && !asPartnerReg) return null;
                                                    const reg = myReg ?? asPartnerReg!;
                                                    return (
                                                      <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "5px 8px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 7 }}>
                                                        <span style={{ fontSize: "0.75rem", color: "#4ade80", flex: 1 }}>
                                                          {asPartnerReg
                                                            ? `✓ Enrolled as partner — ${ev.skillLevel} · ${abLabel(ev.ageBracket)} (w/ ${asPartnerReg.playerName})`
                                                            : `✓ Registered — ${ev.skillLevel} · ${abLabel(ev.ageBracket)}${myReg!.partnerName ? ` (w/ ${myReg!.partnerName})` : ""}`
                                                          }
                                                        </span>
                                                        {myReg && (
                                                          <button className="btn-sm" style={{ fontSize: "0.68rem", background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.35)", color: "#f87171", padding: "2px 8px" }}
                                                            disabled={loading} onClick={() => onOrgWithdrawRegistration(t.id, reg.id)}>
                                                            Withdraw
                                                          </button>
                                                        )}
                                                      </div>
                                                    );
                                                  })}
                                                  {/* Age bracket picker */}
                                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", minWidth: 72 }}>Age Group:</span>
                                                    {allAges.map(age => {
                                                      const isExpanded = expandedAges.includes(age);
                                                      const alreadyInAge = existingRegs.some(r => typeEvents.some(e => e.id === r.tournamentEventId && e.ageBracket === age));
                                                      const ok = canToggleOrgAge(age);
                                                      return (
                                                        <button key={age} type="button"
                                                          disabled={isGenderBlocked || alreadyInAge || (!ok && !isExpanded)}
                                                          className={`event-type-chip${isExpanded ? " active" : ""}${alreadyInAge ? " disabled" : ""}`}
                                                          style={{ opacity: (!ok && !isExpanded) ? 0.4 : 1 }}
                                                          onClick={() => {
                                                            if (alreadyInAge || isGenderBlocked || !canToggleOrgAge(age)) return;
                                                            setOrgRegAgeExpanded(prev => {
                                                              const curr = prev[evType] ?? [];
                                                              if (curr.includes(age)) {
                                                                setOrgRegEventIds(ids => ids.filter(id => !typeEvents.filter(e => e.ageBracket === age).map(e => e.id).includes(id)));
                                                                setOrgDivPartners(p => { const n = { ...p }; typeEvents.filter(e => e.ageBracket === age).forEach(e => delete n[e.id]); return n; });
                                                                return { ...prev, [evType]: curr.filter(a => a !== age) };
                                                              }
                                                              return { ...prev, [evType]: [...curr, age] };
                                                            });
                                                          }}>
                                                          {abLabel(age)}
                                                          {alreadyInAge && <span style={{ marginLeft: 3, color: "#4ade80" }}>✓</span>}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                  {/* Skill level picker for expanded ages */}
                                                  {expandedAges.map(age => {
                                                    const ageEvents = typeEvents.filter(e => e.ageBracket === age);
                                                    const alreadyRegInTypeAge = existingRegs.some(r => ageEvents.some(e => e.id === r.tournamentEventId));
                                                    return (
                                                      <div key={age} style={{ marginLeft: 8, marginBottom: 10, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                          <span style={{ fontSize: "0.75rem", color: "var(--muted)", minWidth: 110 }}>{abLabel(age)} — Skill:</span>
                                                          {ageEvents.map(ev => {
                                                            const isSel = orgRegEventIds.includes(ev.id);
                                                            const isAlreadyReg = existingRegs.some(r => r.tournamentEventId === ev.id);
                                                            const isBlockedBySkill = alreadyRegInTypeAge && !isAlreadyReg;
                                                            return (
                                                              <button key={ev.id} type="button"
                                                                disabled={isBlockedBySkill || isAlreadyReg}
                                                                className={`event-type-chip${(isSel || isAlreadyReg) ? " active" : ""}`}
                                                                style={{ minWidth: 44, opacity: isBlockedBySkill ? 0.4 : 1 }}
                                                                onClick={() => {
                                                                  if (isBlockedBySkill || isAlreadyReg) return;
                                                                  setOrgRegEventIds(prev => {
                                                                    const withoutSlot = prev.filter(id => !ageEvents.some(e => e.id === id));
                                                                    if (prev.includes(ev.id)) {
                                                                      setOrgDivPartners(p => { const n = { ...p }; delete n[ev.id]; return n; });
                                                                      if (orgPartnerAssignEventId === ev.id) { setOrgPartnerAssignEventId(null); setOrgPartnerQuery(""); setOrgPartnerResults([]); }
                                                                      return withoutSlot;
                                                                    }
                                                                    return [...withoutSlot, ev.id];
                                                                  });
                                                                }}>
                                                                {ev.skillLevel}
                                                                {isAlreadyReg && <span style={{ marginLeft: 3, color: "#4ade80" }}>✓</span>}
                                                                {isSel && !isAlreadyReg && <span style={{ marginLeft: 3, color: "#e879f9" }}>●</span>}
                                                              </button>
                                                            );
                                                          })}
                                                        </div>
                                                        {/* Partner search for doubles */}
                                                        {isDoubles && (() => {
                                                          const selEv = ageEvents.find(e => orgRegEventIds.includes(e.id));
                                                          if (!selEv) return null;
                                                          const partner = orgDivPartners[selEv.id] ?? null;
                                                          const isAssigning = orgPartnerAssignEventId === selEv.id;
                                                          return (
                                                            <div style={{ marginTop: 8 }}>
                                                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                <span style={{ fontSize: "0.74rem", color: "var(--muted)" }}>Partner:</span>
                                                                {partner ? (
                                                                  <>
                                                                    <Avatar name={partner.name} size={20} />
                                                                    <span style={{ fontSize: "0.8rem", flex: 1 }}>{partner.name}</span>
                                                                    <button className="btn-add-icon" style={{ background: "rgba(255,80,80,.3)" }} onClick={() => setOrgDivPartners(p => ({ ...p, [selEv.id]: null }))}>×</button>
                                                                  </>
                                                                ) : (
                                                                  <button className="btn-sm" style={{ fontSize: "0.72rem" }} onClick={() => { setOrgPartnerAssignEventId(selEv.id); setOrgPartnerQuery(""); setOrgPartnerResults([]); }}>
                                                                    {isAssigning ? "Searching…" : "+ Add Partner (optional)"}
                                                                  </button>
                                                                )}
                                                              </div>
                                                              {partner && (
                                                                <div style={{ marginTop: 6 }}>
                                                                  <input
                                                                    placeholder="Team name (optional, must be unique)"
                                                                    value={orgDivTeamNames[selEv.id] ?? ""}
                                                                    onChange={e => setOrgDivTeamNames(p => ({ ...p, [selEv.id]: e.target.value }))}
                                                                    style={{ fontSize: "0.8rem", width: "100%" }}
                                                                  />
                                                                </div>
                                                              )}
                                                              {isAssigning && (
                                                                <div style={{ marginTop: 6 }}>
                                                                  <div className="search-wrap">
                                                                    <span className="search-icon">🔍</span>
                                                                    <input className="search-input" placeholder="Search partner by name/email…" value={orgPartnerQuery}
                                                                      onChange={e => setOrgPartnerQuery(e.target.value)} autoFocus autoComplete="off" />
                                                                    {orgPartnerSearching && <span className="search-spinner">⟳</span>}
                                                                  </div>
                                                                  {orgPartnerQuery.trim().length >= 2 && (
                                                                    <ul className="search-results">
                                                                      {orgPartnerResults.length === 0 && !orgPartnerSearching && <li className="search-no-results">No players found.</li>}
                                                                      {orgPartnerResults.map(u => {
                                                                        // Collect every registration row that belongs to this person
                                                                        const personRegs = t.registrations.filter(r => {
                                                                          if (r.playerId === u.id || r.partnerId === u.id) return true;
                                                                          if (u.email && r.playerEmail && r.playerEmail.toLowerCase() === u.email.toLowerCase()) return true;
                                                                          if (u.phone && r.playerPhone && r.playerPhone === u.phone) return true;
                                                                          if (r.playerName.toLowerCase().trim() === u.name.toLowerCase().trim()) return true;
                                                                          if (r.partnerName && r.partnerName.toLowerCase().trim() === u.name.toLowerCase().trim()) return true;
                                                                          return false;
                                                                        });
                                                                        const alreadyInSlot = personRegs.some(r => {
                                                                          if (!r.tournamentEventId) return true; // legacy: block on identity alone
                                                                          const regEv = t.events.find(e => e.id === r.tournamentEventId);
                                                                          if (!regEv) return true;
                                                                          return evCategory(regEv.eventType) === evCategory(selEv.eventType) && regEv.ageBracket === selEv.ageBracket;
                                                                        });
                                                                        return (
                                                                          <li key={u.id} className="search-result-row" style={{ opacity: alreadyInSlot ? 0.55 : 1 }}>
                                                                            <Avatar name={u.name} />
                                                                            <div className="search-result-info">
                                                                              <div className="entity-name">{u.name}</div>
                                                                              <div className="entity-sub">{alreadyInSlot ? `Already in a ${etLabel(selEv.eventType)} · ${abLabel(selEv.ageBracket)} division` : (u.email || u.phone)}</div>
                                                                            </div>
                                                                            <button className="btn-add-icon" disabled={alreadyInSlot}
                                                                              style={{ opacity: alreadyInSlot ? 0.4 : 1, cursor: alreadyInSlot ? "not-allowed" : undefined }}
                                                                              onClick={() => { if (alreadyInSlot) return; setOrgDivPartners(p => ({ ...p, [selEv.id]: u })); setOrgPartnerAssignEventId(null); setOrgPartnerQuery(""); setOrgPartnerResults([]); }}>+</button>
                                                                          </li>
                                                                        );
                                                                      })}
                                                                    </ul>
                                                                  )}
                                                                  <button className="btn-sm" style={{ fontSize: "0.72rem", marginTop: 4, background: "rgba(255,80,80,.2)" }} onClick={() => { setOrgPartnerAssignEventId(null); setOrgPartnerQuery(""); setOrgPartnerResults([]); }}>Cancel</button>
                                                                </div>
                                                              )}
                                                            </div>
                                                          );
                                                        })()}
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* DUPR fields */}
                                  {t.isDuprReported && orgRegEventIds.length > 0 && (() => {
                                    function evCatLabel(evId: string) {
                                      const ev = t.events.find(e => e.id === evId);
                                      if (!ev) return null;
                                      if (ev.eventType === "MIXED_DOUBLES") return "Mixed Doubles";
                                      if (ev.eventType.includes("DOUBLES")) return "Doubles";
                                      return "Singles";
                                    }
                                    const cats = [...new Set(orgRegEventIds.map(evCatLabel).filter(Boolean) as string[])];
                                    return (
                                      <div style={{ padding: "10px 12px", background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)", borderRadius: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#f472b6", textTransform: "uppercase", letterSpacing: "0.05em" }}>DUPR Info <span style={{ color: "#f87171" }}>*</span></div>
                                        <div className="field" style={{ margin: 0 }}>
                                          <label style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 3 }}>DUPR ID</label>
                                          <input value={orgDuprId} onChange={e => setOrgDuprId(e.target.value)} placeholder="Player's DUPR ID" style={{ fontSize: "0.82rem" }} />
                                        </div>
                                        {cats.map(cat => (
                                          <div key={cat} className="field" style={{ margin: 0 }}>
                                            <label style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 3 }}>{cat} DUPR Rating <span style={{ color: "#f87171" }}>*</span></label>
                                            <input type="number" min="0" max="8" step="0.01"
                                              value={orgDuprRatings[cat] ?? ""}
                                              onChange={e => setOrgDuprRatings(p => ({ ...p, [cat]: e.target.value }))}
                                              placeholder="e.g. 3.50" style={{ fontSize: "0.82rem" }} />
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}

                                  {/* Register button */}
                                  {orgRegEventIds.length > 0 && (
                                    <button className="btn-sm btn-sm-active" style={{ alignSelf: "flex-end" }}
                                      disabled={loading}
                                      onClick={() => onOrgRegisterPlayer(t.id, t)}>
                                      Register ({orgRegEventIds.length} div{orgRegEventIds.length !== 1 ? "s" : ""})
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {/* Edit details form */}
                        {showEditTourney && (
                          <div style={{ marginTop: 16, borderTop: "1px solid rgba(124,107,255,.2)", paddingTop: 14 }}>
                            <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 10, fontSize: "0.85rem" }}>Edit Tournament Details</div>
                            <div className="field-row">
                              <div className="field">
                                <label>Name</label>
                                <input value={editTourneyInput.name} onChange={e => setEditTourneyInput(p => ({ ...p, name: e.target.value }))} placeholder="Tournament name" />
                              </div>
                              <div className="field">
                                <label>Location</label>
                                <input value={editTourneyInput.location} onChange={e => setEditTourneyInput(p => ({ ...p, location: e.target.value }))} placeholder="Venue / courts" />
                              </div>
                            </div>
                            <div className="field-row">
                              <div className="field">
                                <label>Start Date</label>
                                <input type="date" value={editTourneyInput.startDate} onChange={e => setEditTourneyInput(p => ({ ...p, startDate: e.target.value }))} />
                              </div>
                              <div className="field">
                                <label>End Date</label>
                                <input type="date" value={editTourneyInput.endDate} onChange={e => setEditTourneyInput(p => ({ ...p, endDate: e.target.value }))} />
                              </div>
                            </div>
                            <div className="field-row">
                              <div className="field">
                                <label>Reg. Opens</label>
                                <input type="date" value={editTourneyInput.registrationStartDate} onChange={e => setEditTourneyInput(p => ({ ...p, registrationStartDate: e.target.value }))} />
                              </div>
                              <div className="field">
                                <label>Reg. Closes</label>
                                <input type="date" value={editTourneyInput.registrationEndDate} onChange={e => setEditTourneyInput(p => ({ ...p, registrationEndDate: e.target.value }))} />
                              </div>
                              <div className="field">
                                <label>Withdraw Deadline</label>
                                <input type="date" value={editTourneyInput.withdrawDeadline} onChange={e => setEditTourneyInput(p => ({ ...p, withdrawDeadline: e.target.value }))} />
                              </div>
                            </div>
                            <div className="field-row">
                              <div className="field">
                                <label>Max Teams / Division</label>
                                <input type="number" min="2" value={editTourneyInput.maxTeams} onChange={e => setEditTourneyInput(p => ({ ...p, maxTeams: e.target.value }))} placeholder="e.g. 8" />
                              </div>
                              <div className="field">
                                <label>Description</label>
                                <input value={editTourneyInput.description} onChange={e => setEditTourneyInput(p => ({ ...p, description: e.target.value }))} placeholder="Optional details" />
                              </div>
                            </div>
                            <div className="field" style={{ marginTop: 4 }}>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.875rem" }}>
                                <input type="checkbox" checked={editTourneyInput.isDuprReported}
                                  onChange={e => setEditTourneyInput(p => ({ ...p, isDuprReported: e.target.checked }))}
                                  style={{ width: 16, height: 16, accentColor: "var(--pink)" }} />
                                DUPR Reported Tournament
                                <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 400 }}>(requires DUPR ID + rating on registration)</span>
                              </label>
                            </div>
                            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                              <button className="btn-primary" style={{ flex: 1 }} disabled={loading} onClick={() => onUpdateTourneyDetails(t.id)}>Save Changes</button>
                              <button className="btn-sm" disabled={loading} onClick={() => setShowEditTourney(false)}>Cancel</button>
                            </div>
                          </div>
                        )}

                        {/* Close form */}
                        {showCloseForm && (
                          <form onSubmit={onCloseTournament} className="stack-form" style={{ marginTop: 16, borderTop: "1px solid rgba(251,191,36,.2)", paddingTop: 14 }}>
                            <div style={{ fontWeight: 700, color: "#fbbf24", marginBottom: 10, fontSize: "0.85rem" }}>Declare Winners</div>
                            {placementInputs.map((p, i) => (
                              <div key={p.position} className="field-row" style={{ alignItems: "flex-end" }}>
                                <div className="field" style={{ minWidth: 110 }}>
                                  <label>{p.label}</label>
                                  <select
                                    value={p.teamRegId}
                                    onChange={e => setPlacementInputs(prev => prev.map((x, j) => j === i ? { ...x, teamRegId: e.target.value } : x))}
                                  >
                                    <option value="">— select team —</option>
                                    {confirmedRegs.map(r => (
                                      <option key={r.id} value={r.id}>
                                        {r.partnerId ? `${r.playerName} & ${r.partnerName ?? "?"}` : r.playerName}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="field">
                                  <label>Note (optional)</label>
                                  <input placeholder="e.g. Undefeated" value={p.note} onChange={e => setPlacementInputs(prev => prev.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />
                                </div>
                              </div>
                            ))}
                            <div style={{ display: "flex", gap: 8 }}>
                              <button type="submit" className="btn-sm" style={{ background: "rgba(251,191,36,.25)", border: "1px solid rgba(251,191,36,.4)", color: "#fbbf24" }} disabled={loading}>Close Tournament</button>
                              <button type="button" className="btn-sm" disabled={loading} onClick={() => setShowCloseForm(false)}>Cancel</button>
                            </div>
                          </form>
                        )}

                        {/* Cancel form */}
                        {showCancelForm && (
                          <form onSubmit={onCancelTournament} className="stack-form" style={{ marginTop: 16, borderTop: "1px solid rgba(239,68,68,.2)", paddingTop: 14 }}>
                            <div style={{ fontWeight: 700, color: "#f87171", marginBottom: 8, fontSize: "0.85rem" }}>Cancel Tournament</div>
                            <div className="field">
                              <label>Reason (required)</label>
                              <input placeholder="e.g. Venue unavailable, insufficient registrations…" value={cancelReason} onChange={e => setCancelReason(e.target.value)} autoFocus />
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button type="submit" className="btn-sm" style={{ background: "rgba(239,68,68,.2)", border: "1px solid rgba(239,68,68,.4)", color: "#f87171" }} disabled={loading || !cancelReason.trim()}>Confirm Cancellation</button>
                              <button type="button" className="btn-sm" disabled={loading} onClick={() => setShowCancelForm(false)}>Dismiss</button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Sub-tabs */}
                    <div className="sub-tab-bar">
                      {(["overview", "players", "divisions", "winners"] as const).map(tab => (
                        <button key={tab} className={`sub-tab-btn${tourneyDetailTab === tab ? " active" : ""}`} onClick={() => setTourneyDetailTab(tab)}>
                          {tab === "overview" ? "Register" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                          {tab === "players" && (() => {
                            const ids = new Set(t.registrations.map(r => r.playerId));
                            t.registrations.forEach(r => { if (r.partnerId && !ids.has(r.partnerId) && !t.registrations.some(x => x.playerId === r.partnerId)) ids.add(r.partnerId); });
                            return <span className="count-badge" style={{ marginLeft: 6 }}>{ids.size}</span>;
                          })()}
                          {tab === "divisions" && t.events.length > 0 && <span className="count-badge" style={{ marginLeft: 6 }}>{t.events.length}</span>}
                          {tab === "winners" && t.placements.filter(p => p.eventId).length > 0 && <span className="count-badge" style={{ marginLeft: 6 }}>✓</span>}
                        </button>
                      ))}
                    </div>

                    {/* Overview tab */}
                    {tourneyDetailTab === "overview" && (
                      <div className="content-grid">
                        <div className="glass-card">
                          <h3 className="card-title">Tournament Info</h3>
                          <div className="stack-form">
                            {t.description && <p style={{ fontSize: "0.875rem", color: "var(--muted)", lineHeight: 1.6 }}>{t.description}</p>}
                            <div className="entity-list" style={{ gap: 6 }}>
                              <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Format</span>
                                <span className="entity-name">{formatLabel}</span>
                              </li>
                              <li style={{ background: "none", border: "none", padding: "4px 0", alignItems: "flex-start" }}>
                                <span className="entity-sub" style={{ minWidth: 90, paddingTop: 2 }}>Events</span>
                                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                  {(t.events.length > 0
                                    ? [...new Set(t.events.map(e => e.eventType))]
                                    : t.eventType.split(",").map(s => s.trim())
                                  ).map(et => (
                                    <span key={et} className="entity-name">{etLabel(et)}</span>
                                  ))}
                                </div>
                              </li>
                              {t.skillLevel && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Skill Level</span>
                                <span className="entity-name">{t.skillLevel}</span>
                              </li>}
                              {t.ageBracket && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Age Bracket</span>
                                <span className="entity-name">{t.ageBracket}</span>
                              </li>}
                              {t.location && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Location</span>
                                <span className="entity-name">{t.location}</span>
                              </li>}
                              {(t.startDate || t.endDate) && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Tournament</span>
                                <span className="entity-name">
                                  {t.startDate}{t.endDate && t.endDate !== t.startDate ? ` – ${t.endDate}` : ""}
                                </span>
                              </li>}
                              {t.registrationStartDate && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Reg. Opens</span>
                                <span className="entity-name">{t.registrationStartDate}</span>
                              </li>}
                              {t.registrationEndDate && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Reg. Closes</span>
                                <span className="entity-name">{t.registrationEndDate}</span>
                              </li>}
                              {t.withdrawDeadline && <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Withdraw By</span>
                                <span className="entity-name" style={{ color: "#f59e0b" }}>{t.withdrawDeadline}</span>
                              </li>}
                              <li style={{ background: "none", border: "none", padding: "4px 0" }}>
                                <span className="entity-sub" style={{ minWidth: 90 }}>Registration</span>
                                <span className="entity-name" style={{ color: t.registrationClosed ? "#f59e0b" : "#4ade80" }}>
                                  {t.registrationClosed ? "🔒 Closed" : "🔓 Open"}
                                </span>
                              </li>
                            </div>
                          </div>
                        </div>

                        {/* Registration panel */}
                        {t.registrationClosed && !isOrganizer && (
                          <div className="glass-card">
                            <p className="entity-sub" style={{ color: "#f59e0b" }}>🔒 Registration is currently closed for this tournament.</p>
                          </div>
                        )}
                        {t.status === "PLANNED" && !["CANCELLED", "CLOSED"].includes(t.status) && !isClubMember && !t.registrationClosed && (
                          <div className="glass-card">
                            <p className="entity-sub">This tournament is only open to members of <strong>{tournamentClub?.name ?? "the linked club"}</strong>. Join the club first to register.</p>
                          </div>
                        )}
                        {t.status === "PLANNED" && !["CANCELLED", "CLOSED"].includes(t.status) && isClubMember && !t.registrationClosed && (() => {
                          // Multi-event: structured registration by category → age → skill
                          if (t.events.length > 0) {
                            const categoryGroups = [
                              { label: "Singles",       types: ["MEN_SINGLES", "WOMEN_SINGLES"] },
                              { label: "Doubles",       types: ["MEN_DOUBLES", "WOMEN_DOUBLES"] },
                              { label: "Mixed Doubles", types: ["MIXED_DOUBLES"] },
                            ];
                            // Age-bracket combination rules: SENIOR+YOUNG not allowed together
                            function canToggleAge(evType: string, age: string): boolean {
                              const curr = regAgeExpanded[evType] ?? [];
                              if (curr.includes(age)) return true; // deselect always allowed
                              const next = [...curr, age];
                              if (next.includes("SENIOR") && next.includes("YOUNG")) return false;
                              if (next.length > 2) return false;
                              return true;
                            }
                            const selectedEvObjs = t.events.filter(e => selectedEventIds.includes(e.id));
                            // Gender conflict: MEN_* and WOMEN_* are mutually exclusive (MIXED_DOUBLES always open)
                            const myRegTypes = new Set(
                              t.registrations
                                .filter(r => r.playerId === user.id && r.tournamentEventId)
                                .map(r => t.events.find(e => e.id === r.tournamentEventId)?.eventType)
                                .filter(Boolean) as string[]
                            );
                            selectedEvObjs.forEach(e => myRegTypes.add(e.eventType));
                            const genderBlockedTypes = new Set<string>();
                            if ([...myRegTypes].some(et => et.startsWith("MEN_"))) {
                              genderBlockedTypes.add("WOMEN_SINGLES"); genderBlockedTypes.add("WOMEN_DOUBLES");
                            }
                            if ([...myRegTypes].some(et => et.startsWith("WOMEN_"))) {
                              genderBlockedTypes.add("MEN_SINGLES"); genderBlockedTypes.add("MEN_DOUBLES");
                            }
                            return (
                              <div className="glass-card">
                                <h3 className="card-title">Register for Divisions</h3>
                                {categoryGroups.map(({ label, types }) => {
                                  const catEvents = t.events.filter(e => types.includes(e.eventType));
                                  if (catEvents.length === 0) return null;
                                  return (
                                    <div key={label} style={{ marginBottom: 20 }}>
                                      <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10, paddingBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{label}</div>
                                      {types.map(evType => {
                                        const typeEvents = catEvents.filter(e => e.eventType === evType);
                                        if (typeEvents.length === 0) return null;
                                        const isGenderBlocked = genderBlockedTypes.has(evType);
                                        const availAges = [...new Set(typeEvents.map(e => e.ageBracket))];
                                        const expandedAges = regAgeExpanded[evType] ?? [];
                                        const isDoubles = isDoublesEvent(evType);
                                        return (
                                          <div key={evType} style={{ marginBottom: 14, paddingLeft: 4, opacity: isGenderBlocked ? 0.4 : 1, pointerEvents: isGenderBlocked ? "none" : undefined }}>
                                            {types.length > 1 && (
                                              <div style={{ fontSize: "0.8rem", color: isGenderBlocked ? "var(--muted)" : "var(--muted)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                                                {etLabel(evType)}
                                                {isGenderBlocked && <span style={{ fontSize: "0.68rem", color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 4, padding: "1px 5px" }}>gender conflict</span>}
                                              </div>
                                            )}
                                            {!types.length || types.length === 1 ? isGenderBlocked && (
                                              <div style={{ fontSize: "0.72rem", color: "#f87171", marginBottom: 6 }}>Not available — gender conflict with current selection</div>
                                            ) : null}
                                            {/* Already-registered rows with withdraw */}
                                            {typeEvents.map(ev => {
                                              const myReg = t.registrations.find(r => r.playerId === user.id && r.tournamentEventId === ev.id);
                                              const asPartnerReg = !myReg ? t.registrations.find(r => r.partnerId === user.id && r.tournamentEventId === ev.id) : null;
                                              if (!myReg && !asPartnerReg) return null;
                                              if (asPartnerReg) {
                                                return (
                                                  <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "5px 8px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 7 }}>
                                                    <span style={{ fontSize: "0.75rem", color: "#4ade80", flex: 1 }}>
                                                      ✓ Enrolled as partner — {ev.skillLevel} · {abLabel(ev.ageBracket)} (w/ {asPartnerReg.playerName})
                                                    </span>
                                                  </div>
                                                );
                                              }
                                              const pastDeadline = t.withdrawDeadline ? new Date() > new Date(t.withdrawDeadline) : false;
                                              return (
                                                <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "5px 8px", background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 7 }}>
                                                  <span style={{ fontSize: "0.75rem", color: "#4ade80", flex: 1 }}>
                                                    ✓ Registered — {ev.skillLevel} · {abLabel(ev.ageBracket)}{myReg!.partnerName ? ` (w/ ${myReg!.partnerName})` : ""}
                                                  </span>
                                                  {!pastDeadline && t.status === "PLANNED" && (
                                                    <button className="btn-sm" style={{ fontSize: "0.68rem", background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.35)", color: "#f87171", padding: "2px 8px" }}
                                                      disabled={loading} onClick={() => onUnregister(t.id, myReg!.id)}>
                                                      Withdraw
                                                    </button>
                                                  )}
                                                  {pastDeadline && (
                                                    <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>Deadline passed</span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                            {/* Age bracket selection */}
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                              <span style={{ fontSize: "0.75rem", color: "var(--muted)", minWidth: 72 }}>Age Group:</span>
                                              {availAges.map(age => {
                                                const isExpanded = expandedAges.includes(age);
                                                const allowed = canToggleAge(evType, age);
                                                const alreadyInAge = t.registrations.some(r => (r.playerId === user.id || r.partnerId === user.id) && typeEvents.some(e => e.id === r.tournamentEventId && e.ageBracket === age));
                                                return (
                                                  <button key={age} type="button"
                                                    disabled={isGenderBlocked || (!allowed && !isExpanded)}
                                                    title={!allowed && !isExpanded ? "Can't combine Senior and Young age brackets" : undefined}
                                                    className={`event-type-chip${isExpanded ? " active" : ""}${alreadyInAge ? " disabled" : ""}`}
                                                    style={{ opacity: (!allowed && !isExpanded) ? 0.4 : 1 }}
                                                    onClick={() => {
                                                      if (alreadyInAge || isGenderBlocked) return;
                                                      if (!canToggleAge(evType, age)) return;
                                                      setRegAgeExpanded(prev => {
                                                        const curr = prev[evType] ?? [];
                                                        if (curr.includes(age)) {
                                                          // Collapse: remove selected events for this slot
                                                          setSelectedEventIds(ids => ids.filter(id => {
                                                            const ev = typeEvents.find(e => e.id === id);
                                                            return !(ev?.ageBracket === age);
                                                          }));
                                                          setDivPartners(p => {
                                                            const n = { ...p };
                                                            typeEvents.filter(e => e.ageBracket === age).forEach(e => delete n[e.id]);
                                                            return n;
                                                          });
                                                          return { ...prev, [evType]: curr.filter(a => a !== age) };
                                                        }
                                                        return { ...prev, [evType]: [...curr, age] };
                                                      });
                                                    }}>
                                                    {abLabel(age)}
                                                    {alreadyInAge && <span style={{ marginLeft: 3, color: "#4ade80" }}>✓</span>}
                                                  </button>
                                                );
                                              })}
                                            </div>
                                            {/* For each expanded age: skill level picker */}
                                            {expandedAges.map(age => {
                                              const ageEvents = typeEvents.filter(e => e.ageBracket === age);
                                              const myRegs = t.registrations.filter(r => r.playerId === user.id);
                                              const alreadyRegInTypeAge = myRegs.some(r => ageEvents.some(e => e.id === r.tournamentEventId));
                                              return (
                                                <div key={age} style={{ marginLeft: 8, marginBottom: 10, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
                                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", minWidth: 110 }}>{abLabel(age)} — Skill:</span>
                                                    {ageEvents.map(ev => {
                                                      const alreadyReg = myRegs.some(r => r.tournamentEventId === ev.id);
                                                      const isBlockedBySkill = alreadyRegInTypeAge && !alreadyReg;
                                                      const isSelected = selectedEventIds.includes(ev.id);
                                                      return (
                                                        <button key={ev.id} type="button"
                                                          disabled={alreadyReg || isBlockedBySkill}
                                                          className={`event-type-chip${isSelected || alreadyReg ? " active" : ""}`}
                                                          style={{ minWidth: 48, opacity: isBlockedBySkill ? 0.4 : 1 }}
                                                          onClick={() => {
                                                            if (alreadyReg || isBlockedBySkill) return;
                                                            setSelectedEventIds(prev => {
                                                              const withoutSlot = prev.filter(id => !ageEvents.some(e => e.id === id));
                                                              if (prev.includes(ev.id)) {
                                                                setDivPartners(p => { const n = { ...p }; delete n[ev.id]; return n; });
                                                                if (partnerAssignEventId === ev.id) { setPartnerAssignEventId(null); setPartnerQuery(""); setPartnerResults([]); }
                                                                return withoutSlot;
                                                              }
                                                              return [...withoutSlot, ev.id];
                                                            });
                                                          }}>
                                                          {ev.skillLevel}
                                                          {alreadyReg && <span style={{ marginLeft: 3, color: "#4ade80" }}>✓</span>}
                                                        </button>
                                                      );
                                                    })}
                                                  </div>
                                                  {/* Partner search for doubles when an event is selected */}
                                                  {isDoubles && (() => {
                                                    const selEv = ageEvents.find(e => selectedEventIds.includes(e.id));
                                                    if (!selEv) return null;
                                                    const partner = divPartners[selEv.id] ?? null;
                                                    const isAssigning = partnerAssignEventId === selEv.id;
                                                    return (
                                                      <div style={{ marginTop: 8 }}>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                          <span style={{ fontSize: "0.74rem", color: "var(--muted)" }}>Partner:</span>
                                                          {partner ? (
                                                            <>
                                                              <Avatar name={partner.name} size={20} />
                                                              <span style={{ fontSize: "0.8rem", flex: 1 }}>{partner.name}</span>
                                                              <button className="btn-add-icon" style={{ background: "rgba(255,80,80,.3)" }} onClick={() => setDivPartners(p => ({ ...p, [selEv.id]: null }))}>×</button>
                                                            </>
                                                          ) : (
                                                            <button className="btn-sm" style={{ fontSize: "0.72rem" }} onClick={() => { setPartnerAssignEventId(selEv.id); setPartnerQuery(""); setPartnerResults([]); }}>
                                                              {isAssigning ? "Searching…" : "+ Add Partner (optional)"}
                                                            </button>
                                                          )}
                                                        </div>
                                                        {partner && (
                                                          <div className="field" style={{ marginTop: 8 }}>
                                                            <label>
                                                              Team Name <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>
                                                            </label>
                                                            <div className="field-icon">
                                                              <span className="icon-adorn">
                                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                                              </span>
                                                              <input
                                                                placeholder="e.g. The Picklers"
                                                                value={divTeamNames[selEv.id] ?? ""}
                                                                onChange={e => setDivTeamNames(p => ({ ...p, [selEv.id]: e.target.value }))}
                                                              />
                                                            </div>
                                                          </div>
                                                        )}
                                                        {partner && (
                                                          <div className="dupr-card" style={{ marginTop: 8 }}>
                                                            <div className="dupr-card-title">
                                                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                                                              {t.isDuprReported ? "DUPR Required — Partner" : "DUPR — Partner"}
                                                            </div>
                                                            <div className="field" style={{ margin: 0 }}>
                                                              <label>
                                                                {partner.name}'s DUPR ID{t.isDuprReported ? <span style={{ color: "#f87171" }}> *</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}> (optional)</span>}
                                                              </label>
                                                              <div className="field-icon">
                                                                <span className="icon-adorn icon-adorn-pink">
                                                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M9 14h8"/></svg>
                                                                </span>
                                                                <input
                                                                  placeholder={`e.g. 12345678`}
                                                                  value={divPartnerDuprIds[selEv.id] ?? ""}
                                                                  onChange={e => setDivPartnerDuprIds(p => ({ ...p, [selEv.id]: e.target.value }))}
                                                                />
                                                              </div>
                                                            </div>
                                                            <div className="field" style={{ margin: 0 }}>
                                                              <label>
                                                                {partner.name}'s {etLabel(selEv.eventType)} Rating{t.isDuprReported ? <span style={{ color: "#f87171" }}> *</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}> (optional)</span>}
                                                              </label>
                                                              <div className="field-icon">
                                                                <span className="icon-adorn icon-adorn-pink">
                                                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                                                </span>
                                                                <input
                                                                  type="number" step="0.01" min="0" max="8"
                                                                  placeholder="e.g. 3.75"
                                                                  value={divPartnerDuprRatings[selEv.id] ?? ""}
                                                                  onChange={e => setDivPartnerDuprRatings(p => ({ ...p, [selEv.id]: e.target.value }))}
                                                                />
                                                              </div>
                                                            </div>
                                                          </div>
                                                        )}
                                                        {isAssigning && (
                                                          <div style={{ marginTop: 6 }}>
                                                            <div className="search-wrap">
                                                              <span className="search-icon">🔍</span>
                                                              <input className="search-input" placeholder="Search partner by name/email…" value={partnerQuery}
                                                                onChange={e => setPartnerQuery(e.target.value)} autoFocus autoComplete="off" />
                                                              {partnerSearching && <span className="search-spinner">⟳</span>}
                                                            </div>
                                                            {partnerQuery.trim().length >= 2 && (
                                                              <ul className="search-results">
                                                                {partnerResults.length === 0 && !partnerSearching && <li className="search-no-results">No players found.</li>}
                                                                {partnerResults.map(u => (
                                                                  <li key={u.id} className="search-result-row">
                                                                    <Avatar name={u.name} />
                                                                    <div className="search-result-info"><div className="entity-name">{u.name}</div><div className="entity-sub">{u.email || u.phone}</div></div>
                                                                    <button className="btn-add-icon" onClick={() => { setDivPartners(p => ({ ...p, [selEv.id]: u })); setPartnerAssignEventId(null); setPartnerQuery(""); setPartnerResults([]); }}>+</button>
                                                                  </li>
                                                                ))}
                                                              </ul>
                                                            )}
                                                            <button className="btn-sm" style={{ fontSize: "0.72rem", marginTop: 4, background: "rgba(255,80,80,.2)" }} onClick={() => { setPartnerAssignEventId(null); setPartnerQuery(""); setPartnerResults([]); }}>Cancel</button>
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  })()}
                                                </div>
                                              );
                                            })}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })}
                                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                                  <div className="field">
                                    <label>
                                      Your DUPR ID {t.isDuprReported ? <span style={{ color: "#f87171" }}>*</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>}
                                    </label>
                                    <div className="field-icon">
                                      <span className="icon-adorn icon-adorn-pink">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M9 14h8"/></svg>
                                      </span>
                                      <input
                                        placeholder={user?.duprId ? `Current: ${user.duprId}` : "e.g. 12345678"}
                                        value={regDuprId}
                                        onChange={e => setRegDuprId(e.target.value)}
                                      />
                                    </div>
                                  </div>
                                  {selectedEvObjs.length > 0 && (() => {
                                    function duprCat(et: string) {
                                      if (et === "MIXED_DOUBLES") return "Mixed Doubles";
                                      if (et.includes("DOUBLES")) return "Doubles";
                                      return "Singles";
                                    }
                                    const seen = new Set<string>();
                                    const cats: Array<{ label: string; evIds: string[] }> = [];
                                    for (const ev of selectedEvObjs) {
                                      const cat = duprCat(ev.eventType);
                                      if (!seen.has(cat)) {
                                        seen.add(cat);
                                        cats.push({ label: cat, evIds: [] });
                                      }
                                      cats.find(c => c.label === cat)!.evIds.push(ev.id);
                                    }
                                    return (
                                      <div className="dupr-card">
                                        <div className="dupr-card-title">
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                          Your DUPR Rating{!t.isDuprReported && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)" }}> (optional)</span>}
                                        </div>
                                        {cats.map(({ label, evIds }) => (
                                          <div key={label} className="field" style={{ margin: 0 }}>
                                            <label>{label}</label>
                                            <div className="field-icon">
                                              <span className="icon-adorn icon-adorn-pink">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                              </span>
                                              <input
                                                type="number" step="0.01" min="0" max="8"
                                                placeholder={t.isDuprReported ? "e.g. 3.75 *" : "e.g. 3.75"}
                                                value={divDuprRatings[evIds[0]] ?? ""}
                                                onChange={e => setDivDuprRatings(p => {
                                                  const next = { ...p };
                                                  evIds.forEach(id => { next[id] = e.target.value; });
                                                  return next;
                                                })}
                                              />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                </div>
                                {selectedEvObjs.length > 0 ? (
                                  <button className="btn-primary" disabled={loading} onClick={() => onRegisterForTournament(t.id)} style={{ marginTop: 4 }}>
                                    Register for {selectedEvObjs.length} division{selectedEvObjs.length !== 1 ? "s" : ""}
                                  </button>
                                ) : (
                                  <p className="entity-sub" style={{ marginTop: 4 }}>Select age group + skill level above to register.</p>
                                )}
                              </div>
                            );
                          }

                          // Legacy single-event tournament
                          const isSingles = !isDoublesEvent(t.eventType);
                          if (isSingles) {
                            if (myReg) return null;
                            return (
                              <div className="glass-card">
                                {t.isDuprReported && (
                                  <div style={{ marginBottom: 6, padding: "4px 8px", background: "rgba(236,72,153,0.08)", border: "1px solid rgba(236,72,153,0.25)", borderRadius: 6, fontSize: "0.72rem", color: "#f472b6" }}>
                                    DUPR Reported — DUPR ID and Rating required
                                  </div>
                                )}
                                <div className="field" style={{ marginBottom: 8 }}>
                                  <label>
                                    Your DUPR ID {t.isDuprReported ? <span style={{ color: "#f87171" }}>*</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>}
                                  </label>
                                  <div className="field-icon">
                                    <span className="icon-adorn icon-adorn-pink">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M9 14h8"/></svg>
                                    </span>
                                    <input
                                      placeholder={user?.duprId ? `Current: ${user.duprId}` : "e.g. 12345678"}
                                      value={regDuprId}
                                      onChange={e => setRegDuprId(e.target.value)}
                                    />
                                  </div>
                                </div>
                                <div className="field" style={{ marginBottom: 8 }}>
                                  <label>
                                    Your Singles DUPR Rating {t.isDuprReported ? <span style={{ color: "#f87171" }}>*</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>}
                                  </label>
                                  <div className="field-icon">
                                    <span className="icon-adorn icon-adorn-pink">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                    </span>
                                    <input type="number" step="0.01" min="0" max="8" placeholder="e.g. 3.75"
                                      value={regDuprRating} onChange={e => setRegDuprRating(e.target.value)} />
                                  </div>
                                </div>
                                <button className="btn-primary" disabled={loading} onClick={() => onRegisterForTournament(t.id)}>Register</button>
                              </div>
                            );
                          }
                          if (myReg) return null;
                          return (
                            <div className="glass-card">
                              <h3 className="card-title">Register with Partner</h3>
                              {t.isDuprReported && (
                                <div style={{ marginBottom: 10, padding: "4px 8px", background: "rgba(236,72,153,0.08)", border: "1px solid rgba(236,72,153,0.25)", borderRadius: 6, fontSize: "0.72rem", color: "#f472b6" }}>
                                  DUPR Reported — DUPR ID and Rating required for you{selectedPartner ? " and your partner" : ""}
                                </div>
                              )}
                              <p className="entity-sub" style={{ marginBottom: 12 }}>Search for your partner. They'll receive an invite to confirm.</p>
                              <div className="search-wrap">
                                <span className="search-icon">🔍</span>
                                <input className="search-input" placeholder="Search partner by name/email…" value={partnerQuery}
                                  onChange={e => setPartnerQuery(e.target.value)} autoComplete="off" />
                                {partnerSearching && <span className="search-spinner">⟳</span>}
                              </div>
                              {selectedPartner && (
                                <div className="search-result-row" style={{ marginBottom: 10 }}>
                                  <Avatar name={selectedPartner.name} />
                                  <div className="search-result-info"><div className="entity-name">{selectedPartner.name}</div></div>
                                  <span className="already-badge">Selected</span>
                                  <button className="btn-add-icon" style={{ background: "rgba(255,80,80,.3)" }} onClick={() => setSelectedPartner(null)}>×</button>
                                </div>
                              )}
                              {partnerQuery.trim().length >= 2 && (
                                <ul className="search-results">
                                  {partnerResults.length === 0 && !partnerSearching && <li className="search-no-results">No players found.</li>}
                                  {partnerResults.filter(u => u.id !== selectedPartner?.id).map(u => (
                                    <li key={u.id} className="search-result-row">
                                      <Avatar name={u.name} />
                                      <div className="search-result-info"><div className="entity-name">{u.name}</div><div className="entity-sub">{u.email || u.phone}</div></div>
                                      <button className="btn-add-icon" onClick={() => { setSelectedPartner(u); setPartnerQuery(""); setPartnerResults([]); }}>+</button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {selectedPartner && (
                                <div className="field" style={{ marginTop: 8, marginBottom: 4 }}>
                                  <label>
                                    Team Name <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>
                                  </label>
                                  <div className="field-icon">
                                    <span className="icon-adorn">
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                                    </span>
                                    <input placeholder="e.g. The Picklers" value={regTeamName} onChange={e => setRegTeamName(e.target.value)} />
                                  </div>
                                </div>
                              )}
                              <div className="field" style={{ marginTop: 10, marginBottom: 4 }}>
                                <label>
                                  Your DUPR ID {t.isDuprReported ? <span style={{ color: "#f87171" }}>*</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>}
                                </label>
                                <div className="field-icon">
                                  <span className="icon-adorn icon-adorn-pink">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M9 14h8"/></svg>
                                  </span>
                                  <input
                                    placeholder={user?.duprId ? `Current: ${user.duprId}` : "e.g. 12345678"}
                                    value={regDuprId}
                                    onChange={e => setRegDuprId(e.target.value)}
                                  />
                                </div>
                              </div>
                              <div className="field" style={{ marginBottom: 4 }}>
                                <label>
                                  Your {etLabel(t.eventType)} DUPR Rating {t.isDuprReported ? <span style={{ color: "#f87171" }}>*</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span>}
                                </label>
                                <div className="field-icon">
                                  <span className="icon-adorn icon-adorn-pink">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                  </span>
                                  <input type="number" step="0.01" min="0" max="8" placeholder="e.g. 3.75"
                                    value={regDuprRating} onChange={e => setRegDuprRating(e.target.value)} />
                                </div>
                              </div>
                              {selectedPartner && (
                                <div className="dupr-card" style={{ marginBottom: 4 }}>
                                  <div className="dupr-card-title">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                    {t.isDuprReported ? `DUPR Required — ${selectedPartner.name}` : `DUPR — ${selectedPartner.name}`}
                                  </div>
                                  <div className="field" style={{ margin: 0 }}>
                                    <label>
                                      DUPR ID{t.isDuprReported ? <span style={{ color: "#f87171" }}> *</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}> (optional)</span>}
                                    </label>
                                    <div className="field-icon">
                                      <span className="icon-adorn icon-adorn-pink">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M9 14h8"/></svg>
                                      </span>
                                      <input placeholder="e.g. 12345678"
                                        value={regPartnerDuprId} onChange={e => setRegPartnerDuprId(e.target.value)} />
                                    </div>
                                  </div>
                                  <div className="field" style={{ margin: 0 }}>
                                    <label>
                                      {etLabel(t.eventType)} Rating{t.isDuprReported ? <span style={{ color: "#f87171" }}> *</span> : <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}> (optional)</span>}
                                    </label>
                                    <div className="field-icon">
                                      <span className="icon-adorn icon-adorn-pink">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                      </span>
                                      <input type="number" step="0.01" min="0" max="8"
                                        placeholder="e.g. 3.75"
                                        value={regPartnerDuprRating} onChange={e => setRegPartnerDuprRating(e.target.value)} />
                                    </div>
                                  </div>
                                </div>
                              )}
                              <button className="btn-primary" disabled={loading} onClick={() => onRegisterForTournament(t.id)} style={{ marginTop: 8 }}>
                                {selectedPartner ? `Register with ${selectedPartner.name}` : "Register Solo"}
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    )}


                    {/* Players tab */}
                    {tourneyDetailTab === "players" && (
                      <>
                        <div className="glass-card">
                          {(() => {
                              // Build unique participant list — players + partners without own registration
                              const byPlayerId = new Map<string, TournamentRegistration[]>();
                              const playerOrder: string[] = [];
                              for (const reg of t.registrations) {
                                if (!byPlayerId.has(reg.playerId)) { byPlayerId.set(reg.playerId, []); playerOrder.push(reg.playerId); }
                                byPlayerId.get(reg.playerId)!.push(reg);
                              }
                              // Also add "as partner" registrations to players already in the map (e.g. registered in Singles + partner in Mixed Doubles)
                              for (const reg of t.registrations) {
                                if (reg.partnerId && byPlayerId.has(reg.partnerId) && !byPlayerId.get(reg.partnerId)!.some(r => r.id === reg.id)) {
                                  byPlayerId.get(reg.partnerId)!.push(reg);
                                }
                              }
                              // Collect ALL registrations per partner (not just first) so multi-division partners show all events
                              const partnerOnlyMap = new Map<string, { id: string; name: string; regs: TournamentRegistration[] }>();
                              for (const reg of t.registrations) {
                                if (reg.partnerId && reg.partnerName && !byPlayerId.has(reg.partnerId)) {
                                  if (!partnerOnlyMap.has(reg.partnerId)) {
                                    partnerOnlyMap.set(reg.partnerId, { id: reg.partnerId, name: reg.partnerName, regs: [] });
                                  }
                                  partnerOnlyMap.get(reg.partnerId)!.regs.push(reg);
                                }
                              }
                              const partnerOnly = [...partnerOnlyMap.values()];
                              const totalUnique = playerOrder.length + partnerOnly.length;
                              return (
                                <>
                                  <h3 className="card-title">Registered Players <span className="count-badge">{totalUnique}</span><span style={{ fontSize: "0.72rem", color: "var(--muted)", marginLeft: 8, fontWeight: 400 }}>{t.registrations.length} registrations</span></h3>
                                  {totalUnique === 0 ? <p className="empty-state">No registrations yet.</p> : (
                                    <>
                                      {playerOrder.map(pid => {
                                        const regs = byPlayerId.get(pid)!;
                                        const first = regs[0];
                                        const anyPending = regs.some(r => r.status === "PENDING_PARTNER");
                                        return (
                                          <div key={pid} className="reg-row" style={{ alignItems: "flex-start" }}>
                                            <Avatar name={first.playerName} size={32} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div className="entity-name">{first.playerName}</div>
                                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                                                {regs.map(reg => {
                                                  const ev = reg.tournamentEventId ? t.events.find(e => e.id === reg.tournamentEventId) : null;
                                                  const isAsPartner = reg.partnerId === pid;
                                                  const coPlayerName = isAsPartner ? reg.playerName : reg.partnerName;
                                                  return (
                                                    <span key={reg.id} style={{ fontSize: "0.72rem", background: "rgba(124,107,255,.12)", border: "1px solid rgba(124,107,255,.3)", borderRadius: 6, padding: "2px 7px", color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
                                                      {ev ? `${etLabel(ev.eventType)} · ${ev.skillLevel} · ${abLabel(ev.ageBracket)}` : "General"}
                                                      {coPlayerName && <span style={{ color: "var(--muted)", fontSize: "0.65rem" }}>w/ {coPlayerName}</span>}
                                                      {!isAsPartner && reg.playerDuprRating !== undefined && <span style={{ color: "#f472b6", fontWeight: 600 }}>★{reg.playerDuprRating}</span>}
                                                      {isAsPartner && reg.partnerDuprRating !== undefined && <span style={{ color: "#f472b6", fontWeight: 600 }}>★{reg.partnerDuprRating}</span>}
                                                      {reg.status === "PENDING_PARTNER" && <span style={{ color: "#f59e0b", fontSize: "0.65rem" }}>⏳</span>}
                                                      {reg.status === "CONFIRMED" && <span style={{ color: "#4ade80", fontSize: "0.65rem" }}>✓</span>}
                                                      {isOrganizer && (
                                                        <button style={{ marginLeft: 2, padding: "0 4px", fontSize: "0.65rem", background: "rgba(248,113,113,0.15)", border: "none", borderRadius: 3, color: "#f87171", cursor: "pointer", lineHeight: "14px" }}
                                                          disabled={loading} title="Withdraw this registration"
                                                          onClick={() => onOrgWithdrawRegistration(t.id, reg.id)}>✕</button>
                                                      )}
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                            <span className={`badge ${anyPending ? "badge-status-pending" : "badge-status-confirmed"}`} style={{ marginTop: 2 }}>
                                              {anyPending ? "Pending" : "Confirmed"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                      {partnerOnly.map(({ id, name, regs }) => {
                                        const anyPending = regs.some(r => r.status === "PENDING_PARTNER");
                                        return (
                                          <div key={id} className="reg-row" style={{ alignItems: "flex-start" }}>
                                            <Avatar name={name} size={32} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div className="entity-name">{name}</div>
                                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                                                {regs.map(reg => {
                                                  const ev = reg.tournamentEventId ? t.events.find(e => e.id === reg.tournamentEventId) : null;
                                                  return (
                                                    <span key={reg.id} style={{ fontSize: "0.72rem", background: "rgba(124,107,255,.12)", border: "1px solid rgba(124,107,255,.3)", borderRadius: 6, padding: "2px 7px", color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
                                                      {ev ? `${etLabel(ev.eventType)} · ${ev.skillLevel} · ${abLabel(ev.ageBracket)}` : "General"}
                                                      <span style={{ color: "var(--muted)", fontSize: "0.65rem" }}>w/ {reg.playerName}</span>
                                                      {reg.partnerDuprRating !== undefined && <span style={{ color: "#f472b6", fontWeight: 600 }}>★{reg.partnerDuprRating}</span>}
                                                      <span style={{ color: "#4ade80", fontSize: "0.65rem" }}>✓</span>
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                            <span className={`badge ${anyPending ? "badge-status-pending" : "badge-status-confirmed"}`} style={{ marginTop: 2 }}>
                                              {anyPending ? "Pending" : "Confirmed"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </>
                                  )}
                                </>
                              );
                            })()
                          }
                        </div>
                      </>
                    )}

                    {/* Groups tab */}
                    {/* Divisions tab — per-division: Organizer Controls + Schedule/Groups/Brackets/Standings */}
                    {tourneyDetailTab === "divisions" && (() => {
                      const activeDivId = selectedEventId ?? groupEventId ?? t.events[0]?.id ?? null;
                      const activeDivision = t.events.find(e => e.id === activeDivId) ?? null;

                      // Per-division helpers
                      const divGroups = t.groups.filter(g => g.eventId === activeDivId);
                      const divRegs = t.registrations.filter(r => r.status === "CONFIRMED" && (activeDivId ? r.tournamentEventId === activeDivId : !r.tournamentEventId));
                      const divMatches = t.matches.filter(m => m.tournamentEventId === activeDivId || (!m.tournamentEventId && !activeDivId));
                      const divScheduleMatches = divMatches.filter(m => !m.subDivisionId && m.bracket !== "PLAYOFF");
                      const divPlayoffMatches = divMatches.filter(m => m.bracket === "PLAYOFF");
                      const divScheduleFinalized = activeDivision?.scheduleFinalized ?? false;
                      const divGroupsFinalized = activeDivision?.groupsFinalized ?? false;
                      const divSubDivs = t.subDivisions.filter(sd => sd.eventId === activeDivId);
                      const assignedRegIds = new Set(divGroups.flatMap(g => g.memberRegistrationIds));
                      const isDivDoubles = activeDivision ? isDoublesEvent(activeDivision.eventType) : false;
                      // For doubles/mixed doubles, solo registrations cannot be placed in groups
                      const groupableRegs = isDivDoubles ? divRegs.filter(r => !!r.partnerId) : divRegs;
                      const unassignedRegs = groupableRegs.filter(r => !assignedRegIds.has(r.id));
                      const TIER_LABELS: Record<string, string> = { GRAND_MASTERS: "🏆 Grand Masters", MASTERS: "🥇 Masters", EXPERTS: "🥈 Experts", ADVANCED: "🥉 Advanced" };

                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {/* Division selector — grouped by category */}
                          {t.events.length > 0 && (
                            <div className="glass-card" style={{ padding: "10px 14px" }}>
                              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--muted)", marginBottom: 10, textTransform: "uppercase" }}>Select Division</div>
                              {[
                                { label: "Singles",       types: ["MEN_SINGLES", "WOMEN_SINGLES"] },
                                { label: "Doubles",       types: ["MEN_DOUBLES", "WOMEN_DOUBLES"] },
                                { label: "Mixed Doubles", types: ["MIXED_DOUBLES"] },
                              ].map(({ label, types }) => {
                                const catEvs = t.events.filter(e => types.includes(e.eventType));
                                if (catEvs.length === 0) return null;
                                return (
                                  <div key={label} style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{label}</div>
                                    {types.map(evType => {
                                      const typeEvs = catEvs.filter(e => e.eventType === evType);
                                      if (typeEvs.length === 0) return null;
                                      return (
                                        <div key={evType} style={{ marginBottom: 6 }}>
                                          {types.length > 1 && (
                                            <div style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 4, paddingLeft: 2 }}>{etLabel(evType)}</div>
                                          )}
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 4 }}>
                                            {typeEvs.map(ev => (
                                              <button key={ev.id} type="button"
                                                className={`event-type-chip${activeDivId === ev.id ? " active" : ""}`}
                                                onClick={() => { setSelectedEventId(ev.id); setGroupEventId(ev.id); setDivisionTab("schedule"); }}>
                                                {ev.skillLevel} · {abLabel(ev.ageBracket)}
                                                <span style={{ marginLeft: 4, fontSize: "0.65rem", color: "var(--muted)" }}>
                                                  ({t.registrations.filter(r => r.tournamentEventId === ev.id && r.status === "CONFIRMED").length})
                                                </span>
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* No events / no division selected */}
                          {t.events.length === 0 && (
                            <div className="glass-card" style={{ padding: "10px 14px" }}>
                              <p className="entity-sub">This tournament has no divisions configured.</p>
                            </div>
                          )}

                          {activeDivision && (
                            <>
                              {/* Per-division header */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "2px 0" }}>
                                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#b8acff" }}>
                                  {etLabel(activeDivision.eventType)} · {activeDivision.skillLevel} · {abLabel(activeDivision.ageBracket)}
                                </span>
                                <span className="entity-sub" style={{ fontSize: "0.72rem" }}>{divRegs.length} confirmed</span>
                              </div>

                              {/* Per-division organizer controls */}
                              {isOrganizer && !["CANCELLED", "CLOSED"].includes(t.status) && (() => {
                                const scheduleFinalized = divScheduleFinalized;
                                const groupsFinalized = divGroupsFinalized;
                                const anyScoresEntered = divScheduleMatches.some(m => m.scoreTeam1 !== undefined || m.scoreTeam2 !== undefined);
                                const activeStatus = t.status === "PLANNED" || t.status === "ACTIVE";
                                // Court & Schedule is available when: no groups, OR groups are finalized
                                const scheduleUnlocked = divGroups.length === 0 || groupsFinalized;
                                const canGenerate = activeStatus && divRegs.length >= 2 && !scheduleFinalized && scheduleUnlocked;
                                const canRegenerate = scheduleFinalized && !anyScoresEntered && scheduleUnlocked;

                                // Shared Court & Schedule inner content
                                const rrConfigBody = (isRegen: boolean) => (
                                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: "rgba(124,107,255,0.05)", border: "1px solid rgba(124,107,255,0.2)", borderRadius: 9 }}>
                                    <div className="field-row">
                                      <div className="field" style={{ margin: 0 }}>
                                        <label>Number of Courts</label>
                                        <input type="number" min="1" max="40" placeholder="1" value={rrCourtCount} onChange={e => setRrCourtCount(e.target.value)} />
                                      </div>
                                      <div className="field" style={{ margin: 0 }}>
                                        <label>Court Labels <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span></label>
                                        <input placeholder="Court A, Court B, …" value={rrCourtLabels} onChange={e => setRrCourtLabels(e.target.value)} />
                                      </div>
                                    </div>
                                    <div className="field-row">
                                      <div className="field" style={{ margin: 0 }}>
                                        <label>Date <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span></label>
                                        <input type="date" value={rrScheduleDate} onChange={e => setRrScheduleDate(e.target.value)}
                                          min={t.startDate || undefined} max={t.endDate || undefined} />
                                      </div>
                                      <div className="field" style={{ margin: 0 }}>
                                        <label>From Time <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400, color: "var(--muted)", fontSize: "0.7rem" }}>(optional)</span></label>
                                        <input type="time" value={rrScheduleTime} onChange={e => setRrScheduleTime(e.target.value)} />
                                      </div>
                                    </div>
                                    <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--muted)" }}>Each game is 30 min (20 min play + 10 min break). Matches on the same court are spaced 30 min apart.</p>
                                    {divGroups.length === 0 ? (
                                      <button className="btn-sm btn-sm-generate" disabled={loading}
                                        onClick={() => onGenerateSchedule(t.id, activeDivId!)}>
                                        {isRegen ? "↺" : "🎲"} {isRegen ? "Re-Generate" : "Generate"} Round Robin Games
                                      </button>
                                    ) : unassignedRegs.length > 0 ? (
                                      <span style={{ fontSize: "0.72rem", color: "#f59e0b", display: "flex", alignItems: "center", gap: 4 }}>
                                        ⚠ Assign all players to groups first before generating
                                      </span>
                                    ) : (
                                      <button className="btn-sm btn-sm-generate" disabled={loading}
                                        onClick={async () => { await withError(async () => { const opts = buildRrOpts(); for (const g of divGroups) { if (g.memberRegistrationIds.length >= 2) await api.generateGroupSchedule(t.id, g.id, user!.id, opts); } await selectTournament(t.id); }); }}>
                                        {isRegen ? "↺" : "🎲"} {isRegen ? "Re-Generate" : "Generate"} Round Robin Games
                                      </button>
                                    )}
                                  </div>
                                );

                                return (
                                  <div className="organizer-panel">
                                    <div className="organizer-panel-title">⚙ Division Controls — {etLabel(activeDivision.eventType)}</div>

                                    {/* ── Groups section (collapsible, shown when groups exist) ── */}
                                    {divGroups.length > 0 && (
                                      <div style={{ marginBottom: 10 }}>
                                        <button
                                          className="btn-sm"
                                          style={{ fontSize: "0.7rem", background: showGroupsPanel ? "rgba(124,107,255,.25)" : undefined }}
                                          onClick={() => setShowGroupsPanel(p => !p)}>
                                          🗂 Groups {showGroupsPanel ? "▲" : "▼"}
                                          {groupsFinalized && <span style={{ marginLeft: 6, fontSize: "0.65rem", color: "#4ade80", fontWeight: 700 }}>✓ Finalized</span>}
                                        </button>
                                        {showGroupsPanel && (
                                          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: "rgba(124,107,255,0.05)", border: "1px solid rgba(124,107,255,0.2)", borderRadius: 9 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                              <div className="field" style={{ margin: 0, flex: "0 0 auto" }}>
                                                <label>Count</label>
                                                <select value={groupCountInput} onChange={e => setGroupCountInput(e.target.value)} style={{ width: 70 }}>
                                                  {[1, 2, 4, 8].map(n => <option key={n} value={n}>{n}</option>)}
                                                </select>
                                              </div>
                                              <button className="btn-sm btn-sm-generate" disabled={loading || divRegs.length < 1}
                                                style={{ alignSelf: "flex-end", marginBottom: 0 }}
                                                onClick={() => onCreateGroups(t.id, activeDivId!)}>
                                                🗂 Re-create Groups
                                              </button>
                                            </div>
                                            {!groupsFinalized && (
                                              <button className="btn-sm"
                                                style={{ background: "rgba(74,222,128,.15)", border: "1px solid rgba(74,222,128,.4)", color: "#4ade80", fontWeight: 700 }}
                                                disabled={loading || unassignedRegs.length > 0}
                                                onClick={async () => { await withError(async () => { await api.finalizeGroups(t.id, activeDivId!, user!.id); await selectTournament(t.id); }); }}>
                                                ✓ Finalize Groups
                                                {unassignedRegs.length > 0 && <span style={{ fontWeight: 400, marginLeft: 6, color: "#f59e0b" }}>(assign all players first)</span>}
                                              </button>
                                            )}
                                            {groupsFinalized && (
                                              <span style={{ fontSize: "0.72rem", color: "#4ade80", fontWeight: 600 }}>✓ Groups finalized — schedule can now be generated below.</span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* ── Court & Schedule (generate) — gated by groups finalization ── */}
                                    {canGenerate && (
                                      <div style={{ marginBottom: 10 }}>
                                        <button
                                          className="btn-sm"
                                          style={{ fontSize: "0.7rem", background: showRrConfig ? "rgba(124,107,255,.25)" : undefined }}
                                          onClick={() => setShowRrConfig(p => !p)}>
                                          🎲 Court &amp; Schedule {showRrConfig ? "▲" : "▼"}
                                        </button>
                                        {showRrConfig && rrConfigBody(false)}
                                      </div>
                                    )}

                                    {/* ── Groups exist but not finalized — show gate hint ── */}
                                    {divGroups.length > 0 && !groupsFinalized && activeStatus && divRegs.length >= 2 && (
                                      <p style={{ margin: "0 0 10px", fontSize: "0.72rem", color: "var(--muted)" }}>Finalize Groups above to unlock Court &amp; Schedule.</p>
                                    )}

                                    {/* ── Publish Schedule button ── */}
                                    {divScheduleMatches.length > 0 && !scheduleFinalized && (
                                      <div style={{ marginBottom: 10 }}>
                                        <button className="btn-sm"
                                          style={{ background: "rgba(74,222,128,.15)", border: "1px solid rgba(74,222,128,.4)", color: "#4ade80", fontWeight: 700 }}
                                          disabled={loading}
                                          onClick={async () => { await withError(async () => { await api.finalizeSchedule(t.id, activeDivId!, user!.id); await selectTournament(t.id); }); }}>
                                          🗓 Publish Schedule to Participants
                                        </button>
                                      </div>
                                    )}

                                    {/* ── Re-Generate Schedule (after finalization, no scores yet) ── */}
                                    {canRegenerate && (
                                      <div style={{ marginBottom: 10 }}>
                                        <button
                                          className="btn-sm"
                                          style={{ fontSize: "0.7rem", background: showRrConfig ? "rgba(124,107,255,.25)" : undefined }}
                                          onClick={() => setShowRrConfig(p => !p)}>
                                          ↺ Re-Generate Schedule {showRrConfig ? "▲" : "▼"}
                                        </button>
                                        {showRrConfig && rrConfigBody(true)}
                                      </div>
                                    )}

                                    {/* ── Remaining controls (Finalize RR / Sub-Divisions or Playoffs) ── */}
                                    {divGroups.length > 0 && (() => {
                                      const divGroupMatches = divGroups.flatMap(g => t.matches.filter(m => m.groupId === g.id));
                                      const hasAllMatches = divGroups.every(g => t.matches.some(m => m.groupId === g.id));
                                      const allConfirmed = hasAllMatches && divGroupMatches.length > 0 && divGroupMatches.every(m => m.status === "CONFIRMED");
                                      const isFinalized = activeDivision?.rrFinalized ?? false;
                                      // Sub-Divisions require ≥4 groups with ≥4 members each; otherwise show Playoffs
                                      const canSubDivide = divGroups.length >= 4 && divGroups.every(g => g.memberRegistrationIds.length >= 4);
                                      // With no groups, allow playoffs once schedule is finalized
                                      const noGroupsPlayoffReady = divGroups.length === 0 && divScheduleFinalized;
                                      if (!isFinalized && !allConfirmed && !noGroupsPlayoffReady) return null;
                                      return (
                                        <div className="organizer-controls" style={{ flexWrap: "wrap" }}>
                                          {!isFinalized && allConfirmed && (
                                            <button className="btn-sm" style={{ background: "rgba(74,222,128,.18)", border: "1px solid rgba(74,222,128,.35)", color: "#4ade80" }}
                                              disabled={loading}
                                              onClick={async () => { await withError(async () => { await api.finalizeRR(t.id, activeDivId!, user!.id); await selectTournament(t.id); }); }}>
                                              ✓ Finalize Round Robin
                                            </button>
                                          )}
                                          {isFinalized && canSubDivide && (
                                            <button className="btn-sm" style={{ background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.35)", color: "#fbbf24" }}
                                              disabled={loading} onClick={() => onCreateSubDivisions(t.id, activeDivId!)}>
                                              🏆 {divSubDivs.length > 0 ? "Re-create" : "Create"} Sub-Divisions
                                            </button>
                                          )}
                                          {(isFinalized || noGroupsPlayoffReady) && !canSubDivide && (
                                            <button className="btn-sm" style={{ background: "rgba(251,191,36,.18)", border: "1px solid rgba(251,191,36,.35)", color: "#fbbf24" }}
                                              disabled={loading} onClick={() => onCreatePlayoffs(t.id, activeDivId!)}>
                                              🏆 {divPlayoffMatches.length > 0 ? "Re-create" : "Create"} Play Offs
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                );
                              })()}

                              {/* Per-division sub-tabs */}
                              <div className="sub-tab-bar">
                                {(["players", "groups", "schedule", "standings", "subdiv", "brackets"] as const).map(tab => {
                                  const allDivRegCount = t.registrations.filter(r => r.tournamentEventId === activeDivId).length;
                                  const labels: Record<string, string> = { players: "Players", groups: "Groups", schedule: "Schedule", standings: "Standings", subdiv: "Sub Divisions", brackets: "Brackets" };
                                  return (
                                    <button key={tab} className={`sub-tab-btn${divisionTab === tab ? " active" : ""}`} onClick={() => setDivisionTab(tab)}>
                                      {labels[tab]}
                                      {tab === "players" && allDivRegCount > 0 && <span className="count-badge" style={{ marginLeft: 5 }}>{allDivRegCount}</span>}
                                      {tab === "schedule" && divScheduleMatches.length > 0 && <span className="count-badge" style={{ marginLeft: 5 }}>{divScheduleMatches.length}</span>}
                                      {tab === "groups" && divGroups.length > 0 && <span className="count-badge" style={{ marginLeft: 5 }}>{divGroups.length}</span>}
                                      {tab === "subdiv" && divSubDivs.length > 0 && <span className="count-badge" style={{ marginLeft: 5 }}>{divSubDivs.length}</span>}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* ── Schedule sub-tab ── */}
                              {divisionTab === "schedule" && (
                                <div className="glass-card">
                                  {!isOrganizer && !divScheduleFinalized ? (
                                    <p className="empty-state">Schedule has not been published yet.</p>
                                  ) : divScheduleMatches.length === 0 ? (
                                    <p className="empty-state">{isOrganizer ? "Use Division Controls above to generate the schedule." : "Schedule not generated yet."}</p>
                                  ) : (
                                    <>
                                    {isOrganizer && !divScheduleFinalized && (
                                      <div style={{ margin: "0 0 10px", padding: "8px 12px", background: "rgba(251,191,36,.1)", border: "1px solid rgba(251,191,36,.3)", borderRadius: 8, fontSize: "0.72rem", color: "#fbbf24", fontWeight: 600 }}>
                                        Draft — not yet visible to participants. Click "Publish Schedule" in Division Controls to share.
                                      </div>
                                    )}
                                    {(() => {
                                      function renderMatchRow(m: TournamentMatch) {
                                        const isReporting = reportingMatchId === m.id;
                                        const canReport = m.status !== "CONFIRMED" && (m.team1Ids.includes(user!.id) || m.team2Ids.includes(user!.id) || isOrganizer);
                                        const canConfirm = isOrganizer && m.status === "PENDING_APPROVAL";
                                        const canEdit = isOrganizer && m.status === "CONFIRMED";
                                        return (
                                          <div key={m.id} className="match-row">
                                            <div className="match-teams">
                                              <span className="match-team-name">{tn(m.team1Ids)}</span>
                                              <span className="match-vs">vs</span>
                                              <span className="match-team-name">{tn(m.team2Ids)}</span>
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                                              {(m.court || m.scheduledAt) && (
                                                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                                  {m.court && <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#7c6bff", background: "rgba(124,107,255,.13)", border: "1px solid rgba(124,107,255,.28)", borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" }}>{m.court}</span>}
                                                  {m.scheduledAt && <span style={{ fontSize: "0.66rem", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{fmt12hr(m.scheduledAt)}</span>}
                                                </div>
                                              )}
                                              {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && (
                                                <div className="match-score">
                                                  <span className={`match-score-num${m.winnerIds?.includes(m.team1Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                                                  <span className="match-score-dash">–</span>
                                                  <span className={`match-score-num${m.winnerIds?.includes(m.team2Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                                                </div>
                                              )}
                                            </div>
                                            <div className="match-actions">
                                              <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Final" : m.status === "PENDING_APPROVAL" ? "Pending" : "Scheduled"}</span>
                                              {isReporting ? (
                                                <div className="score-input-row">
                                                  <input placeholder="11" value={scoreInput.s1} onChange={e => setScoreInput(p => ({ ...p, s1: e.target.value }))} />
                                                  <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                                                  <input placeholder="8" value={scoreInput.s2} onChange={e => setScoreInput(p => ({ ...p, s2: e.target.value }))} />
                                                  <button className="btn-confirm" onClick={() => canEdit ? onEditScore(m.id) : onReportScore(m.id)} disabled={loading}>✓</button>
                                                  <button className="btn-decline" onClick={() => { setReportingMatchId(null); setScoreInput({ s1: "", s2: "" }); }}>✕</button>
                                                </div>
                                              ) : (
                                                <>
                                                  {canReport && !canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Score</button>}
                                                  {canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Edit</button>}
                                                  {canConfirm && <button className="btn-confirm" disabled={loading} onClick={() => onConfirmScore(m.id)}>Confirm</button>}
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      }

                                      // Group matches exist — show per group, then per round
                                      if (divGroups.length > 0 && divScheduleMatches.some(m => m.groupId)) {
                                        return divGroups.map(group => {
                                          const gMatches = divScheduleMatches.filter(m => m.groupId === group.id);
                                          if (gMatches.length === 0) return null;
                                          const rounds = [...new Set(gMatches.map(m => m.roundNumber))].sort((a,b) => a-b);
                                          return (
                                            <div key={group.id} style={{ marginBottom: 16 }}>
                                              <div className="match-round-label" style={{ color: "#b8acff" }}>{group.name}</div>
                                              {rounds.map(round => (
                                                <div key={round}>
                                                  <div className="match-round-label" style={{ fontSize: "0.68rem", color: "var(--muted)", paddingLeft: 4 }}>Round {round}</div>
                                                  {gMatches.filter(m => m.roundNumber === round).map(renderMatchRow)}
                                                </div>
                                              ))}
                                            </div>
                                          );
                                        });
                                      }

                                      // No groups — group by round
                                      const rounds = [...new Set(divScheduleMatches.map(m => m.roundNumber))].sort((a,b) => a-b);
                                      return rounds.map(round => (
                                        <div key={round}>
                                          <div className="match-round-label">Round {round}</div>
                                          {divScheduleMatches.filter(m => m.roundNumber === round).map(renderMatchRow)}
                                        </div>
                                      ));
                                    })()}
                                    </>
                                  )}
                                </div>
                              )}

                              {/* ── Groups sub-tab ── */}
                              {divisionTab === "groups" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {/* Unassigned players */}
                                  {isOrganizer && divGroups.length > 0 && unassignedRegs.length > 0 && (
                                    <div className="glass-card" style={{ padding: "10px 14px" }}>
                                      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--pink)", marginBottom: 6 }}>Unassigned Players ({unassignedRegs.length})</div>
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                        {unassignedRegs.map(reg => (
                                          <div key={reg.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "rgba(236,72,153,.1)", border: "1px solid rgba(236,72,153,.3)", borderRadius: 8, padding: "3px 8px", fontSize: "0.78rem" }}>
                                            <span>{reg.teamName ?? (reg.partnerName ? `${reg.playerName} & ${reg.partnerName}` : reg.playerName)}</span>
                                            <select style={{ fontSize: "0.72rem", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-s)", borderRadius: 4, padding: "1px 4px" }}
                                              defaultValue="" onChange={e => { if (e.target.value) onAssignGroup(t.id, e.target.value, reg.id, "add"); }}>
                                              <option value="">→ Group</option>
                                              {divGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                            </select>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {divGroups.length === 0 && (
                                    <div className="glass-card"><p className="empty-state">{isOrganizer ? "Use Division Controls above to create groups." : "No groups created yet."}</p></div>
                                  )}

                                  {divGroups.map(group => {
                                    const groupRegs = group.memberRegistrationIds.map(rid => t.registrations.find(r => r.id === rid)).filter(Boolean) as typeof t.registrations;
                                    const groupMatches = t.matches.filter(m => m.groupId === group.id);
                                    const confirmedGroupMatches = groupMatches.filter(m => m.status === "CONFIRMED").length;
                                    return (
                                      <div key={group.id} className="glass-card" style={{ padding: "12px 14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                                          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#b8acff" }}>{group.name}</div>
                                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                            {groupMatches.length > 0 && <span className="entity-sub" style={{ fontSize: "0.72rem" }}>{confirmedGroupMatches}/{groupMatches.length} scored</span>}
                                          </div>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: groupMatches.length > 0 ? 10 : 0 }}>
                                          {groupRegs.length === 0 && <span className="entity-sub" style={{ fontSize: "0.75rem" }}>No players assigned yet</span>}
                                          {groupRegs.map((reg, idx) => (
                                            <div key={reg.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "rgba(124,107,255,.07)", border: "1px solid rgba(124,107,255,.2)", borderRadius: 8 }}>
                                              <span style={{ fontSize: "0.72rem", color: "var(--muted)", minWidth: 18, textAlign: "right", fontWeight: 600 }}>{idx + 1}.</span>
                                              <span style={{ flex: 1, fontSize: "0.82rem", fontWeight: 600 }}>{reg.teamName ?? (reg.partnerName ? `${reg.playerName} & ${reg.partnerName}` : reg.playerName)}</span>
                                              {isOrganizer && (
                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                  {divGroups.length > 1 && (
                                                    <select
                                                      value=""
                                                      disabled={loading}
                                                      onChange={e => { if (e.target.value) onAssignGroup(t.id, e.target.value, reg.id, "add"); }}
                                                      style={{ fontSize: "0.7rem", background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border-s)", cursor: "pointer", padding: "2px 4px", borderRadius: 4 }}
                                                      title="Move to another group">
                                                      <option value="">↗ Move</option>
                                                      {divGroups.filter(g => g.id !== group.id).map(g => (
                                                        <option key={g.id} value={g.id}>{g.name}</option>
                                                      ))}
                                                    </select>
                                                  )}
                                                  <button style={{ all: "unset", cursor: "pointer", color: "var(--muted)", fontSize: "0.85rem", lineHeight: 1, padding: "0 2px" }}
                                                    title="Remove from group"
                                                    onClick={() => onAssignGroup(t.id, group.id, reg.id, "remove")}>×</button>
                                                </div>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                        {groupMatches.length > 0 && (
                                          <p className="entity-sub" style={{ fontSize: "0.72rem", marginTop: 6 }}>
                                            {groupMatches.filter(m => m.status === "CONFIRMED").length}/{groupMatches.length} games scored — see Schedule tab
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* ── Brackets sub-tab ── */}
                              {/* ── Sub Divisions tab: member listing + generate bracket ── */}
                              {divisionTab === "subdiv" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {divSubDivs.length === 0 && (
                                    <div className="glass-card"><p className="empty-state">{isOrganizer ? "Finalize Round Robin and use Division Controls to create sub-divisions." : "Sub-divisions not created yet."}</p></div>
                                  )}
                                  {divSubDivs.map(sd => {
                                    const sdMatches = t.matches.filter(m => m.subDivisionId === sd.id);
                                    return (
                                      <div key={sd.id} className="glass-card" style={{ padding: "12px 14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                                          <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#fbbf24" }}>{TIER_LABELS[sd.tier] ?? sd.tier}</div>
                                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span className="entity-sub" style={{ fontSize: "0.72rem" }}>{sd.members.length} players</span>
                                            {isOrganizer && sd.members.length >= 2 && (
                                              <button className="btn-sm btn-sm-generate" style={{ fontSize: "0.72rem", padding: "3px 10px" }} disabled={loading}
                                                onClick={() => onGenerateSubDivBracket(t.id, sd.id)}>
                                                {sdMatches.length > 0 ? "Re-generate" : "Generate Bracket"}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                          {sd.members.map(m => {
                                            const reg = t.registrations.find(r => r.id === m.registrationId);
                                            return (
                                              <span key={m.registrationId} style={{ fontSize: "0.75rem", background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.25)", borderRadius: 8, padding: "2px 8px" }}>
                                                <span style={{ color: "#fbbf24", fontWeight: 700, marginRight: 4 }}>#{m.seed}</span>
                                                {reg ? (reg.playerName + (reg.partnerName ? ` & ${reg.partnerName}` : "")) : m.registrationId.slice(-4)}
                                              </span>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* ── Brackets tab: Playoffs + sub-division brackets ── */}
                              {divisionTab === "brackets" && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                  {divSubDivs.length === 0 && divPlayoffMatches.length === 0 && (
                                    <div className="glass-card"><p className="empty-state">No brackets yet — create Play Offs or Sub Divisions from Division Controls.</p></div>
                                  )}
                                  {/* Playoff bracket */}
                                  {divPlayoffMatches.length > 0 && (() => {
                                    const thirdPlaceMatch = divMatches.find(m => m.bracket === "PLAYOFF_3RD");
                                    const rounds = [...new Set(divPlayoffMatches.map(m => m.roundNumber))].sort((a,b) => a-b);
                                    const totalRounds = rounds.length;
                                    const maxRound = rounds[rounds.length - 1] ?? 1;
                                    const sfRound = maxRound - 1;
                                    // SF complete = all matches in sfRound confirmed (only relevant when totalRounds >= 2)
                                    const sfMatches = divPlayoffMatches.filter(m => m.roundNumber === sfRound);
                                    const sfAllConfirmed = totalRounds >= 2 && sfMatches.length >= 2 && sfMatches.every(m => m.status === "CONFIRMED");
                                    const finalMatch = divPlayoffMatches.find(m => m.roundNumber === maxRound);
                                    const finalConfirmed = finalMatch?.status === "CONFIRMED";
                                    const divWinners = t.placements.filter(p => p.eventId === activeDivId);
                                    const roundLabel = (rnd: number) => {
                                      const fromEnd = totalRounds - rnd;
                                      if (fromEnd === 0) return "Final";
                                      if (fromEnd === 1) return "Semi-Finals";
                                      if (fromEnd === 2) return "Quarter-Finals";
                                      return `Round ${rnd}`;
                                    };
                                    return (
                                      <div className="glass-card" style={{ padding: "12px 14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                          <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#f472b6" }}>🏆 Play Offs</div>
                                          {isOrganizer && (
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                              {sfAllConfirmed && !thirdPlaceMatch && (
                                                <button className="btn-sm" style={{ fontSize: "0.7rem", background: "rgba(124,107,255,.15)", border: "1px solid rgba(124,107,255,.3)", color: "#b8acff" }}
                                                  disabled={loading} onClick={() => onCreateThirdPlaceMatch(t.id, activeDivId!)}>
                                                  + 3rd Place Match
                                                </button>
                                              )}
                                              {finalConfirmed && divWinners.length === 0 && (
                                                <button className="btn-sm" style={{ background: "rgba(74,222,128,.15)", border: "1px solid rgba(74,222,128,.4)", color: "#4ade80", fontWeight: 700, fontSize: "0.7rem" }}
                                                  disabled={loading} onClick={() => onDeclareWinners(t.id, activeDivId!)}>
                                                  🏅 Declare Winners
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <div style={{ borderTop: "1px solid rgba(244,114,182,.15)", paddingTop: 8 }}>
                                          {rounds.map(rnd => (
                                            <div key={rnd}>
                                              <div className="match-round-label" style={{ fontSize: "0.72rem", color: "#f472b6" }}>{roundLabel(rnd)}</div>
                                              {divPlayoffMatches.filter(m => m.roundNumber === rnd).map(m => {
                                                if (m.team1Ids.length === 0 && m.team2Ids.length === 0) {
                                                  return (
                                                    <div key={m.id} className="match-row">
                                                      <div className="match-teams" style={{ color: "var(--muted)", fontStyle: "italic" }}>TBD vs TBD</div>
                                                      <div className="match-actions"><span className="badge badge-status-pending">Awaiting</span></div>
                                                    </div>
                                                  );
                                                }
                                                const isRep = reportingMatchId === m.id;
                                                const canRep = m.status !== "CONFIRMED" && (m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id) || isOrganizer);
                                                const canConf = isOrganizer && m.status === "PENDING_APPROVAL";
                                                const canEdit = isOrganizer && m.status === "CONFIRMED";
                                                return (
                                                  <div key={m.id} className="match-row">
                                                    <div className="match-teams">
                                                      <span className="match-team-name">{tn(m.team1Ids)}</span>
                                                      <span className="match-vs">vs</span>
                                                      <span className="match-team-name">{tn(m.team2Ids)}</span>
                                                    </div>
                                                    {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && (
                                                      <div className="match-score">
                                                        <span className={`match-score-num${m.winnerIds?.includes(m.team1Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                                                        <span className="match-score-dash">–</span>
                                                        <span className={`match-score-num${m.winnerIds?.includes(m.team2Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                                                      </div>
                                                    )}
                                                    <div className="match-actions">
                                                      <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Final" : m.status === "PENDING_APPROVAL" ? "Pending" : "Scheduled"}</span>
                                                      {isRep ? (
                                                        <div className="score-input-row">
                                                          <input placeholder="11" value={scoreInput.s1} onChange={e => setScoreInput(p => ({ ...p, s1: e.target.value }))} />
                                                          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                                                          <input placeholder="8" value={scoreInput.s2} onChange={e => setScoreInput(p => ({ ...p, s2: e.target.value }))} />
                                                          <button className="btn-confirm" onClick={() => canEdit ? onEditScore(m.id) : onReportScore(m.id)} disabled={loading}>✓</button>
                                                          <button className="btn-decline" onClick={() => { setReportingMatchId(null); setScoreInput({ s1: "", s2: "" }); }}>✕</button>
                                                        </div>
                                                      ) : (
                                                        <>
                                                          {canRep && !canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Score</button>}
                                                          {canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Edit</button>}
                                                          {canConf && <button className="btn-confirm" disabled={loading} onClick={() => onConfirmScore(m.id)}>Confirm</button>}
                                                        </>
                                                      )}
                                                    </div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          ))}
                                        </div>
                                        {/* 3rd place match */}
                                        {thirdPlaceMatch && (
                                          <div style={{ marginTop: 12, borderTop: "1px solid rgba(244,114,182,.1)", paddingTop: 10 }}>
                                            <div className="match-round-label" style={{ fontSize: "0.72rem", color: "#f472b6" }}>🥉 3rd Place Match</div>
                                            {thirdPlaceMatch.team1Ids.length === 0 ? (
                                              <div className="match-row"><div className="match-teams" style={{ color: "var(--muted)", fontStyle: "italic" }}>TBD vs TBD</div></div>
                                            ) : (() => {
                                              const m = thirdPlaceMatch;
                                              const isRep = reportingMatchId === m.id;
                                              const canRep = m.status !== "CONFIRMED" && (m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id) || isOrganizer);
                                              const canConf = isOrganizer && m.status === "PENDING_APPROVAL";
                                              const canEdit = isOrganizer && m.status === "CONFIRMED";
                                              return (
                                                <div className="match-row">
                                                  <div className="match-teams">
                                                    <span className="match-team-name">{tn(m.team1Ids)}</span>
                                                    <span className="match-vs">vs</span>
                                                    <span className="match-team-name">{tn(m.team2Ids)}</span>
                                                  </div>
                                                  {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && (
                                                    <div className="match-score">
                                                      <span className={`match-score-num${m.winnerIds?.includes(m.team1Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                                                      <span className="match-score-dash">–</span>
                                                      <span className={`match-score-num${m.winnerIds?.includes(m.team2Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                                                    </div>
                                                  )}
                                                  <div className="match-actions">
                                                    <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Final" : m.status === "PENDING_APPROVAL" ? "Pending" : "Scheduled"}</span>
                                                    {isRep ? (
                                                      <div className="score-input-row">
                                                        <input placeholder="11" value={scoreInput.s1} onChange={e => setScoreInput(p => ({ ...p, s1: e.target.value }))} />
                                                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                                                        <input placeholder="8" value={scoreInput.s2} onChange={e => setScoreInput(p => ({ ...p, s2: e.target.value }))} />
                                                        <button className="btn-confirm" onClick={() => canEdit ? onEditScore(m.id) : onReportScore(m.id)} disabled={loading}>✓</button>
                                                        <button className="btn-decline" onClick={() => { setReportingMatchId(null); setScoreInput({ s1: "", s2: "" }); }}>✕</button>
                                                      </div>
                                                    ) : (
                                                      <>
                                                        {canRep && !canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: "", s2: "" }); }}>Score</button>}
                                                        {canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Edit</button>}
                                                        {canConf && <button className="btn-confirm" disabled={loading} onClick={() => onConfirmScore(m.id)}>Confirm</button>}
                                                      </>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        )}
                                        {/* Declared winners summary */}
                                        {divWinners.length > 0 && (
                                          <div style={{ marginTop: 12, borderTop: "1px solid rgba(244,114,182,.1)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                                            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#f472b6", textTransform: "uppercase", letterSpacing: ".06em" }}>Division Results</div>
                                            {divWinners.map(p => (
                                              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <span style={{ fontSize: "1rem" }}>{p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : "🥉"}</span>
                                                <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{p.playerIds.map(id => { const r = t.registrations.find(x => x.playerId === id || x.partnerId === id); return r?.playerId === id ? r.playerName : (r?.partnerName ?? id); }).join(" & ")}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {divSubDivs.map(sd => {
                                    const allSdMatches = t.matches.filter(m => m.subDivisionId === sd.id);
                                    if (allSdMatches.length === 0) return null;
                                    const sdThirdPlaceMatch = allSdMatches.find(m => m.bracket === "BRACKET_3RD");
                                    const sdMatches = allSdMatches.filter(m => m.bracket !== "BRACKET_3RD");
                                    const rounds = [...new Set(sdMatches.map(m => m.roundNumber))].sort((a,b) => a-b);
                                    const totalRounds = rounds.length;
                                    const maxRound = rounds[rounds.length - 1] ?? 1;
                                    const sfRound = maxRound - 1;
                                    const sfMatches = sdMatches.filter(m => m.roundNumber === sfRound);
                                    const sfAllConfirmed = totalRounds >= 2 && sfMatches.length >= 2 && sfMatches.every(m => m.status === "CONFIRMED");
                                    const sdFinalMatch = sdMatches.find(m => m.roundNumber === maxRound);
                                    const sdFinalConfirmed = sdFinalMatch?.status === "CONFIRMED";
                                    const sdWinners = t.placements.filter(p => p.subDivisionId === sd.id).sort((a, b) => a.position - b.position);
                                    const roundLabel = (rnd: number) => {
                                      const fromEnd = totalRounds - rnd;
                                      if (fromEnd === 0) return "Final";
                                      if (fromEnd === 1) return "Semi-Finals";
                                      if (fromEnd === 2) return "Quarter-Finals";
                                      return `Round ${rnd}`;
                                    };
                                    return (
                                      <div key={sd.id} className="glass-card" style={{ padding: "12px 14px" }}>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                                          <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#fbbf24" }}>{TIER_LABELS[sd.tier] ?? sd.tier}</div>
                                          {isOrganizer && (
                                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                              {sfAllConfirmed && !sdThirdPlaceMatch && (
                                                <button className="btn-sm" style={{ fontSize: "0.7rem", background: "rgba(124,107,255,.15)", border: "1px solid rgba(124,107,255,.3)", color: "#b8acff" }}
                                                  disabled={loading} onClick={() => onCreateSubDivThirdPlaceMatch(t.id, sd.id)}>
                                                  + 3rd Place Match
                                                </button>
                                              )}
                                              {sdFinalConfirmed && sdWinners.length === 0 && (
                                                <button className="btn-sm" style={{ background: "rgba(74,222,128,.15)", border: "1px solid rgba(74,222,128,.4)", color: "#4ade80", fontWeight: 700, fontSize: "0.7rem" }}
                                                  disabled={loading} onClick={() => onDeclareSubDivWinners(t.id, sd.id)}>
                                                  🏅 Declare Winners
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <div style={{ borderTop: "1px solid rgba(251,191,36,.15)", paddingTop: 8 }}>
                                            {rounds.map(rnd => (
                                              <div key={rnd}>
                                                <div className="match-round-label" style={{ fontSize: "0.72rem", color: "#fbbf24" }}>{roundLabel(rnd)}</div>
                                                {sdMatches.filter(m => m.roundNumber === rnd).map(m => {
                                                  if (m.team1Ids.length === 0 && m.team2Ids.length === 0) {
                                                    return (
                                                      <div key={m.id} className="match-row">
                                                        <div className="match-teams" style={{ color: "var(--muted)", fontStyle: "italic" }}>TBD vs TBD</div>
                                                        <div className="match-actions"><span className="badge badge-status-pending">Awaiting</span></div>
                                                      </div>
                                                    );
                                                  }
                                                  const isRep = reportingMatchId === m.id;
                                                  const canRep = m.status !== "CONFIRMED" && (m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id) || isOrganizer);
                                                  const canConf = isOrganizer && m.status === "PENDING_APPROVAL";
                                                  const canEdit = isOrganizer && m.status === "CONFIRMED";
                                                  return (
                                                    <div key={m.id} className="match-row">
                                                      <div className="match-teams">
                                                        <span className="match-team-name">{tn(m.team1Ids)}</span>
                                                        <span className="match-vs">vs</span>
                                                        <span className="match-team-name">{tn(m.team2Ids)}</span>
                                                      </div>
                                                      {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && (
                                                        <div className="match-score">
                                                          <span className={`match-score-num${m.winnerIds?.includes(m.team1Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                                                          <span className="match-score-dash">–</span>
                                                          <span className={`match-score-num${m.winnerIds?.includes(m.team2Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                                                        </div>
                                                      )}
                                                      <div className="match-actions">
                                                        <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Final" : m.status === "PENDING_APPROVAL" ? "Pending" : "Scheduled"}</span>
                                                        {isRep ? (
                                                          <div className="score-input-row">
                                                            <input placeholder="11" value={scoreInput.s1} onChange={e => setScoreInput(p => ({ ...p, s1: e.target.value }))} />
                                                            <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                                                            <input placeholder="8" value={scoreInput.s2} onChange={e => setScoreInput(p => ({ ...p, s2: e.target.value }))} />
                                                            <button className="btn-confirm" onClick={() => canEdit ? onEditScore(m.id) : onReportScore(m.id)} disabled={loading}>✓</button>
                                                            <button className="btn-decline" onClick={() => { setReportingMatchId(null); setScoreInput({ s1: "", s2: "" }); }}>✕</button>
                                                          </div>
                                                        ) : (
                                                          <>
                                                            {canRep && !canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Score</button>}
                                                            {canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Edit</button>}
                                                            {canConf && <button className="btn-confirm" disabled={loading} onClick={() => onConfirmScore(m.id)}>Confirm</button>}
                                                          </>
                                                        )}
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            ))}
                                          </div>
                                        {/* 3rd place match */}
                                        {sdThirdPlaceMatch && (() => {
                                          const m = sdThirdPlaceMatch;
                                          const isRep = reportingMatchId === m.id;
                                          const canRep = m.status !== "CONFIRMED" && (m.team1Ids.includes(user.id) || m.team2Ids.includes(user.id) || isOrganizer);
                                          const canConf = isOrganizer && m.status === "PENDING_APPROVAL";
                                          const canEdit = isOrganizer && m.status === "CONFIRMED";
                                          return (
                                            <div style={{ marginTop: 12, borderTop: "1px solid rgba(251,191,36,.1)", paddingTop: 10 }}>
                                              <div className="match-round-label" style={{ fontSize: "0.72rem", color: "#fbbf24" }}>🥉 3rd Place Match</div>
                                              {m.team1Ids.length === 0 ? (
                                                <div className="match-row"><div className="match-teams" style={{ color: "var(--muted)", fontStyle: "italic" }}>TBD vs TBD</div></div>
                                              ) : (
                                                <div className="match-row">
                                                  <div className="match-teams">
                                                    <span className="match-team-name">{tn(m.team1Ids)}</span>
                                                    <span className="match-vs">vs</span>
                                                    <span className="match-team-name">{tn(m.team2Ids)}</span>
                                                  </div>
                                                  {m.status === "CONFIRMED" && m.scoreTeam1 !== undefined && (
                                                    <div className="match-score">
                                                      <span className={`match-score-num${m.winnerIds?.includes(m.team1Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam1}</span>
                                                      <span className="match-score-dash">–</span>
                                                      <span className={`match-score-num${m.winnerIds?.includes(m.team2Ids[0]) ? " match-score-winner" : ""}`}>{m.scoreTeam2}</span>
                                                    </div>
                                                  )}
                                                  <div className="match-actions">
                                                    <span className={`badge badge-status-${m.status.toLowerCase()}`}>{m.status === "CONFIRMED" ? "Final" : m.status === "PENDING_APPROVAL" ? "Pending" : "Scheduled"}</span>
                                                    {isRep ? (
                                                      <div className="score-input-row">
                                                        <input placeholder="11" value={scoreInput.s1} onChange={e => setScoreInput(p => ({ ...p, s1: e.target.value }))} />
                                                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>–</span>
                                                        <input placeholder="8" value={scoreInput.s2} onChange={e => setScoreInput(p => ({ ...p, s2: e.target.value }))} />
                                                        <button className="btn-confirm" onClick={() => canEdit ? onEditScore(m.id) : onReportScore(m.id)} disabled={loading}>✓</button>
                                                        <button className="btn-decline" onClick={() => { setReportingMatchId(null); setScoreInput({ s1: "", s2: "" }); }}>✕</button>
                                                      </div>
                                                    ) : (
                                                      <>
                                                        {canRep && !canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: "", s2: "" }); }}>Score</button>}
                                                        {canEdit && <button className="btn-report" onClick={() => { setReportingMatchId(m.id); setScoreInput({ s1: m.scoreTeam1?.toString() ?? "", s2: m.scoreTeam2?.toString() ?? "" }); }}>Edit</button>}
                                                        {canConf && <button className="btn-confirm" disabled={loading} onClick={() => onConfirmScore(m.id)}>Confirm</button>}
                                                      </>
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                        {/* Declared winners summary */}
                                        {sdWinners.length > 0 && (
                                          <div style={{ marginTop: 12, borderTop: "1px solid rgba(251,191,36,.1)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                                            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#fbbf24", textTransform: "uppercase", letterSpacing: ".06em" }}>Results</div>
                                            {sdWinners.map(p => (
                                              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <span style={{ fontSize: "1rem" }}>{p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : "🥉"}</span>
                                                <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{p.playerIds.map(id => { const r = t.registrations.find(x => x.playerId === id || x.partnerId === id); return r?.playerId === id ? r.playerName : (r?.partnerName ?? id); }).join(" & ")}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* ── Players sub-tab ── */}
                              {divisionTab === "players" && (() => {
                                const allDivRegs = t.registrations.filter(r => r.tournamentEventId === activeDivId);
                                const activeDivisionIsDoubles = activeDivision ? isDoublesEvent(activeDivision.eventType) : false;
                                const soloRegs = allDivRegs.filter(r => !r.partnerId && r.status === "CONFIRMED");
                                const regEndDate = t.registrationEndDate ? new Date(t.registrationEndDate) : null;
                                const withinRegWindow = !regEndDate || new Date() <= regEndDate;
                                const hasMatches = t.matches.length > 0;
                                return (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                    <div className="glass-card">
                                      {allDivRegs.length === 0 ? (
                                        <p className="empty-state">No players registered for this division yet.</p>
                                      ) : (
                                        <>
                                          <h3 className="card-title">
                                            Registered Players
                                            <span className="count-badge" style={{ marginLeft: 6 }}>{allDivRegs.length}</span>
                                            {soloRegs.length > 0 && activeDivisionIsDoubles && (
                                              <span style={{ marginLeft: 8, fontSize: "0.72rem", color: "#f59e0b", fontWeight: 400 }}>{soloRegs.length} solo</span>
                                            )}
                                          </h3>
                                          {allDivRegs.map(reg => {
                                            const isEditing = editingTeamNameRegId === reg.id;
                                            const canEditTeamName = (isOrganizer && !hasMatches) || (withinRegWindow && (reg.playerId === user.id || reg.partnerId === user.id));
                                            const isSolo = !reg.partnerId;
                                            return (
                                              <div key={reg.id} className="reg-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
                                                <Avatar name={reg.playerName} size={32} />
                                                <div style={{ flex: 1, minWidth: 120 }}>
                                                  <div className="entity-name">
                                                    {reg.teamName ? (
                                                      <span style={{ fontWeight: 700, color: "#b8acff" }}>{reg.teamName}</span>
                                                    ) : (
                                                      reg.partnerName ? `${reg.playerName} & ${reg.partnerName}` : reg.playerName
                                                    )}
                                                  </div>
                                                  {reg.teamName && (
                                                    <div className="entity-sub" style={{ fontSize: "0.72rem" }}>{reg.playerName}{reg.partnerName ? ` & ${reg.partnerName}` : ""}</div>
                                                  )}
                                                  {isSolo && activeDivisionIsDoubles && (
                                                    <span style={{ fontSize: "0.65rem", color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "1px 5px", marginTop: 2, display: "inline-block" }}>Solo — awaiting team</span>
                                                  )}
                                                  {isEditing ? (
                                                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                                                      <input
                                                        value={editTeamNameValue}
                                                        onChange={e => setEditTeamNameValue(e.target.value)}
                                                        placeholder="Enter team name…"
                                                        style={{ fontSize: "0.8rem", flex: 1, minWidth: 120 }}
                                                        autoFocus
                                                      />
                                                      <button className="btn-confirm" disabled={loading || !editTeamNameValue.trim()} onClick={() => onUpdateTeamName(t.id, reg.id)}>✓</button>
                                                      <button className="btn-decline" onClick={() => { setEditingTeamNameRegId(null); setEditTeamNameValue(""); }}>✕</button>
                                                    </div>
                                                  ) : (
                                                    canEditTeamName && (
                                                      <button style={{ marginTop: 2, fontSize: "0.68rem", color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                                        onClick={() => { setEditingTeamNameRegId(reg.id); setEditTeamNameValue(reg.teamName ?? ""); }}>
                                                        {reg.teamName ? "✏ Edit team name" : "+ Add team name"}
                                                      </button>
                                                    )
                                                  )}
                                                </div>
                                                <span className={`badge ${reg.status === "CONFIRMED" ? "badge-status-confirmed" : "badge-status-pending"}`} style={{ marginTop: 2 }}>
                                                  {reg.status === "CONFIRMED" ? "Confirmed" : "Pending"}
                                                </span>
                                                {(reg.playerDuprRating !== undefined || reg.partnerDuprRating !== undefined) && (
                                                  <span className="badge badge-rr" style={{ marginTop: 2, fontSize: "0.65rem", background: "rgba(236,72,153,0.15)", border: "1px solid rgba(236,72,153,0.35)", color: "#f472b6" }}>
                                                    ★ {reg.playerDuprRating ?? "—"}{reg.partnerDuprRating !== undefined ? ` / ${reg.partnerDuprRating}` : ""}
                                                  </span>
                                                )}
                                                {isOrganizer && (
                                                  <>
                                                    {activeDivisionIsDoubles && (
                                                      <button
                                                        style={{ marginLeft: 4, padding: "2px 7px", fontSize: "0.72rem", background: "rgba(168,139,250,0.15)", border: "1px solid rgba(168,139,250,0.3)", borderRadius: 3, color: "#a78bfa", cursor: "pointer", marginTop: 2 }}
                                                        disabled={loading} title="Edit team members"
                                                        onClick={() => {
                                                          if (editingMembersRegId === reg.id) {
                                                            setEditingMembersRegId(null);
                                                          } else {
                                                            setEditingMembersRegId(reg.id);
                                                            setMemberPlayerQuery(""); setMemberPlayerResults([]); setMemberPlayerSelected(null);
                                                            setMemberPartnerQuery(""); setMemberPartnerResults([]); setMemberPartnerSelected(null);
                                                            setMemberRemovePartner(false);
                                                          }
                                                        }}>✎ Edit Team</button>
                                                    )}
                                                    <button style={{ marginLeft: 4, padding: "2px 7px", fontSize: "0.72rem", background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3, color: "#f87171", cursor: "pointer", marginTop: 2 }}
                                                      disabled={loading} title="Withdraw this registration"
                                                      onClick={() => onOrgWithdrawRegistration(t.id, reg.id)}>✕</button>
                                                  </>
                                                )}
                                                {isOrganizer && activeDivisionIsDoubles && editingMembersRegId === reg.id && (
                                                  <div style={{ width: "100%", marginTop: 10, padding: "10px 12px", background: "rgba(168,139,250,0.07)", border: "1px solid rgba(168,139,250,0.2)", borderRadius: 8 }}>
                                                    <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#a78bfa", marginBottom: 8 }}>Edit Team Members</div>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                                      {/* Player slot */}
                                                      <div className="field">
                                                        <label style={{ fontSize: "0.73rem", color: "var(--muted)" }}>Player (currently: {reg.playerName})</label>
                                                        {memberPlayerSelected ? (
                                                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{memberPlayerSelected.name}</span>
                                                            <button style={{ fontSize: "0.68rem", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                                                              onClick={() => { setMemberPlayerSelected(null); setMemberPlayerQuery(""); }}>✕ Change</button>
                                                          </div>
                                                        ) : (
                                                          <>
                                                            <input
                                                              placeholder={`Replace ${reg.playerName}…`}
                                                              value={memberPlayerQuery}
                                                              onChange={e => setMemberPlayerQuery(e.target.value)}
                                                              style={{ fontSize: "0.82rem" }}
                                                            />
                                                            {memberPlayerSearching && <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Searching…</span>}
                                                            {memberPlayerResults.length > 0 && (
                                                              <div style={{ background: "var(--surface)", border: "1px solid var(--border-s)", borderRadius: 6, marginTop: 2, maxHeight: 120, overflowY: "auto" }}>
                                                                {memberPlayerResults.map(u => (
                                                                  <div key={u.id} onClick={() => { setMemberPlayerSelected(u); setMemberPlayerQuery(""); setMemberPlayerResults([]); }}
                                                                    style={{ padding: "5px 10px", cursor: "pointer", fontSize: "0.82rem" }}
                                                                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(168,139,250,0.15)")}
                                                                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                                                    {u.name}
                                                                  </div>
                                                                ))}
                                                              </div>
                                                            )}
                                                          </>
                                                        )}
                                                      </div>
                                                      {/* Partner slot */}
                                                      <div className="field">
                                                        <label style={{ fontSize: "0.73rem", color: "var(--muted)" }}>Partner (currently: {reg.partnerName ?? "None"})</label>
                                                        {memberRemovePartner ? (
                                                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <span style={{ fontSize: "0.78rem", color: "#f87171" }}>Partner will be removed</span>
                                                            <button style={{ fontSize: "0.68rem", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                                                              onClick={() => setMemberRemovePartner(false)}>Undo</button>
                                                          </div>
                                                        ) : memberPartnerSelected ? (
                                                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            <span style={{ fontSize: "0.82rem", color: "var(--text)" }}>{memberPartnerSelected.name}</span>
                                                            <button style={{ fontSize: "0.68rem", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}
                                                              onClick={() => { setMemberPartnerSelected(null); setMemberPartnerQuery(""); }}>✕ Change</button>
                                                          </div>
                                                        ) : (
                                                          <>
                                                            <input
                                                              placeholder={reg.partnerName ? `Replace ${reg.partnerName}…` : "Add partner…"}
                                                              value={memberPartnerQuery}
                                                              onChange={e => setMemberPartnerQuery(e.target.value)}
                                                              style={{ fontSize: "0.82rem" }}
                                                            />
                                                            {memberPartnerSearching && <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>Searching…</span>}
                                                            {memberPartnerResults.length > 0 && (
                                                              <div style={{ background: "var(--surface)", border: "1px solid var(--border-s)", borderRadius: 6, marginTop: 2, maxHeight: 120, overflowY: "auto" }}>
                                                                {memberPartnerResults.map(u => (
                                                                  <div key={u.id} onClick={() => { setMemberPartnerSelected(u); setMemberPartnerQuery(""); setMemberPartnerResults([]); }}
                                                                    style={{ padding: "5px 10px", cursor: "pointer", fontSize: "0.82rem" }}
                                                                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(168,139,250,0.15)")}
                                                                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                                                    {u.name}
                                                                  </div>
                                                                ))}
                                                              </div>
                                                            )}
                                                            {reg.partnerName && (
                                                              <button style={{ fontSize: "0.68rem", color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}
                                                                onClick={() => { setMemberRemovePartner(true); setMemberPartnerQuery(""); setMemberPartnerResults([]); }}>
                                                                Remove partner
                                                              </button>
                                                            )}
                                                          </>
                                                        )}
                                                      </div>
                                                      <div style={{ display: "flex", gap: 6 }}>
                                                        <button className="btn-sm btn-sm-generate"
                                                          disabled={loading || (!memberPlayerSelected && !memberPartnerSelected && !memberRemovePartner)}
                                                          onClick={() => onUpdateTeamMembers(t.id, reg.id)}>
                                                          Save Changes
                                                        </button>
                                                        <button className="btn-sm" style={{ background: "var(--surface)", color: "var(--muted)", border: "1px solid var(--border-s)" }}
                                                          onClick={() => { setEditingMembersRegId(null); setMemberPlayerQuery(""); setMemberPlayerResults([]); setMemberPlayerSelected(null); setMemberPartnerQuery(""); setMemberPartnerResults([]); setMemberPartnerSelected(null); setMemberRemovePartner(false); }}>
                                                          Cancel
                                                        </button>
                                                      </div>
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </>
                                      )}
                                    </div>

                                    {/* Organizer solo-pairing panel — only for doubles divisions with 2+ solo registrations */}
                                    {isOrganizer && activeDivisionIsDoubles && soloRegs.length >= 2 && (
                                      <div className="glass-card" style={{ padding: "12px 14px" }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#f59e0b", marginBottom: 8 }}>Pair Solo Players</div>
                                        <p className="entity-sub" style={{ fontSize: "0.75rem", marginBottom: 10 }}>Select two solo registrations to form a team.</p>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                          <div className="field-row" style={{ gap: 8 }}>
                                            <div className="field" style={{ flex: 1 }}>
                                              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Player 1</label>
                                              <select value={pairReg1Id} onChange={e => setPairReg1Id(e.target.value)}
                                                style={{ fontSize: "0.82rem", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-s)", borderRadius: 6, padding: "5px 8px" }}>
                                                <option value="">Select…</option>
                                                {soloRegs.filter(r => r.id !== pairReg2Id).map(r => (
                                                  <option key={r.id} value={r.id}>{r.playerName}</option>
                                                ))}
                                              </select>
                                            </div>
                                            <div className="field" style={{ flex: 1 }}>
                                              <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Player 2</label>
                                              <select value={pairReg2Id} onChange={e => setPairReg2Id(e.target.value)}
                                                style={{ fontSize: "0.82rem", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-s)", borderRadius: 6, padding: "5px 8px" }}>
                                                <option value="">Select…</option>
                                                {soloRegs.filter(r => r.id !== pairReg1Id).map(r => (
                                                  <option key={r.id} value={r.id}>{r.playerName}</option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>
                                          <div className="field">
                                            <label style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Team Name (optional)</label>
                                            <input placeholder="e.g. Dream Team" value={pairTeamName} onChange={e => setPairTeamName(e.target.value)} style={{ fontSize: "0.85rem" }} />
                                          </div>
                                          <button className="btn-sm btn-sm-generate" disabled={loading || !pairReg1Id || !pairReg2Id || pairReg1Id === pairReg2Id}
                                            onClick={() => onPairSoloPlayers(t.id)}>
                                            Pair as Team
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {divisionTab === "standings" && (
                                <div className="glass-card">
                                  <h3 className="card-title">Standings</h3>
                                  {divGroups.length > 0 ? divGroups.map(group => {
                                    const groupMatches = divMatches.filter(m => m.groupId === group.id);
                                    const groupRegIds = new Set(group.memberRegistrationIds);
                                    const groupRegs = divRegs.filter(r => groupRegIds.has(r.id));
                                    const rows = computeStandings(groupMatches, groupRegs);
                                    return (
                                      <div key={group.id} style={{ marginBottom: 20 }}>
                                        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#b8acff", marginBottom: 8 }}>{group.name}</div>
                                        {rows.length === 0
                                          ? <p className="empty-state" style={{ fontSize: "0.8rem" }}>No results yet.</p>
                                          : (
                                            <table className="standings-table">
                                              <thead><tr><th>#</th><th>Team</th><th>DUPR</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th></tr></thead>
                                              <tbody>
                                                {rows.map((row, i) => (
                                                  <tr key={i}>
                                                    <td className={`rank-cell rank-${i + 1}`}>{i + 1}</td>
                                                    <td className="entity-name">{row.names}</td>
                                                    <td style={{ color: "#f472b6", fontWeight: 600, fontSize: "0.78rem" }}>{row.duprRating ?? "—"}</td>
                                                    <td>{row.wins}</td>
                                                    <td>{row.losses}</td>
                                                    <td style={{ fontWeight: 700, color: "var(--pink)" }}>{row.wins * 2}</td>
                                                    <td className={row.spread >= 0 ? "spread-pos" : "spread-neg"}>{row.spread >= 0 ? "+" : ""}{row.spread}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          )
                                        }
                                      </div>
                                    );
                                  }) : (() => {
                                    const rows = computeStandings(divMatches, divRegs);
                                    if (rows.length === 0) return <p className="empty-state">No results yet — score some matches first.</p>;
                                    return (
                                      <table className="standings-table">
                                        <thead><tr><th>#</th><th>Team</th><th>DUPR</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th></tr></thead>
                                        <tbody>
                                          {rows.map((row, i) => (
                                            <tr key={i}>
                                              <td className={`rank-cell rank-${i + 1}`}>{i + 1}</td>
                                              <td className="entity-name">{row.names}</td>
                                              <td style={{ color: "#f472b6", fontWeight: 600, fontSize: "0.78rem" }}>{row.duprRating ?? "—"}</td>
                                              <td>{row.wins}</td>
                                              <td>{row.losses}</td>
                                              <td style={{ fontWeight: 700, color: "var(--pink)" }}>{row.wins * 2}</td>
                                              <td className={row.spread >= 0 ? "spread-pos" : "spread-neg"}>{row.spread >= 0 ? "+" : ""}{row.spread}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    );
                                  })()}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Winners tab ── */}
                    {tourneyDetailTab === "winners" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {t.events.length === 0 && (
                          <div className="glass-card"><p className="empty-state">No divisions configured for this tournament.</p></div>
                        )}
                        {t.events.map(ev => {
                          const playoffPlacements = t.placements.filter(p => p.eventId === ev.id && !p.subDivisionId).sort((a, b) => a.position - b.position);
                          const evSubDivs = t.subDivisions.filter(sd => sd.eventId === ev.id);
                          const sdPlacements = evSubDivs.map(sd => ({
                            sd,
                            placements: t.placements.filter(p => p.subDivisionId === sd.id).sort((a, b) => a.position - b.position)
                          })).filter(x => x.placements.length > 0);
                          if (playoffPlacements.length === 0 && sdPlacements.length === 0) return null;

                          const TIER_LABELS_W: Record<string, string> = { GRAND_MASTERS: "🏆 Grand Masters", MASTERS: "🥇 Masters", EXPERTS: "🥈 Experts", ADVANCED: "🥉 Advanced" };
                          const placementRow = (p: TournamentPlacement) => {
                            const names = p.playerIds.map(id => {
                              const reg = t.registrations.find(r => r.playerId === id || r.partnerId === id);
                              if (reg?.playerId === id) return reg.playerName;
                              if (reg?.partnerId === id) return reg.partnerName ?? id;
                              return id;
                            }).join(" & ");
                            return (
                              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.2)", borderRadius: 8 }}>
                                <span style={{ fontSize: "1.1rem", minWidth: 28 }}>{p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : "🥉"}</span>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{names}</div>
                                  <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{p.label ?? `Position ${p.position}`}</div>
                                </div>
                              </div>
                            );
                          };

                          return (
                            <div key={ev.id} className="glass-card" style={{ padding: "14px 16px" }}>
                              <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#b8acff", marginBottom: 12 }}>
                                {etLabel(ev.eventType)} · {ev.skillLevel} · {abLabel(ev.ageBracket)}
                              </div>
                              {/* Playoff winners */}
                              {playoffPlacements.length > 0 && (
                                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: sdPlacements.length > 0 ? 12 : 0 }}>
                                  {playoffPlacements.map(placementRow)}
                                </div>
                              )}
                              {/* Sub-division winners, one section per sub-division */}
                              {sdPlacements.map(({ sd, placements: sdp }) => (
                                <div key={sd.id} style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#fbbf24", marginBottom: 6 }}>{TIER_LABELS_W[sd.tier] ?? sd.tier}</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {sdp.map(placementRow)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {t.events.length > 0 && t.placements.filter(p => p.eventId).length === 0 && (
                          <div className="glass-card"><p className="empty-state">No winners declared yet. Complete the playoff brackets and use "Declare Winners" in Division Controls.</p></div>
                        )}
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              /* ── Tournament list ── */
              <>
                <div className="page-header">
                  <h2>Tournaments</h2>
                  <p className="muted">Organize and compete in events.</p>
                </div>

                {/* Partner invites banner */}
                {partnerInvites.length > 0 && (
                  <div className="glass-card invites-banner partner-invite-banner" style={{ marginBottom: 16 }}>
                    <h3 className="card-title">Partner Invites <span className="count-badge">{partnerInvites.length}</span></h3>
                    <div className="invites-list">
                      {partnerInvites.map(inv => (
                        <div key={inv.id} className="invite-item">
                          <div className="entity-icon trophy-icon"><img src={trophyIcon} alt="" /></div>
                          <div className="invite-info">
                            <div className="entity-name">{inv.tournamentName}</div>
                            <div className="entity-sub">{inv.eventType} · Partner invite from {inv.inviterName}</div>
                          </div>
                          <div className="invite-actions">
                            <button className="btn-accept" disabled={loading} onClick={() => onAcceptPartnerInvite(inv.id)}>Accept</button>
                            <button className="btn-decline" disabled={loading} onClick={() => onDeclinePartnerInvite(inv.id)}>Decline</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="content-grid">
                  <div className="glass-card">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <h3 className="card-title" style={{ margin: 0 }}>Create Tournament</h3>
                      <button type="button" className="create-toggle-btn"
                        onClick={() => setShowCreateTourney(v => !v)}>
                        {showCreateTourney ? "✕ Cancel" : "+ New"}
                      </button>
                    </div>
                    {/* On desktop the form is always visible; on mobile it's toggled via showCreateTourney */}
                    <form onSubmit={onCreateTournament} className={`stack-form create-tourney-form${showCreateTourney ? " open" : ""}`}>
                      <div className="field">
                        <label>Tournament Name</label>
                        <input placeholder="e.g. Spring Open 2025" value={tourneyInput.name} onChange={e => setTourneyInput({ ...tourneyInput, name: e.target.value })} />
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Format</label>
                          <select value={tourneyInput.format} onChange={e => setTourneyInput({ ...tourneyInput, format: e.target.value })}>
                            <option value="ROUND_ROBIN">Round Robin</option>
                            <option value="DOUBLE_ELIMINATION">Double Elimination</option>

                          </select>
                        </div>
                        {tourneyInput.format === "ROUND_ROBIN" && (
                          <div className="field">
                            <label>RR Type</label>
                            <select value={tourneyInput.roundRobinType} onChange={e => setTourneyInput({ ...tourneyInput, roundRobinType: e.target.value })}>
                              <option value="FIXED">Fixed Partner</option>
                              <option value="SWITCH">Switch Partner</option>
                            </select>
                          </div>
                        )}
                      </div>

                      {/* ── Event Divisions builder ── */}
                      <div className="field">
                        <label>Event Types</label>
                        <div className="event-type-grid">
                          {EVENT_TYPES.map(et => (
                            <button
                              key={et.value}
                              type="button"
                              className={`event-type-chip${et.value in eventDivisions ? " active" : ""}`}
                              onClick={() => toggleEventType(et.value)}
                            >
                              {et.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Per-event skill level + age bracket */}
                      {Object.entries(eventDivisions).map(([et, skills]) => (
                        <div key={et} className="division-builder">
                          <div className="division-header">{etLabel(et)}</div>
                          <div className="field">
                            <label>Skill Levels</label>
                            <div className="skill-chip-row">
                              {SKILL_LEVELS.map(sl => (
                                <button
                                  key={sl}
                                  type="button"
                                  className={`skill-chip${sl in skills ? " active" : ""}`}
                                  onClick={() => toggleSkillLevel(et, sl)}
                                >
                                  {sl}
                                </button>
                              ))}
                            </div>
                          </div>
                          {Object.entries(skills).map(([sl, abs]) => (
                            <div key={sl} className="age-bracket-row">
                              <span className="age-bracket-label">{sl}</span>
                              {AGE_BRACKETS.map(ab => (
                                <button
                                  key={ab.value}
                                  type="button"
                                  className={`age-chip${abs.includes(ab.value) ? " active" : ""}`}
                                  onClick={() => toggleAgeBracket(et, sl, ab.value)}
                                >
                                  {ab.label}
                                </button>
                              ))}
                            </div>
                          ))}
                          {Object.keys(skills).length === 0 && (
                            <p className="search-hint">Select at least one skill level above.</p>
                          )}
                        </div>
                      ))}

                      {flattenEvents().length > 0 && (
                        <div className="division-summary">
                          <span className="muted" style={{ fontSize: "0.75rem" }}>
                            {flattenEvents().length} division{flattenEvents().length !== 1 ? "s" : ""}: {flattenEvents().map(d => `${etLabel(d.eventType)} ${d.skillLevel} ${abLabel(d.ageBracket)}`).join(", ")}
                          </span>
                        </div>
                      )}

                      <div className="field-row">
                        <div className="field">
                          <label>Location</label>
                          <input placeholder="e.g. Riverside Courts" value={tourneyInput.location} onChange={e => setTourneyInput({ ...tourneyInput, location: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Start Date</label>
                          <input type="date" value={tourneyInput.startDate} onChange={e => setTourneyInput({ ...tourneyInput, startDate: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>End Date (multi-day)</label>
                          <input type="date" value={tourneyInput.endDate} onChange={e => setTourneyInput({ ...tourneyInput, endDate: e.target.value })} />
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Registration Opens</label>
                          <input type="date" value={tourneyInput.registrationStartDate} onChange={e => setTourneyInput({ ...tourneyInput, registrationStartDate: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Registration Closes</label>
                          <input type="date" value={tourneyInput.registrationEndDate} onChange={e => setTourneyInput({ ...tourneyInput, registrationEndDate: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Withdraw Deadline</label>
                          <input type="date" value={tourneyInput.withdrawDeadline} onChange={e => setTourneyInput({ ...tourneyInput, withdrawDeadline: e.target.value })} />
                        </div>
                      </div>
                      <div className="field-row">
                        <div className="field">
                          <label>Max Teams / Division</label>
                          <input type="number" placeholder="e.g. 8" min="2" value={tourneyInput.maxTeams} onChange={e => setTourneyInput({ ...tourneyInput, maxTeams: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Club (optional)</label>
                          <select value={tourneyInput.clubId} onChange={e => setTourneyInput({ ...tourneyInput, clubId: e.target.value })}>
                            <option value="">— Public —</option>
                            {clubs.filter(c => c.createdBy === user.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="field">
                        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "0.875rem" }}>
                          <input type="checkbox" checked={tourneyInput.isDuprReported}
                            onChange={e => setTourneyInput({ ...tourneyInput, isDuprReported: e.target.checked })}
                            style={{ width: 16, height: 16, accentColor: "var(--pink)" }} />
                          DUPR Reported Tournament
                          <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontWeight: 400 }}>(requires DUPR ID + rating on registration)</span>
                        </label>
                      </div>
                      <button type="submit" className="btn-primary" disabled={loading}>Create Tournament</button>
                    </form>
                  </div>

                  <div className="glass-card">
                    <h3 className="card-title">All Tournaments <span className="count-badge">{tournaments.length}</span></h3>
                    {tournaments.length === 0
                      ? <p className="empty-state">No tournaments yet — create one!</p>
                      : <ul className="entity-list">
                          {tournaments.map(t => {
                            const tClub = (t as any).clubId ? clubs.find(c => c.id === (t as any).clubId) : null;
                            const tIsMember = !(t as any).clubId || clubs.find(c => c.id === (t as any).clubId)?.memberIds.includes(user.id);
                            return (
                              <li key={t.id} className="clickable-row" onClick={() => selectTournament(t.id)}>
                                <div className="entity-icon trophy-icon"><img src={trophyIcon} alt="" /></div>
                                <div style={{ flex: 1 }}>
                                  <div className="entity-name">{t.name}</div>
                                  <div className="entity-sub">
                                    {t.format === "ROUND_ROBIN" ? "Round Robin" : t.format === "DOUBLE_ELIMINATION" ? "Double Elim." : "Waterfall"} · {t.eventType.split(",").map(s => etLabel(s.trim())).join(", ")}
                                    {t.skillLevel ? ` · ${t.skillLevel}` : ""}
                                    {t.location ? ` · ${t.location}` : ""}
                                    {tClub ? ` · 🏢 ${tClub.name}` : ""}
                                  </div>
                                </div>
                                {!tIsMember && <span className="badge badge-de" style={{ fontSize: "0.62rem" }}>Members Only</span>}
                                <span className={`badge ${t.status === "CANCELLED" ? "badge-cancelled" : t.status === "CLOSED" ? "badge-closed" : `badge-status-${(t.status ?? "").toLowerCase()}`}`} style={{ fontSize: "0.62rem" }}>{t.status}</span>
                                <span className="entity-chevron">›</span>
                              </li>
                            );
                          })}
                        </ul>
                    }
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        {/* ── LEAGUES ── */}
        {activeTab === "leagues" && (
          <div className="tab-panel fade-in">
            <div className="page-header">
              <h2>Leagues</h2>
              <p className="muted">Ladder leagues — weekly play that keeps players coming back.</p>
            </div>

            {selectedLeague ? (
              (() => {
                const lg = selectedLeague;
                const isOrganizer = user.id === lg.createdBy;
                const myReg = lg.registrations.find(r => r.playerId === user.id);
                const leagueClub = lg.clubId ? clubs.find(c => c.id === lg.clubId) : null;
                const isClubMember = !lg.clubId || clubs.find(c => c.id === lg.clubId)?.memberIds.includes(user.id);

                return (
                  <>
                    <button className="btn-back" onClick={() => setSelectedLeague(null)}>← All Leagues</button>

                    <div className="glass-card tourney-header">
                      <div className="tourney-header-top">
                        <div>
                          <h2 className="tourney-name">{lg.name}</h2>
                          <div className="tourney-meta">
                            <span className={`badge ${lg.format === "ROTATIONAL" ? "badge-rr" : "badge-de"}`}>{lg.format === "ROTATIONAL" ? "Rotational" : "Fixed Partner"}</span>
                            <span className="tourney-meta-item">📅 {lg.durationWeeks}w season</span>
                            <span className="tourney-meta-item">Drop {lg.dropWeeks} worst</span>
                            {lg.location && <span className="tourney-meta-item">📍 {lg.location}</span>}
                            {lg.startDate && <span className="tourney-meta-item">🗓 {lg.startDate}</span>}
                            {leagueClub && <span className="tourney-meta-item">🏢 {leagueClub.name}</span>}
                          </div>
                        </div>
                        <div className="tourney-header-actions">
                          <span className={`badge badge-status-${lg.status.toLowerCase()}`}>{lg.status}</span>
                          {!myReg && lg.status === "REGISTRATION" && (
                            isClubMember
                              ? <button className="btn-join" disabled={loading} onClick={() => onRegisterForLeague(lg.id)}>Register</button>
                              : <span className="badge badge-de">Members Only</span>
                          )}
                          {myReg && <span className="badge badge-status-active">Registered ✓</span>}
                        </div>
                      </div>
                      <div className="tourney-stats-row">
                        <span>{lg.registrations.length} player{lg.registrations.length !== 1 ? "s" : ""} registered</span>
                        <span>Week {lg.weeks.length} / {lg.durationWeeks}</span>
                        <span>{lg.playersPerCourt} per court</span>
                      </div>
                    </div>

                    {/* Organizer panel */}
                    {isOrganizer && (
                      <div className="organizer-panel">
                        <div className="organizer-panel-title">⚙ Organizer Controls</div>
                        <div className="organizer-controls">
                          {lg.status === "REGISTRATION" && lg.registrations.length >= lg.playersPerCourt && (
                            <>
                              <input
                                placeholder="Scheduled date/time (optional)"
                                value={weekScheduleInput}
                                onChange={e => setWeekScheduleInput(e.target.value)}
                                style={{ height: 32, padding: "0 10px", fontSize: "0.8rem", borderRadius: 8, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", color: "#fff", fontFamily: "inherit" }}
                              />
                              <button className="btn-sm btn-sm-generate" disabled={loading} onClick={onGenerateLeagueWeek}>🎲 Generate Week {lg.weeks.length + 1}</button>
                            </>
                          )}
                          {lg.status === "REGISTRATION" && <button className="btn-sm btn-sm-active" disabled={loading} onClick={() => onUpdateLeagueStatus("ACTIVE")}>Start Season</button>}
                          {lg.status === "ACTIVE" && (
                            <>
                              <input
                                placeholder="Scheduled date/time (optional)"
                                value={weekScheduleInput}
                                onChange={e => setWeekScheduleInput(e.target.value)}
                                style={{ height: 32, padding: "0 10px", fontSize: "0.8rem", borderRadius: 8, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", color: "#fff", fontFamily: "inherit" }}
                              />
                              <button className="btn-sm btn-sm-generate" disabled={loading} onClick={onGenerateLeagueWeek}>🎲 Generate Week {lg.weeks.length + 1}</button>
                              {lg.weeks.length >= lg.durationWeeks && <button className="btn-sm btn-sm-complete" disabled={loading} onClick={() => onUpdateLeagueStatus("COMPLETED")}>End Season</button>}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="sub-tab-bar">
                      <button className={`sub-tab-btn${leagueDetailTab === "overview" ? " active" : ""}`} onClick={() => setLeagueDetailTab("overview")}>Players</button>
                      <button className={`sub-tab-btn${leagueDetailTab === "schedule" ? " active" : ""}`} onClick={() => setLeagueDetailTab("schedule")}>Schedule</button>
                      <button className={`sub-tab-btn${leagueDetailTab === "standings" ? " active" : ""}`} onClick={() => { setLeagueDetailTab("standings"); loadLeagueStandings(); }}>Standings</button>
                    </div>

                    {/* Players tab */}
                    {leagueDetailTab === "overview" && (
                      <div className="glass-card">
                        <h3 className="card-title">Registered Players <span className="count-badge">{lg.registrations.length}</span></h3>
                        {lg.registrations.length === 0
                          ? <p className="empty-state">No players registered yet.</p>
                          : <ul className="entity-list">
                              {lg.registrations.map(r => (
                                <li key={r.id}>
                                  <Avatar name={r.playerName} size={28} />
                                  <div style={{ flex: 1 }}>
                                    <div className="entity-name">{r.playerName}</div>
                                    {r.partnerName && <div className="entity-sub">Partner: {r.partnerName}</div>}
                                  </div>
                                  {r.playerId === user.id && <span className="badge badge-rec" style={{ fontSize: "0.62rem" }}>You</span>}
                                </li>
                              ))}
                            </ul>
                        }
                      </div>
                    )}

                    {/* Schedule tab */}
                    {leagueDetailTab === "schedule" && (
                      <div className="glass-card">
                        <h3 className="card-title">Weekly Schedule</h3>
                        {lg.weeks.length === 0
                          ? <p className="empty-state">No weeks generated yet.</p>
                          : <ul className="entity-list" style={{ marginBottom: 16 }}>
                              {lg.weeks.map(w => (
                                <li key={w.id} className="clickable-row" onClick={() => loadWeekResults(w.id)}>
                                  <div style={{ flex: 1 }}>
                                    <div className="entity-name">Week {w.weekNumber}</div>
                                    {w.scheduledAt && <div className="entity-sub">{w.scheduledAt}</div>}
                                  </div>
                                  <span className={`badge ${w.status === "COMPLETED" ? "badge-status-active" : "badge-rr"}`}>{w.status}</span>
                                  <span className="entity-chevron">›</span>
                                </li>
                              ))}
                            </ul>
                        }

                        {/* Week results detail */}
                        {selectedWeekId && weekResults.length > 0 && (() => {
                          const courts = [...new Set(weekResults.map(r => r.court))].sort();
                          return (
                            <div>
                              <div className="invite-section-divider"><span>Court Assignments & Scores</span></div>
                              {courts.map(court => (
                                <div key={court} style={{ marginBottom: 16 }}>
                                  <div style={{ fontWeight: 700, color: "#b8acff", marginBottom: 8 }}>Court {court}</div>
                                  <ul className="entity-list">
                                    {weekResults.filter(r => r.court === court).map(r => (
                                      <li key={r.id}>
                                        <Avatar name={r.playerName} size={28} />
                                        <div style={{ flex: 1 }}>
                                          <div className="entity-name">{r.playerName}</div>
                                          {editingResultId !== r.id && <div className="entity-sub">W: {r.wins} · Pts: {r.pointsScored}-{r.pointsAgainst}</div>}
                                        </div>
                                        {isOrganizer && editingResultId === r.id && (
                                          <span className="score-input-row">
                                            <input className="score-box" placeholder="W" value={resultInput.wins} onChange={e => setResultInput({ ...resultInput, wins: e.target.value })} style={{ width: 36 }} />
                                            <input className="score-box" placeholder="Pts+" value={resultInput.pointsScored} onChange={e => setResultInput({ ...resultInput, pointsScored: e.target.value })} style={{ width: 48 }} />
                                            <input className="score-box" placeholder="Pts-" value={resultInput.pointsAgainst} onChange={e => setResultInput({ ...resultInput, pointsAgainst: e.target.value })} style={{ width: 48 }} />
                                            <button className="btn-sm btn-sm-active" onClick={() => onSaveWeekResult(r.id)}>Save</button>
                                            <button className="btn-sm" onClick={() => setEditingResultId(null)}>✕</button>
                                          </span>
                                        )}
                                        {isOrganizer && editingResultId !== r.id && (
                                          <button className="btn-sm" onClick={() => { setEditingResultId(r.id); setResultInput({ wins: r.wins.toString(), pointsScored: r.pointsScored.toString(), pointsAgainst: r.pointsAgainst.toString() }); }}>Edit</button>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Standings tab */}
                    {leagueDetailTab === "standings" && (
                      <div className="glass-card">
                        <h3 className="card-title">Season Standings</h3>
                        <p className="entity-sub" style={{ marginBottom: 12 }}>Dropping {lg.dropWeeks} lowest week{lg.dropWeeks !== 1 ? "s" : ""}.</p>
                        {leagueStandings.length === 0
                          ? <p className="empty-state">No completed weeks yet.</p>
                          : (
                            <table className="standings-table">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Player</th>
                                  <th>Wins</th>
                                  <th>Pts</th>
                                  <th>Weeks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {leagueStandings.map((s, i) => (
                                  <tr key={s.playerId} className={s.playerId === user.id ? "standings-my-row" : ""}>
                                    <td>{i + 1}</td>
                                    <td>{s.playerName}</td>
                                    <td style={{ fontWeight: 700 }}>{s.totalWins}</td>
                                    <td>{s.totalPoints}</td>
                                    <td>{s.weeksPlayed}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )
                        }
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <div className="content-grid">
                {/* Create league form */}
                <div className="glass-card">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                    <h3 className="card-title" style={{ margin: 0 }}>Create a League</h3>
                    <button type="button" className="create-toggle-btn"
                      onClick={() => setShowCreateLeague(v => !v)}>
                      {showCreateLeague ? "✕ Cancel" : "+ New"}
                    </button>
                  </div>
                  <form onSubmit={onCreateLeague} className={`stack-form create-league-form${showCreateLeague ? " open" : ""}`}>
                    <div className="field">
                      <label>League Name</label>
                      <input placeholder="e.g. Tuesday Night Ladder" value={leagueInput.name} onChange={e => setLeagueInput({ ...leagueInput, name: e.target.value })} />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Format</label>
                        <select value={leagueInput.format} onChange={e => setLeagueInput({ ...leagueInput, format: e.target.value as "ROTATIONAL" | "FIXED_PARTNER" })}>
                          <option value="ROTATIONAL">Rotational (individual)</option>
                          <option value="FIXED_PARTNER">Fixed Partner</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Weeks</label>
                        <input type="number" min={1} max={52} value={leagueInput.durationWeeks} onChange={e => setLeagueInput({ ...leagueInput, durationWeeks: e.target.value })} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Drop Weeks</label>
                        <input type="number" min={0} max={10} value={leagueInput.dropWeeks} onChange={e => setLeagueInput({ ...leagueInput, dropWeeks: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Players / Court</label>
                        <input type="number" min={2} max={8} value={leagueInput.playersPerCourt} onChange={e => setLeagueInput({ ...leagueInput, playersPerCourt: e.target.value })} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Skill Level</label>
                        <input placeholder="e.g. 3.0-4.0" value={leagueInput.skillLevel} onChange={e => setLeagueInput({ ...leagueInput, skillLevel: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Location</label>
                        <input placeholder="Facility / city" value={leagueInput.location} onChange={e => setLeagueInput({ ...leagueInput, location: e.target.value })} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label>Start Date</label>
                        <input placeholder="e.g. 2025-09-02" value={leagueInput.startDate} onChange={e => setLeagueInput({ ...leagueInput, startDate: e.target.value })} />
                      </div>
                      <div className="field">
                        <label>Club (optional)</label>
                        <select value={leagueInput.clubId} onChange={e => setLeagueInput({ ...leagueInput, clubId: e.target.value })}>
                          <option value="">— Public league —</option>
                          {clubs.filter(c => c.createdBy === user.id).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>Description</label>
                      <input placeholder="Optional details…" value={leagueInput.description} onChange={e => setLeagueInput({ ...leagueInput, description: e.target.value })} />
                    </div>
                    <button type="submit" className="btn-primary" disabled={loading}>Create League</button>
                  </form>
                </div>

                {/* League list */}
                <div className="glass-card">
                  <h3 className="card-title">All Leagues <span className="count-badge">{leagues.length}</span></h3>
                  {leagues.length === 0
                    ? <p className="empty-state">No leagues yet — create one!</p>
                    : <ul className="entity-list">
                        {leagues.map(lg => {
                          const lgClub = lg.clubId ? clubs.find(c => c.id === lg.clubId) : null;
                          const isMember = !lg.clubId || clubs.find(c => c.id === lg.clubId)?.memberIds.includes(user.id);
                          return (
                            <li key={lg.id} className="clickable-row" onClick={() => selectLeague(lg.id)}>
                              <div className="entity-icon trophy-icon" style={{ background: "rgba(251,191,36,.12)" }}>📅</div>
                              <div style={{ flex: 1 }}>
                                <div className="entity-name">{lg.name}</div>
                                <div className="entity-sub">
                                  {lg.format === "ROTATIONAL" ? "Rotational" : "Fixed Partner"} · {lg.durationWeeks}w
                                  {lg.location ? ` · ${lg.location}` : ""}
                                  {lgClub ? ` · 🏢 ${lgClub.name}` : ""}
                                </div>
                              </div>
                              {!isMember && <span className="badge badge-de" style={{ fontSize: "0.62rem" }}>Members Only</span>}
                              <span className={`badge badge-status-${lg.status.toLowerCase()}`}>{lg.status}</span>
                              <span className="entity-chevron">›</span>
                            </li>
                          );
                        })}
                      </ul>
                  }
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom navigation — visible on mobile/tablet only */}
      <nav className="bottom-nav" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`bottom-nav-btn${activeTab === tab.id ? " active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.emoji}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
