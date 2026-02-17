import Anthropic from '@anthropic-ai/sdk'

export interface PlayerInput {
  id: string
  displayName: string
  nickname: string | null
  mainPosition: string
  preferredPositions: string[]
  overallRating: number
  footedness: 'left' | 'right' | 'both'
  goalkeeperWillingness: number // 0-3
  fitnessStatus: 'ok' | 'limited' | 'injured'
  reliabilityScore: number
  matchesPlayed: number
  goals: number
  assists: number
  isGuest?: boolean
}

export interface RuleInput {
  type: 'avoid_pair' | 'force_pair' | 'min_goalkeepers'
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

const POSITION_DESCRIPTIONS: Record<string, string> = {
  GK: 'Goalkeeper - last line of defense',
  CB: 'Center Back - central defender',
  LB: 'Left Back - left side defender',
  RB: 'Right Back - right side defender',
  CDM: 'Defensive Midfielder - shields defense',
  CM: 'Central Midfielder - box-to-box player',
  CAM: 'Attacking Midfielder - creative playmaker',
  LM: 'Left Midfielder - left side midfield',
  RM: 'Right Midfielder - right side midfield',
  LW: 'Left Winger - left attacking flank',
  RW: 'Right Winger - right attacking flank',
  ST: 'Striker - main goal scorer',
  CF: 'Center Forward - target man',
}

function buildPrompt(
  players: PlayerInput[],
  rules: RuleInput[],
  teamSize: number
): string {
  const playerDescriptions = players.map((p) => {
    const positions = [p.mainPosition, ...p.preferredPositions.filter(pos => pos !== p.mainPosition)].join(', ')
    const foot = p.footedness === 'both' ? 'ambidextrous' : p.footedness === 'left' ? 'left-footed' : 'right-footed'
    const gkWillingness = ['never', 'only if needed', 'can do it', 'loves it'][p.goalkeeperWillingness]

    return `- ${p.displayName}${p.nickname ? ` (${p.nickname})` : ''} [ID: ${p.id}]
  Rating: ${p.overallRating.toFixed(1)}/5 | Positions: ${positions} | ${foot}
  GK willingness: ${gkWillingness} | Fitness: ${p.fitnessStatus}
  Stats: ${p.matchesPlayed} matches, ${p.goals} goals, ${p.assists} assists
  ${p.isGuest ? '(Guest player - less known)' : ''}`
  }).join('\n')

  const rulesDescription = rules.length > 0
    ? rules.map((r) => {
        if (r.type === 'avoid_pair' && r.playerIds) {
          const names = r.playerIds.map(id => players.find(p => p.id === id)?.displayName || id)
          return `- AVOID putting ${names.join(' and ')} on the same team`
        }
        if (r.type === 'force_pair' && r.playerIds) {
          const names = r.playerIds.map(id => players.find(p => p.id === id)?.displayName || id)
          return `- FORCE ${names.join(' and ')} to be on the same team`
        }
        if (r.type === 'min_goalkeepers' && r.value) {
          return `- Each team must have at least ${r.value} player willing to be goalkeeper`
        }
        return ''
      }).filter(Boolean).join('\n')
    : 'No special rules'

  return `You are an expert football (soccer) team balancer for amateur 7-a-side matches. Your goal is to create two balanced teams that will have a competitive and fun match.

## Players Available (${players.length} total, ${teamSize} per team)

${playerDescriptions}

## Rules to Follow

${rulesDescription}

## Formation Context

For ${teamSize}-a-side, typical formations are:
- 7 players: 1-2-3-1 or 1-3-2-1 (GK + field players)
- 6 players: 1-2-2-1 or 1-3-1-1
- 5 players: 1-2-1-1 or 1-1-2-1

## Your Task

Create two balanced teams (Dark and Light) considering:
1. **Overall Rating Balance**: The average rating of both teams should be as close as possible
2. **Position Coverage**: Each team needs players who can play key positions (especially GK and defense)
3. **Complementary Skills**: Mix of attackers, midfielders, and defenders
4. **Footedness Distribution**: Balance left and right-footed players when possible
5. **Fitness Considerations**: Players with "limited" fitness should have lighter roles
6. **Player Preferences**: Respect goalkeeper willingness levels

## Response Format

Respond with a valid JSON object (no markdown, no code blocks, just the JSON):

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
Include ALL ${players.length} players, split evenly between the two teams.
Use standard position abbreviations: GK, CB, LB, RB, CDM, CM, CAM, LM, RM, LW, RW, ST, CF`
}

export async function generateTeams(
  players: PlayerInput[],
  rules: RuleInput[] = [],
  teamSize?: number
): Promise<GeneratedTeams> {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured')
  }

  const client = new Anthropic({ apiKey })

  const calculatedTeamSize = teamSize || Math.floor(players.length / 2)
  const prompt = buildPrompt(players, rules, calculatedTeamSize)

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  // Extract text content from response
  const textContent = message.content.find((block) => block.type === 'text')
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  // Parse JSON response
  try {
    const result = JSON.parse(textContent.text) as GeneratedTeams

    // Validate the response
    if (!result.dark || !result.light || !Array.isArray(result.dark) || !Array.isArray(result.light)) {
      throw new Error('Invalid team structure in response')
    }

    // Ensure all players are assigned
    const assignedIds = new Set([
      ...result.dark.map((a) => a.playerId),
      ...result.light.map((a) => a.playerId),
    ])

    const missingPlayers = players.filter((p) => !assignedIds.has(p.id))
    if (missingPlayers.length > 0) {
      result.warnings = result.warnings || []
      result.warnings.push(
        `${missingPlayers.length} player(s) were not assigned: ${missingPlayers.map((p) => p.displayName).join(', ')}`
      )
    }

    return result
  } catch (parseError) {
    console.error('Failed to parse Claude response:', textContent.text)
    throw new Error('Failed to parse team generation response')
  }
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
