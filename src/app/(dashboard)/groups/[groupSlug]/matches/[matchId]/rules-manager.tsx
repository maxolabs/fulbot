'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Shield, Users, Handshake, Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

interface Player {
  id: string
  display_name: string
}

interface Rule {
  id: string
  rule_type: string
  data: Record<string, unknown>
  is_active: boolean
}

interface RulesManagerProps {
  groupId: string
  matchId?: string
  players: Player[]
}

const RULE_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
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

export function RulesManager({ groupId, matchId, players }: RulesManagerProps) {
  const router = useRouter()
  const supabase = createClient()
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingType, setAddingType] = useState<string | null>(null)

  // Form state for pair rules
  const [playerA, setPlayerA] = useState('')
  const [playerB, setPlayerB] = useState('')
  // Form state for min rules
  const [minValue, setMinValue] = useState('1')

  useEffect(() => {
    const fetchRules = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (supabase as any)
        .from('rule_sets')
        .select('*')
        .eq('is_active', true)

      if (matchId) {
        query = query.or(`group_id.eq.${groupId},match_id.eq.${matchId}`)
      } else {
        query = query.eq('group_id', groupId).is('match_id', null)
      }

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
      let data: Record<string, unknown> = {}

      if (addingType === 'avoid_pair' || addingType === 'force_pair') {
        if (!playerA || !playerB || playerA === playerB) {
          alert('Seleccioná dos jugadores diferentes')
          setSaving(false)
          return
        }
        data = { player_id_a: playerA, player_id_b: playerB }
      } else if (addingType === 'min_defenders' || addingType === 'min_goalkeepers') {
        data = { min_count: parseInt(minValue) || 1 }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newRule, error } = await (supabase as any)
        .from('rule_sets')
        .insert({
          group_id: groupId,
          match_id: matchId || null,
          rule_type: addingType,
          data,
          is_active: true,
        })
        .select()
        .single()

      if (error) throw error

      setRules(prev => [...prev, newRule])
      setAddingType(null)
      setPlayerA('')
      setPlayerB('')
      setMinValue('1')
      router.refresh()
    } catch (err) {
      console.error('Error adding rule:', err)
      alert('Error al agregar regla')
    } finally {
      setSaving(false)
    }
  }

  const removeRule = async (ruleId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('rule_sets')
      .update({ is_active: false })
      .eq('id', ruleId)

    if (!error) {
      setRules(prev => prev.filter(r => r.id !== ruleId))
      router.refresh()
    }
  }

  const getPlayerName = (id: string) =>
    players.find(p => p.id === id)?.display_name || 'Desconocido'

  const renderRuleDescription = (rule: Rule) => {
    const d = rule.data as Record<string, string | number>
    if (rule.rule_type === 'avoid_pair' || rule.rule_type === 'force_pair') {
      return `${getPlayerName(d.player_id_a as string)} — ${getPlayerName(d.player_id_b as string)}`
    }
    if (rule.rule_type === 'min_defenders' || rule.rule_type === 'min_goalkeepers') {
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
          const config = RULE_LABELS[rule.rule_type]
          return (
            <div key={rule.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <span className="text-muted-foreground">{config?.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{config?.label || rule.rule_type}</p>
                <p className="text-xs text-muted-foreground">{renderRuleDescription(rule)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => removeRule(rule.id)}>
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

            {(addingType === 'avoid_pair' || addingType === 'force_pair') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Jugador A</Label>
                  <select
                    value={playerA}
                    onChange={(e) => setPlayerA(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Seleccionar...</option>
                    {players.map(p => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
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
                    {players.filter(p => p.id !== playerA).map(p => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {(addingType === 'min_defenders' || addingType === 'min_goalkeepers') && (
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

            <div className="flex gap-2">
              <Button size="sm" onClick={addRule} disabled={saving}>
                {saving && <Spinner size="sm" className="mr-2" />}
                Guardar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAddingType(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Add rule buttons */}
        {!addingType && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(RULE_LABELS).map(([type, config]) => (
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
