import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:4000";

type User        = { id: string; name: string; email?: string; phone?: string };
type Club        = { id: string; name: string; memberIds: string[] };
type ClubDetail  = Club & { members: User[]; pendingInviteUserIds: string[] };
type ClubInvite  = { id: string; clubId: string; clubName: string; invitedByName: string };
type Game        = { id: string; type: string; format: string; score: string };
type Tournament  = { id: string; name: string; eventType: string; format: string; skillLevel?: string; location?: string; startDate?: string; participantIds: string[]; status: string };
type TournamentRegistration = { id: string; playerId: string; playerName: string; partnerId?: string; partnerName?: string; status: string };
type TournamentMatch = { id: string; roundNumber: number; matchNumber: number; team1Ids: string[]; team2Ids: string[]; scoreTeam1?: number; scoreTeam2?: number; winnerIds?: string[]; status: string };
type TournamentDetail = Tournament & { createdBy: string; ageBracket: string; maxTeams?: number; description?: string; registrations: TournamentRegistration[]; matches: TournamentMatch[] };
type TournamentPartnerInvite = { id: string; tournamentId: string; tournamentName: string; eventType: string; inviterName: string };
type Tab        = "home" | "buddies" | "clubs" | "games" | "tournaments";

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "home",        icon: "⌂",  label: "Home"    },
  { id: "buddies",     icon: "👥", label: "Buddies"  },
  { id: "clubs",       icon: "🏢", label: "Clubs"    },
  { id: "games",       icon: "🏓", label: "Games"    },
  { id: "tournaments", icon: "🏆", label: "Events"   },
];

function computeMobileStandings(matches: TournamentMatch[], registrations: TournamentRegistration[]) {
  const standings = new Map<string, { names: string; wins: number; losses: number }>();
  const processed = new Set<string>();
  for (const reg of registrations) {
    if (reg.status !== "CONFIRMED" || processed.has(reg.playerId)) continue;
    processed.add(reg.playerId);
    if (reg.partnerId) processed.add(reg.partnerId);
    const key = [reg.playerId, reg.partnerId].filter(Boolean).sort().join("+");
    standings.set(key, { names: reg.partnerId ? `${reg.playerName} & ${reg.partnerName ?? "?"}` : reg.playerName, wins: 0, losses: 0 });
  }
  for (const m of matches) {
    if (m.status !== "CONFIRMED" || !m.winnerIds?.length) continue;
    const k1 = [...m.team1Ids].sort().join("+"), k2 = [...m.team2Ids].sort().join("+"), wk = [...m.winnerIds].sort().join("+");
    const t1 = standings.get(k1), t2 = standings.get(k2);
    if (!t1 || !t2) continue;
    if (wk === k1) { t1.wins++; t2.losses++; } else { t2.wins++; t1.losses++; }
  }
  return [...standings.values()].sort((a, b) => b.wins - a.wins);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  return res.json() as Promise<T>;
}

function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
}

function SegPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt}
          style={[s.segItem, value === opt && s.segItemActive]}
          onPress={() => onChange(opt)}
          activeOpacity={0.75}
        >
          <Text style={[s.segText, value === opt && s.segTextActive]}>
            {opt.charAt(0) + opt.slice(1).toLowerCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function App() {
  // Auth
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName]         = useState("");
  const [contact, setContact]   = useState("");
  const [password, setPassword] = useState("");

  // Session
  const [user, setUser]         = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  // Data
  const [buddies, setBuddies]         = useState<User[]>([]);
  const [clubs, setClubs]             = useState<Club[]>([]);
  const [clubInvites, setClubInvites] = useState<ClubInvite[]>([]);
  const [games, setGames]             = useState<Game[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  // Club detail
  const [selectedClub, setSelectedClub]         = useState<ClubDetail | null>(null);
  const [clubInviteQuery, setClubInviteQuery]   = useState("");
  const [clubInviteResults, setCIResults]       = useState<User[]>([]);
  const [ciSearching, setCISearching]           = useState(false);
  const [invitingId, setInvitingId]             = useState<string | null>(null);
  const [pendingInviteIds, setPendingInviteIds] = useState<Set<string>>(new Set());
  const ciTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Buddy search
  const [buddyQuery, setBuddyQuery]       = useState("");
  const [buddyResults, setBuddyResults]   = useState<User[]>([]);
  const [searching, setSearching]         = useState(false);
  const [addingId, setAddingId]           = useState<string | null>(null);
  const [inviteContact, setInviteContact] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forms
  const [clubName, setClubName]       = useState("");
  const [gameType, setGameType]       = useState<"REC" | "DUPR">("REC");
  const [gameFormat, setGameFormat]   = useState<"SINGLES" | "DOUBLES" | "MIXED">("DOUBLES");
  const [gameScore, setGameScore]     = useState("");
  const [tourneyName, setTourneyName] = useState("");
  const [tourneyFmt, setTourneyFmt]   = useState<"SINGLES" | "DOUBLES" | "MIXED">("DOUBLES");
  const [tourneyFormat, setTourneyFormat] = useState<"ROUND_ROBIN" | "DOUBLE_ELIMINATION" | "WATERFALL">("ROUND_ROBIN");
  const [tourneySkill, setTourneySkill] = useState("OPEN");
  const [tourneyLocation, setTourneyLocation] = useState("");
  const [tourneyDate, setTourneyDate] = useState("");

  // Tournament detail
  const [selectedTournament, setSelectedTournament] = useState<TournamentDetail | null>(null);
  const [tourneyTab, setTourneyTab] = useState<"players" | "schedule" | "standings">("players");
  const [partnerInvites, setPartnerInvites] = useState<TournamentPartnerInvite[]>([]);
  const [reportingMatchId, setReportingMatchId] = useState<string | null>(null);
  const [scoreS1, setScoreS1] = useState("");
  const [scoreS2, setScoreS2] = useState("");

  // ── helpers ─────────────────────────────────────────────────────────────────
  async function run(fn: () => Promise<void>) {
    setError(null);
    setLoading(true);
    try { await fn(); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function refreshAll(uid: string) {
    const [c, g, t, b, inv, pi] = await Promise.all([
      apiFetch<{ clubs: Club[] }>("/clubs"),
      apiFetch<{ games: Game[] }>("/games"),
      apiFetch<{ tournaments: Tournament[] }>("/tournaments"),
      apiFetch<{ buddies: User[] }>(`/buddies/${uid}`),
      apiFetch<{ invites: ClubInvite[] }>(`/club-invites/${uid}`),
      apiFetch<{ invites: TournamentPartnerInvite[] }>(`/tournament-partner-invites/${uid}`),
    ]);
    setClubs(c.clubs);
    setGames(g.games);
    setTournaments(t.tournaments);
    setBuddies(b.buddies);
    setClubInvites(inv.invites);
    setPartnerInvites(pi.invites);
  }

  async function openTournament(id: string) {
    try {
      const res = await apiFetch<{ tournament: TournamentDetail }>(`/tournaments/${id}`);
      setSelectedTournament(res.tournament);
      setTourneyTab("players");
    } catch (e) { setError((e as Error).message); }
  }

  async function registerForTournament(id: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/tournaments/${id}/register`, { method: "POST", body: JSON.stringify({ userId: user.id }) });
      const res = await apiFetch<{ tournament: TournamentDetail }>(`/tournaments/${id}`);
      setSelectedTournament(res.tournament);
      await refreshAll(user.id);
    });
  }

  async function acceptPartnerInvite(inviteId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/tournament-partner-invites/${inviteId}/accept`, { method: "POST", body: JSON.stringify({ userId: user.id }) });
      await refreshAll(user.id);
    });
  }

  async function declinePartnerInvite(inviteId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/tournament-partner-invites/${inviteId}/decline`, { method: "POST" });
      await refreshAll(user.id);
    });
  }

  async function generateSchedule(id: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/tournaments/${id}/generate-schedule`, { method: "POST", body: JSON.stringify({ organizerId: user.id }) });
      const res = await apiFetch<{ tournament: TournamentDetail }>(`/tournaments/${id}`);
      setSelectedTournament(res.tournament);
    });
  }

  async function reportScore(matchId: string) {
    if (!user) return;
    const s1 = parseInt(scoreS1), s2 = parseInt(scoreS2);
    if (isNaN(s1) || isNaN(s2)) { setError("Enter valid scores."); return; }
    await run(async () => {
      await apiFetch(`/tournament-matches/${matchId}/report`, { method: "POST", body: JSON.stringify({ reportedBy: user.id, scoreTeam1: s1, scoreTeam2: s2, scoreRaw: `${s1}-${s2}` }) });
      setReportingMatchId(null); setScoreS1(""); setScoreS2("");
      if (selectedTournament) {
        const res = await apiFetch<{ tournament: TournamentDetail }>(`/tournaments/${selectedTournament.id}`);
        setSelectedTournament(res.tournament);
      }
    });
  }

  async function confirmScore(matchId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/tournament-matches/${matchId}/confirm`, { method: "POST", body: JSON.stringify({ confirmedBy: user.id }) });
      if (selectedTournament) {
        const res = await apiFetch<{ tournament: TournamentDetail }>(`/tournaments/${selectedTournament.id}`);
        setSelectedTournament(res.tournament);
      }
    });
  }

  // Debounced search for club invite
  useEffect(() => {
    if (ciTimer.current) clearTimeout(ciTimer.current);
    const q = clubInviteQuery.trim();
    if (q.length < 2) { setCIResults([]); return; }
    ciTimer.current = setTimeout(async () => {
      setCISearching(true);
      try {
        const res = await apiFetch<{ users: User[] }>(
          `/users/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(user?.id ?? "")}`
        );
        setCIResults(res.users);
      } catch { setCIResults([]); }
      finally { setCISearching(false); }
    }, 350);
    return () => { if (ciTimer.current) clearTimeout(ciTimer.current); };
  }, [clubInviteQuery]);

  useEffect(() => {
    setClubInviteQuery(""); setCIResults([]);
    if (selectedClub) setPendingInviteIds(new Set(selectedClub.pendingInviteUserIds));
    else setPendingInviteIds(new Set());
  }, [selectedClub?.id]);

  async function openClub(clubId: string) {
    try {
      const res = await apiFetch<{ club: ClubDetail }>(`/clubs/${clubId}`);
      setSelectedClub(res.club);
    } catch (e) { setError((e as Error).message); }
  }

  async function joinClub(clubId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/clubs/${clubId}/join`, { method: "POST", body: JSON.stringify({ userId: user.id }) });
      const res = await apiFetch<{ club: ClubDetail }>(`/clubs/${clubId}`);
      setSelectedClub(res.club);
      await refreshAll(user.id);
    });
  }

  async function inviteToClub(clubId: string, targetUserId: string) {
    if (!user) return;
    setInvitingId(targetUserId);
    try {
      await apiFetch(`/clubs/${clubId}/invite`, {
        method: "POST",
        body: JSON.stringify({ invitedBy: user.id, userId: targetUserId }),
      });
      setPendingInviteIds(prev => new Set([...prev, targetUserId]));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.includes("already")) setPendingInviteIds(prev => new Set([...prev, targetUserId]));
      else setError(msg);
    } finally { setInvitingId(null); }
  }

  async function acceptInvite(inviteId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/club-invites/${inviteId}/accept`, { method: "POST" });
      await refreshAll(user.id);
    });
  }

  async function declineInvite(inviteId: string) {
    if (!user) return;
    await run(async () => {
      await apiFetch(`/club-invites/${inviteId}/decline`, { method: "POST" });
      await refreshAll(user.id);
    });
  }

  function contactFields() {
    const isPhone = /^[+\d]/.test(contact);
    return isPhone ? { phone: contact } : { email: contact };
  }

  // Debounced player search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = buddyQuery.trim();
    if (q.length < 2) { setBuddyResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ users: User[] }>(
          `/users/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(user?.id ?? "")}`
        );
        setBuddyResults(res.users);
      } catch { setBuddyResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [buddyQuery]);

  async function addBuddyById(buddyId: string) {
    if (!user) return;
    setAddingId(buddyId);
    try {
      await apiFetch("/buddies/add", {
        method: "POST",
        body: JSON.stringify({ userId: user.id, buddyId }),
      });
      await refreshAll(user.id);
      setBuddyResults(prev => prev.filter(u => u.id !== buddyId));
    } catch (e) { setError((e as Error).message); }
    finally { setAddingId(null); }
  }

  // ── auth actions ─────────────────────────────────────────────────────────────
  async function login() {
    await run(async () => {
      const r = await apiFetch<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...contactFields(), password }),
      });
      setUser(r.user);
      await refreshAll(r.user.id);
    });
  }

  async function register() {
    if (!name.trim()) { setError("Name is required."); return; }
    await run(async () => {
      const r = await apiFetch<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, ...contactFields(), password }),
      });
      setUser(r.user);
      await refreshAll(r.user.id);
    });
  }

  // ── dashboard actions ────────────────────────────────────────────────────────
  async function inviteBuddy() {
    if (!user || !inviteContact.trim()) return;
    await run(async () => {
      const isPhone = /^[+\d]/.test(inviteContact);
      await apiFetch("/buddies/add", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          ...(isPhone ? { buddyPhone: inviteContact } : { buddyEmail: inviteContact }),
        }),
      });
      setInviteContact("");
      await refreshAll(user.id);
    });
  }

  async function createClub() {
    if (!user || !clubName.trim()) return;
    await run(async () => {
      await apiFetch("/clubs", {
        method: "POST",
        body: JSON.stringify({ createdBy: user.id, name: clubName }),
      });
      setClubName("");
      await refreshAll(user.id);
    });
  }

  async function createGame() {
    if (!user) return;
    await run(async () => {
      await apiFetch("/games", {
        method: "POST",
        body: JSON.stringify({
          createdBy: user.id,
          type: gameType,
          format: gameFormat,
          score: gameScore,
          participantIds: [user.id],
        }),
      });
      setGameScore("");
      await refreshAll(user.id);
    });
  }

  async function createTournament() {
    if (!user || !tourneyName.trim()) return;
    await run(async () => {
      await apiFetch("/tournaments", {
        method: "POST",
        body: JSON.stringify({
          createdBy: user.id,
          name: tourneyName,
          eventType: tourneyFmt,
          format: tourneyFormat,
          location: tourneyLocation || undefined,
        }),
      });
      setTourneyName(""); setTourneyLocation("");
      await refreshAll(user.id);
    });
  }

  // ── AUTH SCREEN ──────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={s.authScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.authBrand}>🥒 GoPickle</Text>
            <Text style={s.authTagline}>
              {authMode === "login" ? "Welcome back" : "Create your account"}
            </Text>
            <Text style={s.authSub}>
              {authMode === "login"
                ? "Sign in to continue"
                : "Join the pickleball community"}
            </Text>

            <View style={s.authCard}>
              {authMode === "register" && (
                <View style={s.field}>
                  <Text style={s.label}>FULL NAME</Text>
                  <TextInput
                    style={s.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="e.g. Alex Rivera"
                    placeholderTextColor="#3e4e7a"
                  />
                </View>
              )}

              <View style={s.field}>
                <Text style={s.label}>EMAIL OR PHONE</Text>
                <TextInput
                  style={s.input}
                  value={contact}
                  onChangeText={setContact}
                  placeholder="you@example.com or +1 555…"
                  placeholderTextColor="#3e4e7a"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>

              <View style={s.field}>
                <Text style={s.label}>PASSWORD</Text>
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="#3e4e7a"
                  secureTextEntry
                />
              </View>

              {error ? (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[s.btnPrimary, loading && s.btnDisabled]}
                onPress={authMode === "login" ? login : register}
                disabled={loading}
                activeOpacity={0.84}
              >
                <Text style={s.btnPrimaryText}>
                  {loading
                    ? "Please wait…"
                    : authMode === "login"
                    ? "Sign In"
                    : "Create Account"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setAuthMode(authMode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                <Text style={s.authSwitch}>
                  {authMode === "login"
                    ? "New to GoPickle? "
                    : "Already have an account? "}
                  <Text style={s.authSwitchLink}>
                    {authMode === "login" ? "Create an account" : "Sign in"}
                  </Text>
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── TAB CONTENT ──────────────────────────────────────────────────────────────
  function renderContent() {
    switch (activeTab) {
      // HOME
      case "home":
        return (
          <View>
            <View style={s.greetRow}>
              <Avatar name={user!.name} size={50} />
              <View style={{ flex: 1 }}>
                <Text style={s.greetName}>Hey, {user!.name.split(" ")[0]} 👋</Text>
                <Text style={s.greetSub}>{user!.email ?? user!.phone}</Text>
              </View>
              <TouchableOpacity style={s.signOutBtn} onPress={() => setUser(null)}>
                <Text style={s.signOutText}>Sign out</Text>
              </TouchableOpacity>
            </View>

            <View style={s.statsGrid}>
              {([
                { label: "Buddies",  value: buddies.length,     icon: "👥", color: "#ff4d8d" },
                { label: "Clubs",    value: clubs.length,       icon: "🏢", color: "#7c6bff" },
                { label: "Games",    value: games.length,       icon: "🏓", color: "#22c55e" },
                { label: "Events",   value: tournaments.length, icon: "🏆", color: "#f59e0b" },
              ] as const).map(item => (
                <View key={item.label} style={s.statCard}>
                  <Text style={s.statIcon}>{item.icon}</Text>
                  <Text style={[s.statValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={s.statLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        );

      // BUDDIES
      case "buddies":
        return (
          <View>
            {/* Search card */}
            <View style={s.card}>
              <Text style={s.cardTitle}>Find Players</Text>

              {/* Search input */}
              <View style={s.searchWrap}>
                <Text style={s.searchIconTxt}>🔍</Text>
                <TextInput
                  style={s.searchInput}
                  value={buddyQuery}
                  onChangeText={setBuddyQuery}
                  placeholder="Search by name, email or phone…"
                  placeholderTextColor="#3e4e7a"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {searching && <Text style={s.spinnerTxt}>⟳</Text>}
              </View>

              {/* Search results */}
              {buddyQuery.trim().length >= 2 && (
                <View style={{ gap: 6, marginBottom: 4 }}>
                  {!searching && buddyResults.length === 0 && (
                    <Text style={s.emptyState}>No players found.</Text>
                  )}
                  {buddyResults.map(u => {
                    const already = buddies.some(b => b.id === u.id);
                    return (
                      <View key={u.id} style={s.searchRow}>
                        <Avatar name={u.name} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.itemName}>{u.name}</Text>
                          <Text style={s.itemSub}>{u.email ?? u.phone}</Text>
                        </View>
                        {already
                          ? <View style={s.addedBadge}><Text style={s.addedBadgeText}>Added</Text></View>
                          : (
                            <TouchableOpacity
                              style={[s.addIconBtn, addingId === u.id && s.btnDisabled]}
                              onPress={() => addBuddyById(u.id)}
                              disabled={addingId === u.id}
                              activeOpacity={0.8}
                            >
                              <Text style={s.addIconText}>{addingId === u.id ? "…" : "+"}</Text>
                            </TouchableOpacity>
                          )
                        }
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Invite divider */}
              <View style={s.dividerRow}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>invite by contact</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Invite input row */}
              <View style={s.inviteRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={inviteContact}
                  onChangeText={setInviteContact}
                  placeholder="Email or phone"
                  placeholderTextColor="#3e4e7a"
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={[s.inviteAddBtn, loading && s.btnDisabled]}
                  onPress={inviteBuddy}
                  disabled={loading}
                  activeOpacity={0.84}
                >
                  <Text style={s.inviteAddText}>+ Add</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={s.listHeading}>Your Buddies ({buddies.length})</Text>
            {buddies.length === 0
              ? <Text style={s.emptyState}>No buddies yet — search above!</Text>
              : buddies.map(b => (
                  <View key={b.id} style={s.listItem}>
                    <Avatar name={b.name} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{b.name}</Text>
                      <Text style={s.itemSub}>{b.email ?? b.phone}</Text>
                    </View>
                  </View>
                ))
            }
          </View>
        );

      // CLUBS
      case "clubs":
        // ── Club Detail view ──
        if (selectedClub) {
          const isMember = selectedClub.memberIds.includes(user!.id);
          return (
            <View>
              {/* Back */}
              <TouchableOpacity style={s.backBtn} onPress={() => setSelectedClub(null)} activeOpacity={0.7}>
                <Text style={s.backBtnText}>← All Clubs</Text>
              </TouchableOpacity>

              <View style={s.card}>
                <View style={s.clubDetailHeader}>
                  <Text style={[s.cardTitle, { flex: 1 }]}>{selectedClub.name}</Text>
                  {isMember
                    ? <View style={s.memberBadge}><Text style={s.memberBadgeText}>Member ✓</Text></View>
                    : (
                      <TouchableOpacity style={[s.joinBtn, loading && s.btnDisabled]} onPress={() => joinClub(selectedClub.id)} disabled={loading} activeOpacity={0.84}>
                        <Text style={s.joinBtnText}>Join Club</Text>
                      </TouchableOpacity>
                    )
                  }
                </View>

                {/* Member avatars */}
                <View style={s.memberAvatarRow}>
                  {selectedClub.members.slice(0, 6).map(m => (
                    <View key={m.id} style={s.memberAvatarWrap}>
                      <Avatar name={m.name} size={28} />
                    </View>
                  ))}
                  {selectedClub.memberIds.length > 6 && (
                    <View style={s.moreMembersChip}>
                      <Text style={s.moreMembersText}>+{selectedClub.memberIds.length - 6}</Text>
                    </View>
                  )}
                  <Text style={[s.itemSub, { marginLeft: 8 }]}>{selectedClub.memberIds.length} member{selectedClub.memberIds.length !== 1 ? "s" : ""}</Text>
                </View>

                {/* Invite divider */}
                <View style={s.dividerRow}>
                  <View style={s.dividerLine} />
                  <Text style={s.dividerText}>invite players</Text>
                  <View style={s.dividerLine} />
                </View>

                {/* Invite search */}
                <View style={s.searchWrap}>
                  <Text style={s.searchIconTxt}>🔍</Text>
                  <TextInput
                    style={s.searchInput}
                    value={clubInviteQuery}
                    onChangeText={setClubInviteQuery}
                    placeholder="Search by name, email or phone…"
                    placeholderTextColor="#3e4e7a"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {ciSearching && <Text style={s.spinnerTxt}>⟳</Text>}
                </View>

                {clubInviteQuery.trim().length >= 2 && (
                  <View style={{ gap: 6, marginTop: 6 }}>
                    {!ciSearching && clubInviteResults.length === 0 && (
                      <Text style={s.emptyState}>No players found.</Text>
                    )}
                    {clubInviteResults.map(u => {
                      const isMem     = selectedClub.memberIds.includes(u.id);
                      const isInvited = pendingInviteIds.has(u.id);
                      return (
                        <View key={u.id} style={s.searchRow}>
                          <Avatar name={u.name} size={34} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.itemName}>{u.name}</Text>
                            <Text style={s.itemSub}>{u.email ?? u.phone}</Text>
                          </View>
                          {isMem
                            ? <View style={s.addedBadge}><Text style={s.addedBadgeText}>Member</Text></View>
                            : isInvited
                            ? <View style={[s.addedBadge, s.invitedBadge]}><Text style={[s.addedBadgeText, s.invitedBadgeText]}>Invited</Text></View>
                            : (
                              <TouchableOpacity
                                style={[s.inviteIconBtn, invitingId === u.id && s.btnDisabled]}
                                onPress={() => inviteToClub(selectedClub.id, u.id)}
                                disabled={invitingId === u.id}
                                activeOpacity={0.8}
                              >
                                <Text style={s.inviteIconText}>{invitingId === u.id ? "…" : "✉"}</Text>
                              </TouchableOpacity>
                            )
                          }
                        </View>
                      );
                    })}
                  </View>
                )}
                {clubInviteQuery.trim().length < 2 && (
                  <Text style={[s.emptyState, { paddingVertical: 8 }]}>Type 2+ characters to search players.</Text>
                )}
              </View>
            </View>
          );
        }

        // ── Club list view ──
        return (
          <View>
            {/* Pending invites */}
            {clubInvites.length > 0 && (
              <View style={[s.card, { borderColor: "rgba(251,191,36,0.3)", marginBottom: 16 }]}>
                <Text style={s.cardTitle}>Club Invites ({clubInvites.length})</Text>
                {clubInvites.map(inv => (
                  <View key={inv.id} style={s.inviteItemRow}>
                    <Text style={s.listItemIcon}>🏢</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{inv.clubName}</Text>
                      <Text style={s.itemSub}>Invited by {inv.invitedByName}</Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity style={s.acceptBtn} onPress={() => acceptInvite(inv.id)} activeOpacity={0.85}>
                        <Text style={s.acceptBtnText}>Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.declineBtn} onPress={() => declineInvite(inv.id)} activeOpacity={0.85}>
                        <Text style={s.declineBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={s.card}>
              <Text style={s.cardTitle}>Create a Club</Text>
              <View style={s.field}>
                <Text style={s.label}>CLUB NAME</Text>
                <TextInput style={s.input} value={clubName} onChangeText={setClubName} placeholder="e.g. Downtown Picklers" placeholderTextColor="#3e4e7a" />
              </View>
              <TouchableOpacity style={[s.btnPrimary, loading && s.btnDisabled]} onPress={createClub} disabled={loading} activeOpacity={0.84}>
                <Text style={s.btnPrimaryText}>Create Club</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.listHeading}>All Clubs ({clubs.length})</Text>
            {clubs.length === 0
              ? <Text style={s.emptyState}>No clubs yet.</Text>
              : clubs.map(c => (
                  <TouchableOpacity key={c.id} style={s.listItem} onPress={() => openClub(c.id)} activeOpacity={0.75}>
                    <Text style={s.listItemIcon}>🏢</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{c.name}</Text>
                      <Text style={s.itemSub}>{c.memberIds.length} member{c.memberIds.length !== 1 ? "s" : ""}</Text>
                    </View>
                    {c.memberIds.includes(user!.id) && (
                      <View style={s.addedBadge}><Text style={s.addedBadgeText}>Member</Text></View>
                    )}
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                ))
            }
          </View>
        );

      // GAMES
      case "games":
        return (
          <View>
            <View style={s.card}>
              <Text style={s.cardTitle}>Log a Game</Text>
              <View style={s.field}>
                <Text style={s.label}>TYPE</Text>
                <SegPicker options={["REC", "DUPR"] as const} value={gameType} onChange={setGameType} />
              </View>
              <View style={s.field}>
                <Text style={s.label}>FORMAT</Text>
                <SegPicker options={["SINGLES", "DOUBLES", "MIXED"] as const} value={gameFormat} onChange={setGameFormat} />
              </View>
              <View style={s.field}>
                <Text style={s.label}>SCORE</Text>
                <TextInput style={s.input} value={gameScore} onChangeText={setGameScore} placeholder="e.g. 11-8, 11-9" placeholderTextColor="#3e4e7a" />
              </View>
              <TouchableOpacity style={[s.btnPrimary, loading && s.btnDisabled]} onPress={createGame} disabled={loading} activeOpacity={0.84}>
                <Text style={s.btnPrimaryText}>Submit Game</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.listHeading}>Game Log ({games.length})</Text>
            {games.length === 0
              ? <Text style={s.emptyState}>No games logged yet.</Text>
              : games.map(g => (
                  <View key={g.id} style={s.listItem}>
                    <Text style={s.listItemIcon}>🏓</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{g.type} · {g.format}</Text>
                      <Text style={s.itemSub}>{g.score}</Text>
                    </View>
                    <View style={[s.badge, g.type === "DUPR" ? s.badgeDupr : s.badgeRec]}>
                      <Text style={[s.badgeText, g.type === "DUPR" ? s.badgeDuprText : s.badgeRecText]}>{g.type}</Text>
                    </View>
                  </View>
                ))
            }
          </View>
        );

      // TOURNAMENTS
      case "tournaments": {
        if (selectedTournament) {
          const t = selectedTournament;
          const isOrg = t.createdBy === user!.id;
          const myReg = t.registrations.find(r => r.playerId === user!.id || r.partnerId === user!.id);
          const confirmed = t.registrations.filter(r => r.status === "CONFIRMED");
          const tn = (ids: string[]) => ids.map(id => {
            const r = t.registrations.find(r => r.playerId === id || r.partnerId === id);
            return r ? (r.playerId === id ? r.playerName : (r.partnerName ?? "?")) : id.slice(-4);
          }).join(" & ");

          return (
            <View>
              <TouchableOpacity style={s.backBtn} onPress={() => setSelectedTournament(null)} activeOpacity={0.7}>
                <Text style={s.backBtnText}>← All Tournaments</Text>
              </TouchableOpacity>

              <View style={s.card}>
                <View style={s.clubDetailHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardTitle, { marginBottom: 4 }]}>{t.name}</Text>
                    <Text style={s.itemSub}>
                      {t.format === "ROUND_ROBIN" ? "Round Robin" : t.format === "DOUBLE_ELIMINATION" ? "Double Elim." : "Waterfall"}
                      {" · "}{t.eventType}{t.skillLevel ? ` · ${t.skillLevel}` : ""}{t.location ? ` · ${t.location}` : ""}
                    </Text>
                  </View>
                  <View style={[s.badge, t.status === "ACTIVE" ? s.badgeRec : t.status === "COMPLETED" ? s.badgeDupr : s.badge]}>
                    <Text style={[s.badgeText, t.status === "ACTIVE" ? s.badgeRecText : t.status === "COMPLETED" ? s.badgeDuprText : s.badgeText]}>{t.status}</Text>
                  </View>
                </View>

                <Text style={[s.itemSub, { marginBottom: 6 }]}>{confirmed.length} teams · {t.matches.filter(m => m.status === "CONFIRMED").length}/{t.matches.length} matches done</Text>

                {!myReg && t.status === "PLANNED" && (
                  <TouchableOpacity style={[s.btnPrimary, loading && s.btnDisabled]} onPress={() => registerForTournament(t.id)} disabled={loading} activeOpacity={0.84}>
                    <Text style={s.btnPrimaryText}>Register</Text>
                  </TouchableOpacity>
                )}
                {myReg && <View style={s.memberBadge}><Text style={s.memberBadgeText}>Registered ✓</Text></View>}

                {isOrg && t.status === "PLANNED" && confirmed.length >= 2 && (
                  <TouchableOpacity style={[s.joinBtn, { marginTop: 8, backgroundColor: PURPLE }, loading && s.btnDisabled]} onPress={() => generateSchedule(t.id)} disabled={loading} activeOpacity={0.84}>
                    <Text style={s.joinBtnText}>🎲 Generate Schedule</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Sub-tabs */}
              <View style={s.seg}>
                {(["players", "schedule", "standings"] as const).map(tab => (
                  <TouchableOpacity key={tab} style={[s.segItem, tourneyTab === tab && s.segItemActive]} onPress={() => setTourneyTab(tab)} activeOpacity={0.8}>
                    <Text style={[s.segText, tourneyTab === tab && s.segTextActive]}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Players */}
              {tourneyTab === "players" && (
                <View style={{ marginTop: 12 }}>
                  {t.registrations.length === 0
                    ? <Text style={s.emptyState}>No registrations yet.</Text>
                    : t.registrations.map(reg => (
                        <View key={reg.id} style={[s.listItem, reg.status === "CONFIRMED" ? { borderLeftWidth: 2, borderLeftColor: "#4ade80" } : { borderLeftWidth: 2, borderLeftColor: "#fbbf24" }]}>
                          <Avatar name={reg.playerName} size={32} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.itemName}>{reg.playerName}{reg.partnerName ? ` & ${reg.partnerName}` : ""}</Text>
                            <Text style={s.itemSub}>{reg.status === "PENDING_PARTNER" ? "Awaiting partner" : "Confirmed"}</Text>
                          </View>
                        </View>
                      ))
                  }
                </View>
              )}

              {/* Schedule */}
              {tourneyTab === "schedule" && (
                <View style={{ marginTop: 12 }}>
                  {t.matches.length === 0
                    ? <Text style={s.emptyState}>{isOrg ? "Generate schedule above." : "Schedule not ready."}</Text>
                    : t.matches.map(m => {
                        const isRep = reportingMatchId === m.id;
                        const canReport = m.status !== "CONFIRMED" && (m.team1Ids.includes(user!.id) || m.team2Ids.includes(user!.id) || isOrg);
                        const canConf = isOrg && m.status === "PENDING_APPROVAL";
                        return (
                          <View key={m.id} style={[s.listItem, { flexWrap: "wrap" }]}>
                            <View style={{ flex: 1, minWidth: "60%" }}>
                              <Text style={s.itemName}>{tn(m.team1Ids)} <Text style={{ color: MUTED, fontWeight: "400" }}>vs</Text> {tn(m.team2Ids)}</Text>
                              {m.scoreTeam1 !== undefined && (
                                <Text style={[s.itemSub, { color: PINK, fontWeight: "700" }]}>{m.scoreTeam1} – {m.scoreTeam2}</Text>
                              )}
                            </View>
                            <View style={{ alignItems: "flex-end", gap: 6 }}>
                              <View style={[s.badge, m.status === "CONFIRMED" ? s.badgeRec : m.status === "PENDING_APPROVAL" ? s.badgeDupr : s.badge]}>
                                <Text style={[s.badgeText, m.status === "CONFIRMED" ? s.badgeRecText : m.status === "PENDING_APPROVAL" ? s.badgeDuprText : s.badgeText]}>
                                  {m.status === "PENDING_APPROVAL" ? "Pending" : m.status === "CONFIRMED" ? "Final" : "Sched."}
                                </Text>
                              </View>
                              {isRep ? (
                                <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                                  <TextInput style={[s.input, { width: 44, height: 34, textAlign: "center", paddingHorizontal: 4 }]} value={scoreS1} onChangeText={setScoreS1} keyboardType="number-pad" placeholder="11" placeholderTextColor="#3e4e7a" />
                                  <Text style={s.itemSub}>–</Text>
                                  <TextInput style={[s.input, { width: 44, height: 34, textAlign: "center", paddingHorizontal: 4 }]} value={scoreS2} onChangeText={setScoreS2} keyboardType="number-pad" placeholder="8" placeholderTextColor="#3e4e7a" />
                                  <TouchableOpacity style={s.acceptBtn} onPress={() => reportScore(m.id)} activeOpacity={0.85}><Text style={s.acceptBtnText}>✓</Text></TouchableOpacity>
                                  <TouchableOpacity style={s.declineBtn} onPress={() => { setReportingMatchId(null); setScoreS1(""); setScoreS2(""); }} activeOpacity={0.85}><Text style={s.declineBtnText}>✕</Text></TouchableOpacity>
                                </View>
                              ) : (
                                <View style={{ flexDirection: "row", gap: 4 }}>
                                  {canReport && <TouchableOpacity style={s.declineBtn} onPress={() => { setReportingMatchId(m.id); setScoreS1(m.scoreTeam1?.toString() ?? ""); setScoreS2(m.scoreTeam2?.toString() ?? ""); }} activeOpacity={0.85}><Text style={s.declineBtnText}>Score</Text></TouchableOpacity>}
                                  {canConf && <TouchableOpacity style={s.acceptBtn} onPress={() => confirmScore(m.id)} activeOpacity={0.85}><Text style={s.acceptBtnText}>Confirm</Text></TouchableOpacity>}
                                </View>
                              )}
                            </View>
                          </View>
                        );
                      })
                  }
                </View>
              )}

              {/* Standings */}
              {tourneyTab === "standings" && (
                <View style={{ marginTop: 12 }}>
                  <View style={[s.listItem, { backgroundColor: "rgba(255,255,255,0.055)" }]}>
                    <Text style={[s.itemSub, { width: 24, textAlign: "center" }]}>#</Text>
                    <Text style={[s.itemSub, { flex: 1 }]}>Team</Text>
                    <Text style={[s.itemSub, { width: 28, textAlign: "center" }]}>W</Text>
                    <Text style={[s.itemSub, { width: 28, textAlign: "center" }]}>L</Text>
                    <Text style={[s.itemSub, { width: 36, textAlign: "center" }]}>Pts</Text>
                  </View>
                  {(() => {
                    const standings = computeMobileStandings(t.matches, t.registrations);
                    return standings.length === 0
                      ? <Text style={s.emptyState}>No confirmed matches yet.</Text>
                      : standings.map((row, i) => (
                          <View key={i} style={s.listItem}>
                            <Text style={[s.itemName, { width: 24, textAlign: "center", color: i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : TEXT }]}>{i + 1}</Text>
                            <Text style={[s.itemName, { flex: 1 }]}>{row.names}</Text>
                            <Text style={[s.itemName, { width: 28, textAlign: "center", color: "#4ade80" }]}>{row.wins}</Text>
                            <Text style={[s.itemName, { width: 28, textAlign: "center", color: "#f87171" }]}>{row.losses}</Text>
                            <Text style={[s.itemName, { width: 36, textAlign: "center", color: PINK }]}>{row.wins * 2}</Text>
                          </View>
                        ));
                  })()}
                </View>
              )}
            </View>
          );
        }

        // Tournament list
        return (
          <View>
            {/* Partner invites */}
            {partnerInvites.length > 0 && (
              <View style={[s.card, { borderColor: "rgba(255,77,141,0.25)", marginBottom: 16 }]}>
                <Text style={s.cardTitle}>Partner Invites ({partnerInvites.length})</Text>
                {partnerInvites.map(inv => (
                  <View key={inv.id} style={s.inviteItemRow}>
                    <Text style={s.listItemIcon}>🏆</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{inv.tournamentName}</Text>
                      <Text style={s.itemSub}>{inv.eventType} · from {inv.inviterName}</Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <TouchableOpacity style={s.acceptBtn} onPress={() => acceptPartnerInvite(inv.id)} activeOpacity={0.85}><Text style={s.acceptBtnText}>Accept</Text></TouchableOpacity>
                      <TouchableOpacity style={s.declineBtn} onPress={() => declinePartnerInvite(inv.id)} activeOpacity={0.85}><Text style={s.declineBtnText}>Decline</Text></TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={s.card}>
              <Text style={s.cardTitle}>Create Tournament</Text>
              <View style={s.field}>
                <Text style={s.label}>NAME</Text>
                <TextInput style={s.input} value={tourneyName} onChangeText={setTourneyName} placeholder="e.g. Spring Open 2025" placeholderTextColor="#3e4e7a" />
              </View>
              <View style={s.field}>
                <Text style={s.label}>FORMAT</Text>
                <SegPicker options={["ROUND_ROBIN", "DOUBLE_ELIMINATION", "WATERFALL"] as const} value={tourneyFormat} onChange={setTourneyFormat} />
              </View>
              <View style={s.field}>
                <Text style={s.label}>EVENT TYPE</Text>
                <SegPicker options={["SINGLES", "DOUBLES", "MIXED"] as const} value={tourneyFmt} onChange={setTourneyFmt} />
              </View>
              <View style={s.field}>
                <Text style={s.label}>LOCATION</Text>
                <TextInput style={s.input} value={tourneyLocation} onChangeText={setTourneyLocation} placeholder="e.g. Riverside Courts" placeholderTextColor="#3e4e7a" />
              </View>
              <TouchableOpacity style={[s.btnPrimary, loading && s.btnDisabled]} onPress={createTournament} disabled={loading} activeOpacity={0.84}>
                <Text style={s.btnPrimaryText}>Create Tournament</Text>
              </TouchableOpacity>
            </View>

            <Text style={s.listHeading}>Tournaments ({tournaments.length})</Text>
            {tournaments.length === 0
              ? <Text style={s.emptyState}>No tournaments yet.</Text>
              : tournaments.map(t => (
                  <TouchableOpacity key={t.id} style={s.listItem} onPress={() => openTournament(t.id)} activeOpacity={0.75}>
                    <Text style={s.listItemIcon}>🏆</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{t.name}</Text>
                      <Text style={s.itemSub}>
                        {t.format === "ROUND_ROBIN" ? "Round Robin" : t.format === "DOUBLE_ELIMINATION" ? "Double Elim." : "Waterfall"}
                        {" · "}{t.eventType}{t.skillLevel ? ` · ${t.skillLevel}` : ""}{t.location ? ` · ${t.location}` : ""}
                      </Text>
                    </View>
                    <View style={[s.badge, t.status === "ACTIVE" ? s.badgeRec : s.badge]}>
                      <Text style={[s.badgeText, t.status === "ACTIVE" ? s.badgeRecText : s.badgeText]}>{t.status}</Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </TouchableOpacity>
                ))
            }
          </View>
        );
      }
    }
  }

  // ── DASHBOARD SHELL ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      {/* Top bar */}
      <View style={s.topbar}>
        <Text style={s.topbarTitle}>🥒 GoPickle</Text>
      </View>

      {/* Error banner */}
      {error ? (
        <TouchableOpacity style={s.errorBanner} onPress={() => setError(null)} activeOpacity={0.85}>
          <Text style={s.errorText}>{error}  ×</Text>
        </TouchableOpacity>
      ) : null}

      {/* Scrollable content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderContent()}
      </ScrollView>

      {/* Bottom tab bar */}
      <View style={s.bottomBar}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={s.bottomTab}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
            >
              <Text style={[s.tabIcon, active && s.tabIconActive]}>{tab.icon}</Text>
              <Text style={[s.tabLabel, active && s.tabLabelActive]}>{tab.label}</Text>
              {active && <View style={s.tabDot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// ── STYLES ───────────────────────────────────────────────────────────────────
const PINK   = "#ff4d8d";
const PURPLE = "#7c6bff";
const BG     = "#06091a";
const CARD   = "#0d1228";
const BORDER = "rgba(255,255,255,0.09)";
const MUTED  = "#7a8fc0";
const TEXT   = "#eef1ff";

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  // ── AUTH ──
  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    paddingTop: 48,
    paddingBottom: 48,
  },
  authBrand: {
    fontSize: 28,
    fontWeight: "800",
    color: TEXT,
    textAlign: "center",
    marginBottom: 10,
  },
  authTagline: {
    fontSize: 22,
    fontWeight: "800",
    color: TEXT,
    textAlign: "center",
    marginBottom: 4,
  },
  authSub: {
    fontSize: 14,
    color: MUTED,
    textAlign: "center",
    marginBottom: 28,
  },
  authCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 22,
    padding: 22,
    gap: 14,
  },
  authSwitch: {
    color: MUTED,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
  authSwitchLink: {
    color: PINK,
    fontWeight: "700",
  },

  // ── FIELDS ──
  field: { gap: 6 },
  label: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8896c4",
    letterSpacing: 0.8,
  },
  input: {
    height: 46,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 12,
    paddingHorizontal: 14,
    color: TEXT,
    fontSize: 15,
  },

  // ── BUTTONS ──
  btnPrimary: {
    height: 47,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PINK,
    // gradient approximated — RN needs expo-linear-gradient for true gradient
    shadowColor: PINK,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  btnDisabled: { opacity: 0.45 },
  btnPrimaryText: { color: "#fff", fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },

  // ── ERROR ──
  errorBox: {
    backgroundColor: "rgba(220,38,38,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.28)",
    borderRadius: 10,
    padding: 11,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "rgba(220,38,38,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.28)",
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: "#fca5a5", fontSize: 13 },

  // ── AVATAR ──
  avatar: {
    backgroundColor: PURPLE,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { color: "#fff", fontWeight: "800" },

  // ── TOPBAR ──
  topbar: {
    height: 52,
    backgroundColor: "rgba(6,9,26,0.92)",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  topbarTitle: { fontSize: 17, fontWeight: "800", color: TEXT },

  // ── HOME ──
  greetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 18,
  },
  greetName: { fontSize: 18, fontWeight: "800", color: TEXT },
  greetSub:  { fontSize: 12, color: MUTED, marginTop: 2 },
  signOutBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  signOutText: { fontSize: 11, fontWeight: "700", color: MUTED },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 8,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  statIcon:  { fontSize: 24 },
  statValue: { fontSize: 28, fontWeight: "800" },
  statLabel: { fontSize: 10, fontWeight: "700", color: MUTED, letterSpacing: 0.6, textTransform: "uppercase" },

  // ── CARDS ──
  card: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 18,
    padding: 18,
    gap: 12,
    marginBottom: 20,
  },
  cardTitle: { fontSize: 15, fontWeight: "800", color: TEXT },

  // ── LISTS ──
  listHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 10,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 13,
    padding: 12,
    marginBottom: 8,
  },
  listItemIcon: { fontSize: 20 },
  itemName: { fontSize: 14, fontWeight: "600", color: TEXT },
  itemSub:  { fontSize: 12, color: MUTED, marginTop: 2 },
  emptyState: { color: MUTED, fontSize: 13, textAlign: "center", paddingVertical: 24 },

  // ── SEG PICKER ──
  seg: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segItem: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  },
  segItemActive: { backgroundColor: PURPLE },
  segText:       { fontSize: 12, fontWeight: "600", color: MUTED },
  segTextActive: { color: "#fff", fontWeight: "700" },

  // ── BADGES ──
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.12)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
  },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#94a3b8", textTransform: "uppercase" },
  badgeRec:      { backgroundColor: "rgba(34,197,94,0.12)",  borderColor: "rgba(34,197,94,0.22)" },
  badgeRecText:  { color: "#4ade80" },
  badgeDupr:     { backgroundColor: "rgba(124,107,255,0.12)", borderColor: "rgba(124,107,255,0.28)" },
  badgeDuprText: { color: "#a99cff" },

  // ── BUDDY SEARCH ──
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    gap: 8,
    marginBottom: 10,
  },
  searchIconTxt: { fontSize: 14, opacity: 0.55 },
  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    height: "100%",
  },
  spinnerTxt: { color: MUTED, fontSize: 16 },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 10,
  },
  addIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PINK,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PINK,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  addIconText: { color: "#fff", fontSize: 18, fontWeight: "800", lineHeight: 20 },
  addedBadge: {
    backgroundColor: "rgba(34,197,94,0.12)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  addedBadgeText: { fontSize: 10, fontWeight: "700", color: "#4ade80" },

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { fontSize: 10, fontWeight: "700", color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },

  inviteRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  inviteAddBtn: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: PINK,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteAddText: { color: "#fff", fontWeight: "800", fontSize: 13 },

  // ── CLUB DETAIL ──
  backBtn: { marginBottom: 12 },
  backBtnText: { color: MUTED, fontSize: 13, fontWeight: "700" },

  clubDetailHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },

  joinBtn: {
    height: 32, paddingHorizontal: 14, borderRadius: 9,
    backgroundColor: PINK, alignItems: "center", justifyContent: "center",
  },
  joinBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  memberBadge: {
    backgroundColor: "rgba(34,197,94,0.12)", borderWidth: 1,
    borderColor: "rgba(34,197,94,0.22)", borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  memberBadgeText: { color: "#4ade80", fontSize: 11, fontWeight: "700" },

  memberAvatarRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 14 },
  memberAvatarWrap: { marginLeft: -4, borderRadius: 14, borderWidth: 2, borderColor: CARD },
  moreMembersChip: {
    width: 28, height: 28, borderRadius: 14, marginLeft: -4,
    backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 2, borderColor: CARD,
    alignItems: "center", justifyContent: "center",
  },
  moreMembersText: { color: MUTED, fontSize: 9, fontWeight: "700" },

  inviteIconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "rgba(124,107,255,0.18)", borderWidth: 1, borderColor: "rgba(124,107,255,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  inviteIconText: { color: "#b8acff", fontSize: 14 },

  invitedBadge: { backgroundColor: "rgba(251,191,36,0.12)", borderColor: "rgba(251,191,36,0.25)" },
  invitedBadgeText: { color: "#fbbf24" },

  // ── CLUB INVITES ──
  inviteItemRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  acceptBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7,
    backgroundColor: "rgba(34,197,94,0.14)", borderWidth: 1, borderColor: "rgba(34,197,94,0.28)",
  },
  acceptBtnText: { color: "#4ade80", fontSize: 11, fontWeight: "700" },
  declineBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7,
    backgroundColor: "rgba(255,80,80,0.1)", borderWidth: 1, borderColor: "rgba(255,80,80,0.25)",
  },
  declineBtnText: { color: "#f87171", fontSize: 11, fontWeight: "700" },

  chevron: { color: MUTED, fontSize: 18, fontWeight: "300" },

  // ── BOTTOM BAR ──
  bottomBar: {
    flexDirection: "row",
    backgroundColor: "rgba(6,9,26,0.96)",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingBottom: Platform.OS === "ios" ? 16 : 6,
    paddingTop: 6,
  },
  bottomTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    gap: 2,
    position: "relative",
  },
  tabIcon:        { fontSize: 18, opacity: 0.45 },
  tabIconActive:  { opacity: 1 },
  tabLabel:       { fontSize: 10, fontWeight: "600", color: MUTED },
  tabLabelActive: { color: TEXT, fontWeight: "700" },
  tabDot: {
    position: "absolute",
    top: 0,
    width: 18,
    height: 2,
    borderRadius: 2,
    backgroundColor: PINK,
  },
});
