'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, Plus, X, Shield, Users, Handshake, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'
import type { RuleSet, Json } from '@/types/database'

// Teaming rules (docs/rework-plan.md §2.2), shared by the match page and the
// "Reglas del grupo" card in group settings (OD-10).
//   matchId set  -> the group's rules plus this match's; new rules are
//                   scoped to the match (match_id set, group_id NULL).
//   no matchId   -> the group-wide rules only (group_id set, match_id NULL);
//                   they apply to every match the balancer arms.
// rule_sets RLS lets admins and captains write both (00035).

interface Player {
  id: string
  display_name: string
  is_guest?: boolean
}

// Canonical rule_sets.data shapes:
//   avoid_pair / force_pair -> { player_ids: [uuid, uuid] }
//   min_defenders / min_goalkeepers -> { min_count: number }
type RuleType = 'avoid_pair' | 'force_pair' | 'min_defenders' | 'min_goalkeepers'

interface PairRuleData {
  player_ids: [string, string]
}

interface MinCountRuleData {
  min_count: number
}

interface RulesManagerProps {
  groupId: string
  matchId?: string
  players: Player[]
  /** Render only the content, for a page that wraps it in its own card. */
  bare?: boolean
}

// Label and description are ui.rulesEditor.{key} and ui.rulesEditor.{key}Body.
const RULE_LABELS: Record<RuleType, { key: string; icon: React.ReactNode }> = {
  avoid_pair: { key: 'avoidPair', icon: <Ban className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> },
  force_pair: { key: 'forcePair', icon: <Handshake className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> },
  min_defenders: { key: 'minDefenders', icon: <Shield className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> },
  min_goalkeepers: { key: 'minGoalkeepers', icon: <Users className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> },
}

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function isPairRule(type: string): type is 'avoid_pair' | 'force_pair' {
  return type === 'avoid_pair' || type === 'force_pair'
}

function isMinCountRule(type: string): type is 'min_defenders' | 'min_goalkeepers' {
  return type === 'min_defenders' || type === 'min_goalkeepers'
}

