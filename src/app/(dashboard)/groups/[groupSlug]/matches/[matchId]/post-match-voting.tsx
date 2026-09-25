'use client'

import { useState, useEffect, useCallback } from 'react'
import { Star, Check, Lock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/i18n/provider'

// Optional player ratings (1-5) after a match: everyone who played, both teams. The MVP vote moved into the
// report form (report-form.tsx); this card is independent of it and can be
// filled or edited any time inside the reporting window (RLS allows own
// UPDATE/DELETE there, see 00020_match_reports.sql).

interface Player {
  id: string
  display_name: string
  nickname: string | null
  main_position: string
}

interface PostMatchVotingProps {
  matchId: string
  currentPlayerId: string
  players: Player[]
  windowOpen: boolean
}

export function PostMatchVoting({
  matchId,
  currentPlayerId,
  players,
  windowOpen,
}: PostMatchVotingProps) {
  const supabase = createClient()
  const t = useT()
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const otherPlayers = players.filter(p => p.id !== currentPlayerId)

  const loadExisting = useCallback(async () => {
    const { data } = await supabase
      .from('match_ratings')
      .select('rated_player_id, rating')
      .eq('match_id', matchId)
      .eq('voter_player_id', currentPlayerId)

    const existing: Record<string, number> = {}
    for (const row of data || []) existing[row.rated_player_id] = row.rating
    setSaved(existing)
    setRatings(existing)
    setEditing(Object.keys(existing).length === 0)
    setLoaded(true)
  }, [supabase, matchId, currentPlayerId])

  useEffect(() => {
    loadExisting()
  }, [loadExisting])

  const handleSubmit = async () => {
    if (!windowOpen) return
    setLoading(true)
    setError(null)

    try {
      const toUpsert = Object.entries(ratings)
        .filter(([, r]) => r > 0)
        .map(([playerId, rating]) => ({
          match_id: matchId,
          voter_player_id: currentPlayerId,
          rated_player_id: playerId,
          rating,
        }))
      const toDelete = Object.keys(saved).filter(playerId => !(ratings[playerId] > 0))

      if (toUpsert.length > 0) {
        const { error: upsertError } = await supabase
          .from('match_ratings')
          .upsert(toUpsert, { onConflict: 'match_id,voter_player_id,rated_player_id' })
        if (upsertError) throw upsertError
      }

      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('match_ratings')
          .delete()
          .eq('match_id', matchId)
          .eq('voter_player_id', currentPlayerId)
          .in('rated_player_id', toDelete)
        if (deleteError) throw deleteError
      }

      await loadExisting()
    } catch (err) {
      console.error('Error saving ratings:', err)
      setError(t('ui.ratingsCard.saveError'))
    } finally {
      setLoading(false)
    }
  }

  if (!loaded || otherPlayers.length === 0) return null

  const savedCount = Object.keys(saved).length

  if (!editing || !windowOpen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" strokeWidth={1.75} />
            {t('ui.ratingsCard.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {savedCount > 0
              ? savedCount === 1
                ? t('ui.postMatch.ratedOne')
                : t('ui.postMatch.ratedMany', { count: savedCount })
              : t('ui.ratingsCard.none')}
          </p>
          {windowOpen ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              {savedCount > 0 ? t('common.edit') : t('ui.ratingsCard.rate')}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {t('ui.ratingsCard.closed')}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Star className="h-5 w-5 text-primary" strokeWidth={1.75} />
          {t('ui.postMatch.rateTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">{t('ui.ratingsCard.privateHint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {otherPlayers.map((player) => (
            <div key={player.id} className="flex items-center gap-3">
              <span className="text-sm flex-1 truncate">{player.display_name}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => {
                      setRatings(prev => ({
                        ...prev,
                        [player.id]: prev[player.id] === star ? 0 : star,
                      }))
                    }}
                    className="p-0.5"
                    aria-label={star === 1 ? t('ui.ratingsCard.starOne', { name: player.display_name }) : t('ui.ratingsCard.starMany', { n: star, name: player.display_name })}
                  >
                    <Star
                      className={`h-5 w-5 transition-colors ${
                        (ratings[player.id] || 0) >= star
                          ? 'fill-primary text-primary'
                          : 'text-muted-foreground'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={loading} className="flex-1">
            {loading ? <Spinner size="sm" className="mr-2" /> : <Check className="mr-2 h-4 w-4" />}
            {t('ui.ratingsCard.save')}
          </Button>
          {savedCount > 0 && (
            <Button variant="ghost" onClick={() => { setRatings(saved); setEditing(false) }} disabled={loading}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
