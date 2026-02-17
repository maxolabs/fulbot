You are an expert product designer and full-stack engineer.
Help me design and build a simple but solid web app to manage weekly amateur football (soccer) matches with my friends.

### 1. Context

* We have a WhatsApp group called **“Fútbol lunes”** (we speak Spanish) where we organize a weekly 7-a-side match on Mondays.
* Every Sunday around 12:00 we open a list of **14 spots**. The first 14 people to sign up play on Monday.
* After we have 14 players, we manually create two teams of 7 (“dark shirts” vs “light shirts”), trying to balance them based on ability and positions.
* I want this process to be handled by a web app with a nice, simple UI.
* I’ll deploy on **Vercel**. Assume a modern stack (TypeScript + React/Next.js). Feel free to suggest a simple backend/data layer (e.g. Supabase, Neon, or Vercel Postgres) but keep the complexity low.

### 2. High-level goals

* Make it **easy to organize recurring matches** (mainly Mondays, but should support others).
* Let people **sign up quickly** from their phones (often coming from WhatsApp).
* Automatically generate **balanced teams** using an AI agent, with admin controls.
* Track **players, stats, and light gamification** over time.
* Support **multiple groups** (e.g. “Fútbol lunes”, “Fútbol jueves”) and “guest” players.

Design the data model, APIs, and UI flows accordingly.

---

### 3. Core entities & data model (first proposal)

Design tables/models for at least:

1. **User**

   * id
   * name
   * email
   * preferred language (`es`/`en`)
   * createdAt / updatedAt

2. **Player Profile**

   * id
   * userId (nullable for “guest” players)
   * displayName / nickname
   * preferredPositions (ordered list: e.g. ["ST", "LW", "CM"])
   * mainPosition
   * footedness: left / right / both
   * goalkeeperWillingness: 0–3 (0 = never, 3 = loves GK)
   * reliabilityScore (derived: sign-ups vs attendances, late cancels, etc.)
   * fitnessFlag or status (e.g. “ok”, “limited”, “injured”)
   * overallRating (aggregated 1–5 rating from matches)
   * stats summary: matchesPlayed, goals, assists, MVPs, cleanSheets, etc.
   * createdAt / updatedAt

3. **Group**

   * id
   * name (e.g. “Fútbol lunes”)
   * slug (for invite URLs)
   * description
   * defaultMatchDay / time
   * defaultMaxPlayers (e.g. 14)
   * timezone
   * createdByUserId
   * settings (JSON): language, notifications preferences, etc.
   * createdAt / updatedAt

4. **GroupMembership**

   * id
   * groupId
   * playerId
   * role: `admin` | `captain` | `member`
   * active (boolean)
   * joinedAt

5. **Match**

   * id
   * groupId
   * dateTime
   * location (text)
   * status: `draft` | `signup_open` | `full` | `teams_created` | `finished` | `cancelled`
   * maxPlayers (default from group, but overridable)
   * recurringPatternId (nullable) for recurring matches
   * aiInputSnapshot (JSON of data sent to AI for team generation)
   * createdAt / updatedAt

6. **MatchSignup**

   * id
   * matchId
   * playerId (or guestPlayerId)
   * status: `confirmed` | `waitlist` | `cancelled` | `did_not_show`
   * signUpTime
   * cancelTime (nullable)
   * isGuest (boolean)
   * positionPreferenceForThisMatch (optional override)
   * notes (e.g. “tocado, no puedo correr mucho”)

7. **Team**

   * id
   * matchId
   * name: `dark` | `light`
   * colorHex (for UI)
   * createdByUserId
   * createdAt / updatedAt

8. **TeamAssignment**

   * id
   * teamId
   * playerId (or guestPlayerId)
   * position (ST, CM, CB, GK, etc.)
   * orderIndex (for displaying formation)
   * source: `ai` | `manual`
   * createdAt / updatedAt

9. **GuestPlayer**

   * id
   * displayName
   * notes
   * createdByUserId
   * createdAt

10. **MatchRating**

    * id
    * matchId
    * voterPlayerId
    * ratedPlayerId
    * rating (1–5)
    * comment (optional)
    * createdAt

11. **MatchMVPVote**

    * id
    * matchId
    * voterPlayerId
    * candidatePlayerId
    * createdAt

