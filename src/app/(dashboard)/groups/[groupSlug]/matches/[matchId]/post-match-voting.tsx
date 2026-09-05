'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, Star, Check, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Spinner } from '@/components/ui/spinner'
import { createClient } from '@/lib/supabase/client'

const VOTING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

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
  matchDateTime: string
}

export function PostMatchVoting({
  matchId,
  currentPlayerId,
  players,
  matchDateTime,
}: PostMatchVotingProps) {
  const router = useRouter()
  const supabase = createClient()
  const [mvpVote, setMvpVote] = useState<string | null>(null)
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [existingVote, setExistingVote] = useState(false)
  const [mvpResults, setMvpResults] = useState<{ player_id: string; votes: number }[]>([])

  // Players who didn't show up are never candidates (they're excluded from
  // `players` upstream too, but this keeps the component defensive on its own).
  const otherPlayers = players.filter(p => p.id !== currentPlayerId)

  const votingOpen = Date.now() - new Date(matchDateTime).getTime() < VOTING_WINDOW_MS

  useEffect(() => {
    // Check if already voted
    const checkExisting = async () => {
      const { data: existingMvp } = await supabase
        .from('match_mvp_votes')
        .select('id')
        .eq('match_id', matchId)
        .eq('voter_player_id', currentPlayerId)
        .maybeSingle()

      if (existingMvp) {
        setExistingVote(true)
      }

      // Get MVP results
      const { data: votes } = await supabase
        .from('match_mvp_votes')
        .select('candidate_player_id')
        .eq('match_id', matchId)

      if (votes && votes.length > 0) {
        const counts: Record<string, number> = {}
        for (const v of votes) {
          counts[v.candidate_player_id] = (counts[v.candidate_player_id] || 0) + 1
        }
        const results = Object.entries(counts)
          .map(([player_id, voteCount]) => ({ player_id, votes: voteCount }))
          .sort((a, b) => b.votes - a.votes)
        setMvpResults(results)
      }
    }
    checkExisting()
  }, [matchId, currentPlayerId, supabase])

  const handleSubmit = async () => {
    if (!mvpVote || !votingOpen) return

    setLoading(true)

    try {
      // Submit MVP vote
      const { error: mvpError } = await supabase
        .from('match_mvp_votes')
        .insert({
          match_id: matchId,
          voter_player_id: currentPlayerId,
          candidate_player_id: mvpVote,
        })

      if (mvpError) throw mvpError

      // Submit ratings
      const ratingEntries = Object.entries(ratings).filter(([, r]) => r > 0)
      if (ratingEntries.length > 0) {
        const { error: ratingsError } = await supabase
          .from('match_ratings')
          .insert(
            ratingEntries.map(([playerId, rating]) => ({
              match_id: matchId,
              voter_player_id: currentPlayerId,
              rated_player_id: playerId,
              rating,
            }))
          )

        if (ratingsError) throw ratingsError
      }

      setSubmitted(true)
      setExistingVote(true)
      router.refresh()
    } catch (err) {
      console.error('Error submitting votes:', err)
      alert('Error al enviar los votos')
    } finally {
      setLoading(false)
    }
  }

  // Already voted, or the 7-day window closed - show results (top 3 only,
  // no shaming of anyone at the bottom).
  if (existingVote || submitted || !votingOpen) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5 text-yellow-500" />
            {submitted ? '¡Voto registrado!' : 'MVP del partido'}
          </CardTitle>
          {!votingOpen && !submitted && (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <Lock className="h-3.5 w-3.5" />
              La votación cerró
            </p>
          )}
        </CardHeader>
        <CardContent>
          {mvpResults.length > 0 ? (
            <div className="space-y-2">
              {mvpResults.slice(0, 3).map((result, i) => {
                const player = players.find(p => p.id === result.player_id)
                if (!player) return null
                return (
                  <div key={result.player_id} className="flex items-center gap-3">
                    <span className={`text-lg font-bold ${i === 0 ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                      {i === 0 ? '🏆' : `#${i + 1}`}
                    </span>
                    <Avatar fallback={player.display_name} size="sm" />
                    <span className="flex-1 font-medium text-sm">{player.display_name}</span>
                    <span className="text-sm text-muted-foreground">
                      {result.votes} {result.votes === 1 ? 'voto' : 'votos'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {submitted ? 'Sos el primero en votar. Los resultados aparecerán cuando voten más jugadores.' : 'Todavía no hay votos.'}
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
          <Trophy className="h-5 w-5 text-yellow-500" />
          Votá al MVP del partido
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* MVP Selection */}
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">¿Quién fue el mejor jugador?</p>
          <div className="grid gap-2">
            {otherPlayers.map((player) => (
              <button
                key={player.id}
                onClick={() => setMvpVote(player.id)}
                className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  mvpVote === player.id
                    ? 'border-yellow-500 bg-yellow-500/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <Avatar fallback={player.display_name} size="sm" />
                <div className="flex-1">
                  <span className="text-sm font-medium">{player.display_name}</span>
                  {player.nickname && (
                    <span className="text-xs text-muted-foreground ml-1">({player.nickname})</span>
                  )}
                </div>
                {mvpVote === player.id && (
                  <Trophy className="h-4 w-4 text-yellow-500" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Player Ratings */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Calificá a tus compañeros (opcional)</p>
          {otherPlayers.map((player) => (
            <div key={player.id} className="flex items-center gap-3">
              <span className="text-sm flex-1 truncate">{player.display_name}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => {
                      setRatings(prev => ({
                        ...prev,
                        [player.id]: prev[player.id] === star ? 0 : star,
                      }))
                    }}
                    className="p-0.5"
                  >
                    <Star
                      className={`h-5 w-5 transition-colors ${
                        (ratings[player.id] || 0) >= star
                          ? 'text-yellow-500 fill-yellow-500'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!mvpVote || loading}
          className="w-full"
        >
          {loading ? (
            <Spinner size="sm" className="mr-2" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          Enviar voto
        </Button>
      </CardContent>
    </Card>
  )
}
