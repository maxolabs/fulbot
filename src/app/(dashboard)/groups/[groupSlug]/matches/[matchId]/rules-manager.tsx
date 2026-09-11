'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Shield, Users, Handshake, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import type { RuleSet, Json } from '@/types/database'

interface Player {
  id: string
  display_name: string
  is_guest?: boolean
}

// Canonical rule_sets.data shapes (see docs/rework-plan.md §2.2):
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
}

const RULE_LABELS: Record<RuleType, { label: string; icon: React.ReactNode; description: string }> = {
  avoid_pair: {
    label: 'Separar jugadores',
    icon: <Ban className="h-4 w-4" />,
    description: 'Estos jugadores no pueden estar en el mismo equipo',
  },
  force_pair: {
    label: 'Juntar jugadores',
    icon: <Handshake className="h-4 w-4" />,
    description: 'Estos jugadores deben estar en el mismo equipo',
  },
  min_defenders: {
    label: 'Mín. defensores',
    icon: <Shield className="h-4 w-4" />,
    description: 'Mínimo de defensores por equipo',
  },
  min_goalkeepers: {
    label: 'Mín. arqueros',
    icon: <Users className="h-4 w-4" />,
    description: 'Mínimo de arqueros por equipo',
  },
}

function isPairRule(type: string): type is 'avoid_pair' | 'force_pair' {
  return type === 'avoid_pair' || type === 'force_pair'
}

function isMinCountRule(type: string): type is 'min_defenders' | 'min_goalkeepers' {
  return type === 'min_defenders' || type === 'min_goalkeepers'
}

export function RulesManager({ groupId, matchId, players }: RulesManagerProps) {
  const router = useRouter()
  const supabase = createClient()
  const [rules, setRules] = useState<RuleSet[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingType, setAddingType] = useState<RuleType | null>(null)

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

      const { data } = await query
      setRules(data || [])
      setLoading(false)
    }
    fetchRules()
  }, [groupId, matchId, supabase])

  const addRule = async () => {
    if (!addingType) return
    setSaving(true)

    try {
      let data: PairRuleData | MinCountRuleData

      if (isPairRule(addingType)) {
        if (!playerA || !playerB || playerA === playerB) {
          alert('Seleccioná dos jugadores diferentes')
          setSaving(false)
          return
        }
        data = { player_ids: [playerA, playerB] }
      } else {
        data = { min_count: parseInt(minValue, 10) || 1 }
      }

      const { data: newRule, error } = await supabase
        .from('rule_sets')
        .insert({
          // rule_sets has CHECK rule_scope_check requiring exactly one of
          // (group_id, match_id) to be non-null. This component is only ever
          // rendered from the match page (matchId always set), so new rules
          // are scoped to the match, matching fetchRules' read logic above.
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
      alert('No se pudo agregar la regla. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (ruleId: string) => {
    const { error } = await supabase
      .from('rule_sets')
      .update({ is_active: false })
      .eq('id', ruleId)

    if (!error) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId))
      router.refresh()
    }
  }

  const playerLabel = (p: Player) =>
    p.is_guest ? `${p.display_name} (invitado)` : p.display_name

  const getPlayerName = (id: string | undefined) => {
    const p = players.find((x) => x.id === id)
    return p ? playerLabel(p) : 'Desconocido'
  }

  const renderRuleDescription = (rule: RuleSet) => {
    if (isPairRule(rule.rule_type)) {
      const d = rule.data as unknown as PairRuleData
      const [a, b] = d.player_ids || []
      return `${getPlayerName(a)} — ${getPlayerName(b)}`
    }
    if (isMinCountRule(rule.rule_type)) {
      const d = rule.data as unknown as MinCountRuleData
      return `Mínimo: ${d.min_count} por equipo`
    }
    return JSON.stringify(rule.data)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Spinner />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reglas para armar equipos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing rules */}
        {rules.length === 0 && !addingType && (
          <p className="text-sm text-muted-foreground">
            No hay reglas configuradas. La IA armará equipos balanceados por rating.
          </p>
        )}

        {rules.map((rule) => {
          const config = RULE_LABELS[rule.rule_type as RuleType]
          return (
            <div key={rule.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <span className="text-muted-foreground shrink-0">{config?.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{config?.label || rule.rule_type}</p>
                <p className="text-xs text-muted-foreground truncate">{renderRuleDescription(rule)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeRule(rule.id)}
                aria-label="Quitar regla"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )
        })}

        {/* Add rule form */}
        {addingType && (
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <p className="text-sm font-medium">
              {RULE_LABELS[addingType]?.label}
            </p>

            {isPairRule(addingType) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Jugador A</Label>
                  <select
                    value={playerA}
                    onChange={(e) => setPlayerA(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Jugador B</Label>
                  <select
                    value={playerB}
                    onChange={(e) => setPlayerB(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {players.filter((p) => p.id !== playerA).map((p) => (
                      <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {isMinCountRule(addingType) && (
              <div>
                <Label className="text-xs">Cantidad mínima por equipo</Label>
                <Input
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
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingType(null)} className="flex-1 sm:flex-none">
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Add rule buttons */}
        {!addingType && (
          <div className="flex flex-wrap gap-2">
            {(Object.entries(RULE_LABELS) as [RuleType, typeof RULE_LABELS[RuleType]][]).map(([type, config]) => (
              <Button
                key={type}
                variant="outline"
                size="sm"
                onClick={() => setAddingType(type)}
              >
                <Plus className="mr-1 h-3 w-3" />
                {config.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
