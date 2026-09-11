import OpenAI from 'openai'
import { z } from 'zod'
import { generateFallbackTeams } from './fallback-balancer'
import { tagLabel, type PlayerSkills } from '@/lib/ratings'

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
  matchesPlayed: number
  goals: number
  assists: number
  isGuest?: boolean
}

// Sensible defaults for a guest player we don't have much history on.
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
    goalkeeperWillingness: 1,
    fitnessStatus: 'ok',
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

export interface GenerateTeamsResult extends GeneratedTeams {
  provider: Provider
  model?: string
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

interface PairCount {
  names: [string, string]
  count: number
}

const DEFENDER_POSITIONS = ['CB', 'LB', 'RB']

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
  position: z.string().min(1),
  reason: z.string().default(''),
})

const GeneratedTeamsSchema = z.object({
  dark: z.array(TeamAssignmentSchema),
  light: z.array(TeamAssignmentSchema),
  reasoning: z.string().default(''),
  balanceScore: z.number().min(0).max(1).default(0.5),
  warnings: z.array(z.string()).default([]),
})

function buildPrompt(
  players: PlayerInput[],
  rules: RuleInput[],
  teamSize: number,
  pairCounts: Map<string, PairCount>,
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
  GK willingness: ${gkWillingness} | Fitness: ${p.fitnessStatus}
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
        if (r.type === 'min_goalkeepers') {
          return `- Each team must have at least ${r.value ?? 1} player(s) with goalkeeper willingness >= 1 (hard constraint)`
        }
        if (r.type === 'min_defenders') {
          return `- Each team must have at least ${r.value ?? 1} player(s) capable of playing defense (CB/LB/RB)`
        }
        return ''
      }).filter(Boolean).join('\n')
    : 'No special rules'

  // Relevant teammate-pair history (only pairs where both players are in this match)
  const currentIds = new Set(players.map((p) => p.id))
  const relevantPairs = Array.from(pairCounts.entries())
    .filter(([key]) => {
      const [a, b] = key.split('|')
      return currentIds.has(a) && currentIds.has(b)
    })
    .map(([, v]) => v)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)

  const historyDescription = relevantPairs.length > 0
    ? relevantPairs.map((p) => `- ${p.names[0]} and ${p.names[1]} have been teammates ${p.count} time(s) recently`).join('\n')
    : 'No recent match history available'

  const violationsBlock = violations && violations.length > 0
    ? `\n## Your Previous Attempt Had These Problems (FIX THEM)\n\n${violations.map((v) => `- ${v}`).join('\n')}\n`
    : ''

  return `You are an expert football (soccer) team balancer for amateur 7-a-side matches. Your goal is to create two balanced teams that will have a competitive and fun match.

## Players Available (${players.length} total, ${teamSize} per team)

${playerDescriptions}

## Rules to Follow (hard constraints marked as such MUST be respected)

${rulesDescription}

## Recent Teammate History (rotate combinations - avoid repeating the same pairs when possible, this is a soft preference)

${historyDescription}
${violationsBlock}
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
1. **Hard constraints first**: never violate avoid_pair/force_pair rules or the goalkeeper minimum
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
Include ALL ${players.length} players EXACTLY ONCE, split as evenly as possible between the two teams (sizes may differ by at most 1).
Use standard position abbreviations: GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF`
}

// Hard-constraint validation run after every AI response (and useful for tests):
// - every confirmed player assigned exactly once
// - team sizes differ by at most 1
// - avoid_pair never on the same team
// - force_pair always on the same team
// - each team has >= required goalkeeper-willing players when a min_goalkeepers rule exists (default 1)
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

  // Goalkeeper minimum: always required (defaults to 1 even without an explicit rule row)
  const minGkRule = rules.find((r) => r.type === 'min_goalkeepers')
  const requiredGks = minGkRule?.value ?? 1
  for (const [teamName, ids] of [['dark', darkIds], ['light', lightIds]] as const) {
    const gkCount = ids.filter((id) => {
      const player = players.find((p) => p.id === id)
      return player && player.goalkeeperWillingness >= 1
    }).length
    if (gkCount < requiredGks) {
      violations.push(`Team ${teamName} has only ${gkCount} goalkeeper-willing player(s), needs at least ${requiredGks}`)
    }
  }

  // Defenders minimum (only when a min_defenders rule exists)
  const minDefRule = rules.find((r) => r.type === 'min_defenders')
  if (minDefRule) {
    const required = minDefRule.value ?? 1
    for (const [teamName, ids] of [['dark', darkIds], ['light', lightIds]] as const) {
      const defCount = ids.filter((id) => {
        const player = players.find((p) => p.id === id)
        if (!player) return false
        return DEFENDER_POSITIONS.includes(player.mainPosition) ||
          player.preferredPositions.some((pos) => DEFENDER_POSITIONS.includes(pos))
      }).length
      if (defCount < required) {
        violations.push(`Team ${teamName} has only ${defCount} defense-capable player(s), needs at least ${required}`)
      }
    }
  }

  return violations
}

export async function generateTeams(
  players: PlayerInput[],
  rules: RuleInput[] = [],
  teamSize?: number,
  history: MatchHistoryEntry[] = []
): Promise<GenerateTeamsResult> {
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const calculatedTeamSize = teamSize || Math.ceil(players.length / 2)

  if (!apiKey) {
    return { ...generateFallbackTeams(players, rules, calculatedTeamSize), provider: 'fallback' }
  }

  const client = new OpenAI({ apiKey })
  const pairCounts = computeTeammatePairCounts(history)

  let lastViolations: string[] = []
  const maxAttempts = 2

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const prompt = buildPrompt(players, rules, calculatedTeamSize, pairCounts, attempt > 0 ? lastViolations : undefined)

      const response = await client.chat.completions.create({
        model,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      })

      const textContent = response.choices[0]?.message?.content
      if (!textContent) {
        lastViolations = ['The model returned an empty response']
        continue
      }

      const parsed = GeneratedTeamsSchema.parse(JSON.parse(textContent))
      const violations = validateHardConstraints(players, rules, parsed)

      if (violations.length === 0) {
        return { ...parsed, provider: 'openai', model }
      }

      lastViolations = violations
    } catch (err) {
      console.error(`OpenAI team generation attempt ${attempt + 1} failed:`, err)
      lastViolations = [err instanceof Error ? err.message : 'Unknown error parsing the AI response']
    }
  }

  console.warn('Falling back to deterministic balancer after exhausting OpenAI attempts. Last violations:', lastViolations)
  return { ...generateFallbackTeams(players, rules, calculatedTeamSize), provider: 'fallback' }
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
