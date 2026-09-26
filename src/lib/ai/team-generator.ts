import OpenAI from 'openai'
import { z } from 'zod'
import { generateFallbackTeams } from './fallback-balancer'
import { POSITIONS } from '@/lib/teams/manual'
import { tagLabel, type PlayerSkills } from '@/lib/ratings'
import { getTranslation, type Language } from '@/i18n/core'
import {
  defendersPolicy,
  goalkeeperPolicy,
  isDefenseCapable,
  isGoalkeeperWilling,
  rulesForPlayers,
  sameSplit,
  type DefendersPolicy,
  type GoalkeeperPolicy,
} from './constraints'

export interface PlayerInput {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
  preferredPositions: string[]
  overallRating: number
  // Peer-rated 1-5 skills (null when nobody has rated the player yet) and trait tags
  skills: PlayerSkills | null
  tags: string[]
  footedness: 'left' | 'right' | 'both'
  goalkeeperWillingness: number // 0-3
  fitnessStatus: 'ok' | 'limited' | 'injured'
  // Member score ("Compromiso", docs/member-scoring.md §5.3) for the match's
  // group, 1-5. Newcomers (NULL score) and guests come in as MEMBER_SCORE_NEUTRAL.
  memberScore: number
  matchesPlayed: number
  goals: number
  assists: number
  isGuest?: boolean
}

export const MEMBER_SCORE_NEUTRAL = 3.5

// Sensible defaults for a guest player we don't have much history on. Guests
// are not GK-willing by default: we know nothing about them, and counting them
// made a guest the "natural" keeper and hid the real goalkeeper shortage.
export function guestPlayerDefaults(guest: {
  id: string
  displayName: string
  preferredPositions?: string[] | null
  estimatedRating?: number | null
}): PlayerInput {
  const positions = guest.preferredPositions && guest.preferredPositions.length > 0
    ? guest.preferredPositions
    : ['CM', 'ST', 'CB']

  return {
    id: guest.id,
    displayName: guest.displayName,
    nickname: null,
    mainPosition: positions[0],
    preferredPositions: positions,
    overallRating: guest.estimatedRating ?? 2.5,
    skills: null,
    tags: [],
    footedness: 'right',
    goalkeeperWillingness: 0,
    fitnessStatus: 'ok',
    memberScore: MEMBER_SCORE_NEUTRAL,
    matchesPlayed: 0,
    goals: 0,
    assists: 0,
    isGuest: true,
  }
}

export interface RuleInput {
  type: 'avoid_pair' | 'force_pair' | 'min_goalkeepers' | 'min_defenders'
  playerIds?: string[]
  value?: number
}

export interface TeamAssignment {
  playerId: string
  position: string
  reason: string
}

export interface GeneratedTeams {
  dark: TeamAssignment[]
  light: TeamAssignment[]
  reasoning: string
  balanceScore: number
  warnings: string[]
}

export type Provider = 'openai' | 'fallback'

export interface PairCountSummary {
  names: [string, string]
  count: number
}

export interface GenerateTeamsResult extends GeneratedTeams {
  provider: Provider
  model?: string
  /** Last prompt sent to the model (null when none was), for ai_input_snapshot. */
  prompt: string | null
  /** Teammate-pair counts among this match's players, as given to the model. */
  pairHistory: PairCountSummary[]
}

// The lineup currently published for the match, as player/guest ids per team.
// Passed on "Regenerar" so the new proposal differs from it.
export interface PreviousLineup {
  dark: string[]
  light: string[]
}

export interface GenerateOptions {
  /** Language of reasoning, warnings and reasons (the requesting user's). */
  language?: Language
  previous?: PreviousLineup | null
  /** Variation seed for the fallback balancer; omit for the plain deterministic split. */
  seed?: number
}