export function RulesManager({ groupId, matchId, players, bare = false }: RulesManagerProps) {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()
  const [rules, setRules] = useState<RuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingType, setAddingType] = useState<RuleType | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A group-level rule about to be removed from a match: needs confirmation,
  // because turning it off affects every match of the group.
  const [confirmingGroupRule, setConfirmingGroupRule] = useState<RuleSet | null>(null)

  // Form state for pair rules
  const [playerA, setPlayerA] = useState('')
  const [playerB, setPlayerB] = useState('')
  // Form state for min-count rules
  const [minValue, setMinValue] = useState('1')

  useEffect(() => {
    const fetchRules = async () => {
      let query = supabase
        .from('rule_sets')
        .select('*')
        .eq('is_active', true)

      query = matchId
        ? query.or(`group_id.eq.${groupId},match_id.eq.${matchId}`)
        : query.eq('group_id', groupId).is('match_id', null)

      const { data } = await query.order('created_at')
      setRules(data || [])
      setLoading(false)
    }
    fetchRules()
  }, [groupId, matchId, supabase])

  const addRule = async () => {
    if (!addingType) return
    setSaving(true)
    setError(null)

    try {
      let data: PairRuleData | MinCountRuleData

      if (isPairRule(addingType)) {
        if (!playerA || !playerB || playerA === playerB) {
          setError(t('ui.rulesEditor.pickTwo'))
          setSaving(false)
          return
        }
        data = { player_ids: [playerA, playerB] }
      } else {
        data = { min_count: Math.min(5, Math.max(1, parseInt(minValue, 10) || 1)) }
      }

      const { data: newRule, error } = await supabase
        .from('rule_sets')
        .insert({
          // rule_scope_check: exactly one of (group_id, match_id) is set.
          // On a match the rule belongs to that match; without one it is a
          // group-wide rule.
          group_id: matchId ? null : groupId,
          match_id: matchId || null,
          rule_type: addingType,
          data: data as unknown as Json,
          is_active: true,
        })
        .select()
        .single()

      if (error) throw error

      setRules((prev) => [...prev, newRule])
      setAddingType(null)
      setPlayerA('')
      setPlayerB('')
      setMinValue('1')
      router.refresh()
    } catch (err) {
      console.error('Error adding rule:', err)
      setError(t('ui.rulesEditor.addError'))
    } finally {
      setSaving(false)
    }
  }

  // Group-level rules (group_id set) apply to every match; rules added on a
  // match are scoped to it (match_id set).
  const isGroupRule = (rule: RuleSet) => rule.group_id !== null

  const removeRule = async (ruleId: string) => {
    setError(null)
    const { error: removeError } = await supabase
      .from('rule_sets')
      .update({ is_active: false })
      .eq('id', ruleId)

    if (removeError) {
      setError(t('ui.rulesEditor.removeError'))
      return
    }
    setRules((prev) => prev.filter((r) => r.id !== ruleId))
    router.refresh()
  }

  // In group settings every rule is a group rule, and the card says so:
  // no extra confirmation there.
  const requestRemove = (rule: RuleSet) => {
    if (matchId && isGroupRule(rule)) setConfirmingGroupRule(rule)
    else void removeRule(rule.id)
  }

  const playerLabel = (p: Player) =>
    p.is_guest ? `${p.display_name} (${t('ui.guest')})` : p.display_name

  const getPlayerName = (id: string | undefined) => {
    const p = players.find((x) => x.id === id)
    return p ? playerLabel(p) : t('ui.rulesEditor.unknownPlayer')
  }

  const renderRuleDescription = (rule: RuleSet) => {
    if (isPairRule(rule.rule_type)) {
      const d = rule.data as unknown as PairRuleData
      const [a, b] = d.player_ids || []
      return `${getPlayerName(a)} — ${getPlayerName(b)}`
    }
    if (isMinCountRule(rule.rule_type)) {
      const d = rule.data as unknown as MinCountRuleData
      return t('ui.rulesEditor.minPerTeam', { n: d.min_count })
    }
    return JSON.stringify(rule.data)
  }

  const content = loading ? (
    // Skeleton rows the height of the real ones (06-principles §7).
    <div aria-hidden="true" className="space-y-2">
      <div className="h-11 rounded-sm bg-muted animate-pulse" />
      <div className="h-11 rounded-sm bg-muted animate-pulse" />
    </div>
  ) : (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {error}
        </p>
      )}

      {rules.length === 0 && !addingType && (
        <p className="text-sm text-muted-foreground text-pretty">
          {matchId ? t('ui.rulesEditor.empty') : t('ui.groupRules.empty')}
        </p>
      )}

      {rules.length > 0 && (
        <ul className="border-t border-border">
          {rules.map((rule) => {
            const config = RULE_LABELS[rule.rule_type as RuleType]
            return (
              <li key={rule.id} className="flex min-h-11 items-center gap-3 border-b border-border py-2">
                <span className="text-muted-foreground shrink-0">{config?.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {config ? t(`ui.rulesEditor.${config.key}`) : rule.rule_type}
                    {matchId && (
                      <Badge variant={isGroupRule(rule) ? 'secondary' : 'outline'}>
                        {isGroupRule(rule) ? t('ui.rulesEditor.scopeGroup') : t('ui.rulesEditor.scopeMatch')}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{renderRuleDescription(rule)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => requestRemove(rule)}
                  aria-label={t('ui.rulesEditor.remove')}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {addingType && (
        <div className="space-y-3 border-t border-border pt-3">
          <div>
            <p className="text-sm font-medium">
              {t(`ui.rulesEditor.${RULE_LABELS[addingType].key}`)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
              {t(`ui.rulesEditor.${RULE_LABELS[addingType].key}Body`)}
            </p>
          </div>

          {isPairRule(addingType) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor={`rule-a-${matchId ?? groupId}`} className="text-xs">{t('ui.rulesEditor.playerA')}</Label>
                <select
                  id={`rule-a-${matchId ?? groupId}`}
                  value={playerA}
                  onChange={(e) => setPlayerA(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('ui.rulesEditor.choose')}</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`rule-b-${matchId ?? groupId}`} className="text-xs">{t('ui.rulesEditor.playerB')}</Label>
                <select
                  id={`rule-b-${matchId ?? groupId}`}
                  value={playerB}
                  onChange={(e) => setPlayerB(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('ui.rulesEditor.choose')}</option>
                  {players.filter((p) => p.id !== playerA).map((p) => (
                    <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {isMinCountRule(addingType) && (
            <div className="space-y-1.5">
              <Label htmlFor={`rule-min-${matchId ?? groupId}`} className="text-xs">{t('ui.rulesEditor.minCount')}</Label>
              <Input
                id={`rule-min-${matchId ?? groupId}`}
                type="number"
                min="1"
                max="5"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={addRule} disabled={saving} className="flex-1 sm:flex-none">
              {saving && <Spinner size="sm" className="mr-2" />}
              {t('common.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAddingType(null); setError(null) }} className="flex-1 sm:flex-none">
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {!addingType && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(RULE_LABELS) as [RuleType, typeof RULE_LABELS[RuleType]][]).map(([type, config]) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => setAddingType(type)}
            >
              <Plus className="mr-1 h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              {t(`ui.rulesEditor.${config.key}`)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )

  const confirmSheet = (
    <Sheet
      open={confirmingGroupRule !== null}
      onOpenChange={(open) => { if (!open) setConfirmingGroupRule(null) }}
      title={t('ui.rulesEditor.removeGroupTitle')}
      description={t('ui.rulesEditor.removeGroupBody')}
    >
      <div className="flex flex-wrap gap-3 pt-4">
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            const rule = confirmingGroupRule
            setConfirmingGroupRule(null)
            if (rule) void removeRule(rule.id)
          }}
        >
          {t('ui.rulesEditor.removeGroupConfirm')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setConfirmingGroupRule(null)}>
          {t('common.cancel')}
        </Button>
      </div>
    </Sheet>
  )

  if (bare) {
    return (
      <>
        {content}
        {matchId && confirmSheet}
      </>
    )
  }

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{t('ui.rulesEditor.title')}</CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
      {matchId && confirmSheet}
    </Card>
  )
}