12. **RuleSet / TeamingRule**

    * id
    * matchId (or groupId default)
    * type: e.g. `avoid_pair`, `force_pair`, `min_defenders_per_team`, `min_goalkeepers_per_team`
    * data (JSON):

      * For avoid pair: { playerIdA, playerIdB }
      * For force pair: { playerIdA, playerIdB }
    * createdByUserId

13. **WhatsAppIntegration / NotificationSettings** (can be simple at first)

    * id
    * groupId
    * webhook/connector configuration or a placeholder field
    * setting: sendSignupLinkOnMatchCreate (boolean)
    * setting: sendReminderBeforeMatch (hoursBefore)
    * createdAt / updatedAt

You can refine this model, but keep it simple and practical.

---

### 4. Key features & behaviors

Implement or at least scaffold these flows.

#### 4.1 Authentication & onboarding

* Email/password auth is enough for v1.
* User signs up, picks name and default language (Spanish by default).
* User can create a **Group** or be invited via a link.
* On invite, user is added as `member` + optionally a **Player Profile** is auto-created for them.

#### 4.2 Groups & roles

* Each group has:

  * Admins (can manage group settings, matches, players, rules, WhatsApp integration).
  * Captains (can manage teams for a match: regenerate teams, drag-and-drop players).
  * Members (can sign up, rate, vote, view stats).

* Support multiple groups per user.

#### 4.3 Match creation (recurring & one-off)

* Admin can:

  * Create a **recurring match** (e.g. “every Monday 21:00”), which auto-creates a match instance each week.
  * Create an **eventual match** on any date/time.

* When a new match is created for a group:

  * It starts with status `signup_open`.
  * It uses group defaults: maxPlayers (e.g. 14), location, time, etc.

* For recurring use case:

  * Auto-create the Monday match every Sunday at 12:00 (group setting).
  * Optionally auto-send a sign-up link to the WhatsApp group (see notifications).

#### 4.4 Sign-up list with waitlist and auto-replacement

* Each match has a **sign-up link** that can be shared (e.g. in WhatsApp).

* When a player opens the link:

  * If there are < maxPlayers confirmed, they become `confirmed`.
  * If full, they go to `waitlist`.

* If a confirmed player cancels:

  * First player in waitlist automatically moves to `confirmed`.
  * Notify the group via in-app notification (and WhatsApp if configured).

* Support adding **Guest players**:

  * Admin can quickly add a guest with just a name.
  * Guests can be added directly to confirmed or waitlist.

#### 4.5 AI-based team generation

* Once there are enough confirmed players (e.g. 14), admins/captains can click **“Generate teams”**.

* The app prepares an **AI input payload** that includes:

  * Match info (group, date).
  * List of confirmed players (including guests if possible) with:

    * playerId, name
    * preferredPositions
    * footedness
    * goalkeeperWillingness
    * overallRating / recent form
    * reliabilityScore
  * Group/match rules:

    * maxPlayersPerTeam (7)
    * formation preference per team (e.g. 2-3-1 or similar)
    * rules:

      * “avoid_pair” rules (don’t put player A and B in the same team).
      * “force_pair” rules (if you want to enforce them later).
      * minimum 1 natural GK per team.
      * minimum number of defenders per team, etc.
  * **Recent history**: data about the last N matches (e.g. last 3–5) to avoid repetitive team combinations:

    * which players were on dark vs light
    * teammates pairings to rotate.

* AI goal:

  * Produce **two balanced teams** (`dark` and `light`).
  * Respect hard rules (never violate avoid_pair, GK distributions).
  * Maximize fairness based on ratings & stats.
  * Try to rotate combinations so people don’t always play with the same group.
  * Output a clear JSON structure the app can directly map to team assignments.

* The UI should allow:

  * A **“Generate teams”** button (first call to AI).
  * A **“Redo”** button that requests a new proposal while still respecting constraints.
  * Manual override by admins via drag-and-drop of players between teams/positions.
    The underlying data (Team and TeamAssignment) should be updated accordingly.

#### 4.6 Lineup UI and shareable image

* For each match with teams:

  * Show two fields side-by-side like the provided drawing:

    * Left: **Dark team**.
    * Right: **Light team**.
  * Each player appears at a spot representing their position with:

    * short name / nickname
    * maybe shirt number in future.