// One row of get_recent_match_history(group_id, limit): who played together recently,
// used to compute teammate-pair counts so the model (or the fallback) can rotate
// combinations instead of always pairing the same people.
export interface MatchHistoryEntry {
  matchId: string
  matchDate: string
  darkTeamPlayers: { player_id: string; name: string }[] | null
  lightTeamPlayers: { player_id: string; name: string }[] | null
}

type PairCount = PairCountSummary

function computeTeammatePairCounts(history: MatchHistoryEntry[]): Map<string, PairCount> {
  const counts = new Map<string, PairCount>()

  for (const entry of history) {
    for (const team of [entry.darkTeamPlayers, entry.lightTeamPlayers]) {
      if (!team || team.length < 2) continue
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const [p1, p2] = [team[i], team[j]].sort((a, b) => a.player_id.localeCompare(b.player_id))
          const key = `${p1.player_id}|${p2.player_id}`
          const existing = counts.get(key)
          if (existing) {
            existing.count += 1
          } else {
            counts.set(key, { names: [p1.name, p2.name], count: 1 })
          }
        }
      }
    }
  }

  return counts
}

// zod schema for the shape we ask the model to return
const TeamAssignmentSchema = z.object({
  playerId: z.string().min(1),
  // Invented codes ("DM", "LWB") would make publish_match_teams reject the
  // lineup; failing validation here sends us to the retry/fallback path.
  position: z.enum(POSITIONS),
  reason: z.string().default(''),
})

const GeneratedTeamsSchema = z.object({
  dark: z.array(TeamAssignmentSchema),
  light: z.array(TeamAssignmentSchema),
  reasoning: z.string().default(''),
  // Documented range is 0..1; a model answering 1.2 or -0.1 gets clamped
  // instead of burning an attempt over a cosmetic number.
  balanceScore: z.number().default(0.5).transform((n) => Math.min(1, Math.max(0, n))),
  warnings: z.array(z.string()).default([]),
})

// Teammate-pair counts where both players are in this match, most repeated first.
function relevantPairCounts(players: PlayerInput[], pairCounts: Map<string, PairCount>): PairCount[] {
  const currentIds = new Set(players.map((p) => p.id))
  return Array.from(pairCounts.entries())
    .filter(([key]) => {
      const [a, b] = key.split('|')
      return currentIds.has(a) && currentIds.has(b)
    })
    .map(([, v]) => v)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
}

const OUTPUT_LANGUAGE: Record<Language, string> = {
  es: 'Rioplatense Spanish (Argentina), using "vos" (e.g. "tenés", "jugá"), never "tú"',
  en: 'English',
}

function buildPrompt(
  players: PlayerInput[],
  rules: RuleInput[],
  teamSize: number,
  relevantPairs: PairCount[],
  gk: GoalkeeperPolicy,
  defenders: DefendersPolicy,
  language: Language,
  previous: PreviousLineup | null,
  violations?: string[]
): string {
  const playerDescriptions = players.map((p) => {
    const positions = [p.mainPosition, ...p.preferredPositions.filter((pos) => pos !== p.mainPosition)].join(', ')
    const foot = p.footedness === 'both' ? 'ambidextrous' : p.footedness === 'left' ? 'left-footed' : 'right-footed'
    const gkWillingness = ['never', 'only if needed', 'can do it', 'loves it'][p.goalkeeperWillingness] ?? 'unknown'
    const skills = p.skills
      ? `GK ${p.skills.goalkeeping.toFixed(1)} | DEF ${p.skills.defense.toFixed(1)} | ATT ${p.skills.attack.toFixed(1)} | PHY ${p.skills.physical.toFixed(1)}`
      : 'not rated yet (assume average)'
    const traits = p.tags.length > 0 ? p.tags.map(tagLabel).join(', ') : 'none'

    return `- ${p.displayName}${p.nickname ? ` (${p.nickname})` : ''} [ID: ${p.id}]
  Rating: ${p.overallRating.toFixed(1)}/5 | Skills (1-5): ${skills} | Traits: ${traits}
  Positions: ${positions} | ${foot}
  GK willingness: ${gkWillingness} | Fitness: ${p.fitnessStatus} | Compromiso (member commitment): ${p.memberScore.toFixed(1)}/5
  Stats: ${p.matchesPlayed} matches, ${p.goals} goals, ${p.assists} assists
  ${p.isGuest ? '(Guest player - less known, use average defaults)' : ''}`
  }).join('\n')

  const rulesDescription = rules.length > 0
    ? rules.map((r) => {
        if (r.type === 'avoid_pair' && r.playerIds) {
          const names = r.playerIds.map((id) => players.find((p) => p.id === id)?.displayName || id)
          return `- AVOID putting ${names.join(' and ')} on the same team (hard constraint)`
        }
        if (r.type === 'force_pair' && r.playerIds) {
          const names = r.playerIds.map((id) => players.find((p) => p.id === id)?.displayName || id)
          return `- FORCE ${names.join(' and ')} to be on the same team (hard constraint)`
        }
        // min_goalkeepers is described once below, as hard or soft (goalkeeperPolicy)
        if (r.type === 'min_defenders') {
          return defenders.hard
            ? `- Each team must have at least ${defenders.required} player(s) capable of playing defense (CB/LB/RB) (hard constraint)`
            : `- Defenders: only ${defenders.capable} player(s) capable of playing defense (CB/LB/RB) in this match, not enough for ${defenders.required} per team. This is a SOFT preference, not a hard constraint: spread them between the teams.`
        }
        return ''
      }).filter(Boolean).join('\n') || 'No special rules'
    : 'No special rules'

  // "GK-willing" = goalkeeper willingness other than "never", or peers say
  // they can keep (isGoalkeeperWilling). The minimum is a hard constraint only
  // when there are enough of them for both teams.
  const gkWilling = 'GK willingness other than "never", or the "Puede atajar" trait, or a GK skill of 3.5 or more'
  const gkDescription = gk.hard
    ? `- Each team must have at least ${gk.required} GK-willing player(s), i.e. ${gkWilling} (hard constraint)`
    : `- Goalkeepers: only ${gk.willing} GK-willing player(s) (${gkWilling}) in this match, not enough for ${gk.required} per team. This is a SOFT preference, not a hard constraint: put GK-willing players in goal where you can, otherwise the player with the best GK skill (never just the best-rated player).`

  const historyDescription = relevantPairs.length > 0
    ? relevantPairs.map((p) => `- ${p.names[0]} and ${p.names[1]} have been teammates ${p.count} time(s) recently`).join('\n')
    : 'No recent match history available'

  const nameOf = (id: string) => players.find((p) => p.id === id)?.displayName
  const previousBlock = previous
    ? `
## Previous Proposal For This Match (the organizer asked for a DIFFERENT one)

- Dark: ${previous.dark.map(nameOf).filter(Boolean).join(', ')}
- Light: ${previous.light.map(nameOf).filter(Boolean).join(', ')}

Produce a clearly different split: move several players to the other team (just swapping which side a whole team is on does not count), while keeping the hard constraints and a good balance.
`
    : ''

  const violationsBlock = violations && violations.length > 0
    ? `\n## Your Previous Attempt Had These Problems (FIX THEM)\n\n${violations.map((v) => `- ${v}`).join('\n')}\n`
    : ''

  return `You are an expert football (soccer) team balancer for amateur matches. Your goal is to create two balanced teams that will have a competitive and fun match.

## Players Available (${players.length} total, ${teamSize} per team)

${playerDescriptions}

## Rules to Follow (hard constraints marked as such MUST be respected)

${rulesDescription}
${gkDescription}

## Recent Teammate History (rotate combinations - avoid repeating the same pairs when possible, this is a soft preference)

${historyDescription}
${previousBlock}${violationsBlock}
## Formation Context

Teams are rendered with a fixed formation per team size; assign positions that fill it:
- 5 players: GK, CB, CM, CM, ST
- 6 players: GK, CB, CB, CM, CM, ST
- 7 players: GK, RB, CB, LB, CM, CM, ST
- 8 players: GK, RB, CB, LB, CM, CDM, CM, ST
- 9 players: GK, RB, CB, LB, CM, CDM, CM, ST, ST
- 11 players: GK, RB, CB, CB, LB, CM, CDM, CDM, CM, ST, ST
This match is ${teamSize}-a-side.

## Your Task

Create two balanced teams (Dark and Light) considering:
1. **Hard constraints first**: never violate any rule marked as a hard constraint
2. **Overall Rating Balance**: The average rating of both teams should be as close as possible
   - Also balance the DEF, ATT and PHY skill averages between the teams; don't stack all the attackers on one side
   - For the goalkeeper slot prefer players with a high GK skill, then GK willingness
3. **Position Coverage**: Each team needs players who can play key positions (especially GK and defense)
4. **Complementary Skills**: Mix of attackers, midfielders, and defenders
5. **Footedness Distribution**: Balance left and right-footed players when possible
6. **Fitness Considerations**: Players with "limited" fitness should have lighter roles
7. **Rotation**: prefer combinations that were not teammates recently (see history above)

## Response Format

Respond with ONLY a valid JSON object, no markdown, no code fences:

{
  "dark": [
    {"playerId": "player-uuid", "position": "GK", "reason": "Brief reason for this assignment"}
  ],
  "light": [
    {"playerId": "player-uuid", "position": "ST", "reason": "Brief reason for this assignment"}
  ],
  "reasoning": "2-3 sentences explaining the overall balance strategy",
  "balanceScore": 0.95,
  "warnings": ["Any concerns about the team balance"]
}

The balanceScore should be between 0 and 1, where 1 means perfectly balanced.
Write "reasoning", every "warnings" item and every "reason" in ${OUTPUT_LANGUAGE[language]}. Keep player names exactly as given.
Ratings, skills and Compromiso are private: never quote a player's rating, skill score or Compromiso (no numbers like "4.2" or "3/5") in "reasoning", "warnings" or "reason", and never describe a specific player's Compromiso. Describe the balance qualitatively (e.g. "strong defense", "experienced keeper").
Include ALL ${players.length} players EXACTLY ONCE, split as evenly as possible between the two teams (sizes may differ by at most 1).
Use standard position abbreviations: GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF`
}