* Add a **“Export image for WhatsApp”** button:

  * Generates a simple image (PNG) of both teams and names, clearly indicating dark vs light.
  * Ready to share in the WhatsApp group.

#### 4.7 Ratings, MVP & gamification

* After a match is finished (status `finished`):

  * Players get a request (non-mandatory) to:

    * Vote for **MVP** (top player of the match).
    * Optionally rate teammates (1–5) for that match.

      * Keep this positive / internal. Avoid any shaming UI.

* Use ratings to update:

  * Player’s overall rating and recent form.
  * MVP count per player.

* Gamification:

  * Simple **badges** for players, e.g.:

    * “Hat-trick hero” (3 goals in a match).
    * “Playmaker” (X assists).
    * “Ironman” (10 matches in a row).
    * “Safe hands” (clean sheet as GK).
  * Show badges on player profile and maybe a small badge in the lineup.

#### 4.8 Notifications & WhatsApp integration (conceptual)

* Don’t fully implement complex WhatsApp APIs yet, but design for:

  * On match creation (especially recurring Monday match):

    * Post an automated message to the group (or simulate with a copyable text) with:

      * date & time
      * location
      * sign-up link
      * required shirt colors.

  * Reminders:

    * X hours before the match, send:

      * “Hoy 21:00 – Fútbol lunes – remera oscura / clara según tu equipo.”

  * Notifications when:

    * a spot opens and someone from waitlist is promoted.
    * teams are generated.

* In the code, abstract this so later we can plug a real WhatsApp API or a webhook.

---

### 5. UX & screens

Design these main screens:

1. **Landing / Dashboard**

   * List of groups the user belongs to.
   * Shortcut to today’s or next match for each group.

2. **Group page**

   * Upcoming matches list.
   * Quick action: “Create match”.
   * List of players with basic stats and badges.
   * Settings (roles, WhatsApp integration, recurring match config).

3. **Match page**

   * Match details (date, time, location, status).
   * Sign-up list:

     * Confirmed players (up to maxPlayers).
     * Waitlist.
     * Button to sign up / cancel.
   * For admins:

     * Button to add guest player.
     * Button to generate teams / redo teams.
     * Rules editor (avoid_pair, etc.).
   * Once teams exist:

     * Lineup view (dark vs light).
     * Drag-and-drop to change teams or positions.
     * Export image button.

4. **Player profile page**

   * Avatar or initials, name, preferred positions, foot.
   * Stats: matches, goals, assists, MVPs, reliability.
   * Recent matches summary.
   * Badges.

5. **Ratings & MVP flow**

   * Simple dialog or page after match:

     * MVP selection.
     * Optional 1–5 rating per teammate (or at least for some).
   * Keep it quick and mobile-friendly.

6. **Settings**

   * Language (ES/EN).
   * Dark mode toggle.
   * Notification preferences.

Also ensure:

* Mobile-first responsive design.
* PWA support so it can be “installed” on phones and used like an app:

  * manifest.json, service worker, basic offline caching of core shell.

---

### 6. Non-functional & tech details

* Use **TypeScript**.
* Use **React or Next.js** (recommended) so I can deploy easily on Vercel.
* Use a simple backend:

  * Either:

    * hosted Postgres (Supabase/Neon/Vercel Postgres) + API routes, or
    * Supabase as backend + auth.
* Structure the code cleanly (components, hooks, services).
* For drag-and-drop, you can use a known library (e.g. react-beautiful-dnd or similar).
* Keep styling simple but clean (Tailwind is fine).
* Default language Spanish but support English via i18n setup.

---

### 7. What I want from you

1. Refine the data model and confirm or improve the schema.
2. Propose the overall architecture (frontend, backend, AI integration).
3. Generate an initial implementation plan with milestones:

   * MVP scope (v1)
   * Next steps (v2: improvements, real WhatsApp integration, etc.).
4. Provide concrete examples:

   * API contracts for creating a match, signing up, and generating teams.
   * Example payload for the AI team-generation request and response.
5. Start generating code for the MVP incrementally:

   * DB schema / migrations.
   * Key API endpoints.
   * React/Next.js pages and main components.
   * Basic PWA config.

Call the app FUTBOT