// Hard-constraint validation run after every AI response (and useful for tests):
// - every confirmed player assigned exactly once
// - team sizes differ by at most 1
// - avoid_pair never on the same team
// - force_pair always on the same team
// - each team has >= required GK-willing players, only while goalkeeperPolicy()
//   says the pool allows it (>= 2 GK-willing with the default of 1 per team)
// - each team has >= required defense-capable players when a min_defenders rule
//   exists and defendersPolicy() says the pool allows it
export function validateHardConstraints(
  players: PlayerInput[],
  rules: RuleInput[],
  result: GeneratedTeams
): string[] {
  const violations: string[] = []

  const darkIds = result.dark.map((a) => a.playerId)
  const lightIds = result.light.map((a) => a.playerId)
  const allAssignedIds = [...darkIds, ...lightIds]

  // Every confirmed player assigned exactly once
  const counts = new Map<string, number>()
  for (const id of allAssignedIds) counts.set(id, (counts.get(id) || 0) + 1)

  const missing = players.filter((p) => !counts.has(p.id))
  if (missing.length > 0) {
    violations.push(`Missing players (not assigned to any team): ${missing.map((p) => p.displayName).join(', ')}`)
  }

  const duplicated = players.filter((p) => (counts.get(p.id) || 0) > 1)
  if (duplicated.length > 0) {
    violations.push(`Duplicated players (assigned to more than one slot): ${duplicated.map((p) => p.displayName).join(', ')}`)
  }

  const unknownIds = allAssignedIds.filter((id) => !players.some((p) => p.id === id))
  if (unknownIds.length > 0) {
    violations.push(`Unknown player IDs in the response that don't match any confirmed player: ${unknownIds.join(', ')}`)
  }

  // Team sizes differ by at most 1
  if (Math.abs(darkIds.length - lightIds.length) > 1) {
    violations.push(`Team sizes are too unequal: dark has ${darkIds.length}, light has ${lightIds.length}`)
  }

  const teamOf = (id: string): 'dark' | 'light' | null => {
    if (darkIds.includes(id)) return 'dark'
    if (lightIds.includes(id)) return 'light'
    return null
  }

  // avoid_pair / force_pair
  for (const rule of rules) {
    if (rule.type === 'avoid_pair' && rule.playerIds && rule.playerIds.length === 2) {
      const [a, b] = rule.playerIds
      const teamA = teamOf(a)
      const teamB = teamOf(b)
      if (teamA && teamB && teamA === teamB) {
        const nameA = players.find((p) => p.id === a)?.displayName || a
        const nameB = players.find((p) => p.id === b)?.displayName || b
        violations.push(`${nameA} and ${nameB} must be on different teams (avoid_pair) but were both placed on ${teamA}`)
      }
    }
    if (rule.type === 'force_pair' && rule.playerIds && rule.playerIds.length === 2) {
      const [a, b] = rule.playerIds
      const teamA = teamOf(a)
      const teamB = teamOf(b)
      if (teamA && teamB && teamA !== teamB) {
        const nameA = players.find((p) => p.id === a)?.displayName || a
        const nameB = players.find((p) => p.id === b)?.displayName || b
        violations.push(`${nameA} and ${nameB} must be on the same team (force_pair) but were split between dark and light`)
      }
    }
  }

  // Goalkeeper minimum: hard only when there are enough GK-willing players for
  // both teams, otherwise a soft preference (see goalkeeperPolicy)
  const gk = goalkeeperPolicy(players, rules)
  if (gk.hard) {
    for (const [teamName, ids] of [['dark', darkIds], ['light', lightIds]] as const) {
      const gkCount = ids.filter((id) => {
        const player = players.find((p) => p.id === id)
        return player && isGoalkeeperWilling(player)
      }).length
      if (gkCount < gk.required) {
        violations.push(`Team ${teamName} has only ${gkCount} GK-willing player(s), needs at least ${gk.required}`)
      }
    }
  }

  // Defenders minimum: hard only when a min_defenders rule exists and the pool
  // can cover both teams (see defendersPolicy); otherwise a soft preference
  const defenders = defendersPolicy(players, rules)
  if (defenders.hard) {
    const required = defenders.required
    for (const [teamName, ids] of [['dark', darkIds], ['light', lightIds]] as const) {
      const defCount = ids.filter((id) => {
        const player = players.find((p) => p.id === id)
        return player ? isDefenseCapable(player) : false
      }).length
      if (defCount < required) {
        violations.push(`Team ${teamName} has only ${defCount} defense-capable player(s), needs at least ${required}`)
      }
    }
  }

  return violations
}

// OpenAI budget: one request may take OPENAI_TIMEOUT_MS, and all attempts
// together OPENAI_DEADLINE_MS, so the fallback still answers well inside the
// route's maxDuration (60s). The SDK's own retries are off: our loop retries.
const OPENAI_TIMEOUT_MS = 15_000
const OPENAI_DEADLINE_MS = 25_000
// Not worth starting another attempt with less time than this left.
const OPENAI_MIN_ATTEMPT_MS = 3_000

export async function generateTeams(
  players: PlayerInput[],
  allRules: RuleInput[] = [],
  teamSize?: number,
  history: MatchHistoryEntry[] = [],
  options: GenerateOptions = {}
): Promise<GenerateTeamsResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const calculatedTeamSize = teamSize || Math.ceil(players.length / 2)
  const language = options.language ?? 'es'
  const previous = options.previous && options.previous.dark.length + options.previous.light.length > 0
    ? options.previous
    : null
  const t = getTranslation(language)
  const rules = rulesForPlayers(players, allRules)
  const pairHistory = relevantPairCounts(players, computeTeammatePairCounts(history))
  const gk = goalkeeperPolicy(players, rules)
  const defenders = defendersPolicy(players, rules)

  // Said once, whichever provider answers: with too few GK-willing players the
  // keeper minimum was only a preference; same for an unreachable min_defenders.
  const gkWarnings = [
    ...(gk.hard ? [] : [gk.willing === 0 ? t('ui.teamsAi.gkNone') : t('ui.teamsAi.gkFew', { n: gk.willing })]),
    ...(defenders.required > 0 && !defenders.hard
      ? [t('ui.teamsAi.minDefendersSoft', { n: defenders.capable, required: defenders.required })]
      : []),
  ]
  const fallback = (prompt: string | null): GenerateTeamsResult => {
    const result = generateFallbackTeams(players, rules, calculatedTeamSize, { language, previous, seed: options.seed })
    return { ...result, warnings: [...gkWarnings, ...result.warnings], provider: 'fallback', prompt, pairHistory }
  }

  if (!apiKey) return fallback(null)

  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 })
  const startedAt = Date.now()

  let lastViolations: string[] = []
  let lastPrompt: string | null = null
  const maxAttempts = 2

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const left = OPENAI_DEADLINE_MS - (Date.now() - startedAt)
    if (left < OPENAI_MIN_ATTEMPT_MS) {
      lastViolations = [...lastViolations, 'Out of time for another AI attempt']
      break
    }
    try {
      const prompt = buildPrompt(players, rules, calculatedTeamSize, pairHistory, gk, defenders, language, previous, attempt > 0 ? lastViolations : undefined)
      lastPrompt = prompt

      const response = await client.chat.completions.create({
        model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }, { timeout: Math.min(OPENAI_TIMEOUT_MS, left) })

      const textContent = response.choices[0]?.message?.content
      if (!textContent) {
        lastViolations = ['The model returned an empty response']
        continue
      }

      const parsed = GeneratedTeamsSchema.parse(JSON.parse(textContent))
      const violations = validateHardConstraints(players, rules, parsed)
      if (previous && sameSplit(previous, {
        dark: parsed.dark.map((a) => a.playerId),
        light: parsed.light.map((a) => a.playerId),
      })) {
        violations.push('The teams are identical to the previous proposal; the organizer asked for a different split')
      }

      if (violations.length === 0) {
        return { ...parsed, warnings: [...gkWarnings, ...parsed.warnings], provider: 'openai', model, prompt, pairHistory }
      }

      lastViolations = violations
    } catch (err) {
      console.error(`OpenAI team generation attempt ${attempt + 1} failed:`, err)
      lastViolations = [err instanceof Error ? err.message : 'Unknown error parsing the AI response']
    }
  }

  console.warn('Falling back to deterministic balancer after exhausting OpenAI attempts. Last violations:', lastViolations)
  return fallback(lastPrompt)
}

// Helper to calculate team balance metrics
export function calculateTeamMetrics(
  team: TeamAssignment[],
  players: PlayerInput[]
): {
  averageRating: number
  positionCoverage: Record<string, number>
  leftFooted: number
  rightFooted: number
} {
  const teamPlayers = team.map((a) => players.find((p) => p.id === a.playerId)!).filter(Boolean)

  const averageRating = teamPlayers.length > 0
    ? teamPlayers.reduce((sum, p) => sum + p.overallRating, 0) / teamPlayers.length
    : 0

  const positionCoverage: Record<string, number> = {}
  for (const assignment of team) {
    positionCoverage[assignment.position] = (positionCoverage[assignment.position] || 0) + 1
  }

  const leftFooted = teamPlayers.filter((p) => p.footedness === 'left').length
  const rightFooted = teamPlayers.filter((p) => p.footedness === 'right').length

  return {
    averageRating,
    positionCoverage,
    leftFooted,
    rightFooted,
  }
}
