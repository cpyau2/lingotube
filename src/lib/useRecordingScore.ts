// Shared hook for recording, transcription, and scoring
// Used by both ArticlePractice and ShadowPanel

import { useCallback, useRef, useState } from 'react'
import { db } from './db'
import { calculateDetailedScore, type ScoringResult } from './scoring'

export interface UseRecordingScoreOptions {
  onScoreCalculated?: (score: number) => void
  storageKey?: string // Key for storing recording in IndexedDB
}

export function useRecordingScore(options: UseRecordingScoreOptions = {}) {
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [scoringResult, setScoringResult] = useState<ScoringResult | null>(null)
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recognitionRef = useRef<any>(null)
  
  const hasMediaRecorder = typeof MediaRecorder !== 'undefined'
  const hasSpeechRecognition = typeof (window as any).SpeechRecognition !== 'undefined' || 
                                typeof (window as any).webkitSpeechRecognition !== 'undefined'

  // Initialize SpeechRecognition (fallback only)
  const initRecognition = useCallback(() => {
    if (!hasSpeechRecognition || recognitionRef.current) return
    
    const SpeechRecog = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecog()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognitionRef.current = recognition
  }, [hasSpeechRecognition])

  // Start recording
  const startRecording = useCallback(async () => {
    if (!hasMediaRecorder) return false
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setRecordedBlob(blob)
        stream.getTracks().forEach(track => track.stop())
        
        // Save to IndexedDB if storageKey provided
        if (options.storageKey) {
          await db.recordings.put({
            key: options.storageKey,
            blob,
            createdAt: Date.now(),
          })
        }
      }
      
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
      return true
    } catch (e) {
      console.error('Recording failed:', e)
      return false
    }
  }, [hasMediaRecorder, options.storageKey])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }, [recording])

  // Transcribe and score via Workers AI Whisper
  const transcribeAndScore = useCallback(async (blob: Blob, targetText: string) => {
    setTranscribing(true)
    setScoringResult(null)
    
    let transcript = ''
    
    // Try Workers AI Whisper first
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'recording.webm')
      
      const resp = await fetch('/api/stt', {
        method: 'POST',
        body: formData,
      })
      
      if (resp.ok) {
        const data = await resp.json()
        transcript = data.text || ''
      }
    } catch (e) {
      console.error('Whisper STT failed:', e)
    }
    
    // Fallback to browser SpeechRecognition (limited - can't process blob)
    if (!transcript && hasSpeechRecognition) {
      console.log('SpeechRecognition fallback not available for recorded audio')
      // Browser SpeechRecognition can't process pre-recorded blobs, only live mic
    }
    
    // Calculate score
    const result = calculateDetailedScore(targetText, transcript)
    setScoringResult(result)
    setTranscribing(false)
    
    // Callback
    if (options.onScoreCalculated) {
      options.onScoreCalculated(result.score)
    }
    
    return result
  }, [hasSpeechRecognition, options])

  // Auto-transcribe current blob
  const autoTranscribeAndScore = useCallback(async (targetText: string) => {
    if (!recordedBlob) return null
    return await transcribeAndScore(recordedBlob, targetText)
  }, [recordedBlob, transcribeAndScore])

  // Play recording
  const playRecording = useCallback(() => {
    if (!recordedBlob) return
    const audio = new Audio(URL.createObjectURL(recordedBlob))
    audio.play()
    audio.onended = () => URL.revokeObjectURL(audio.src)
  }, [recordedBlob])

  // Load cached recording
  const loadCachedRecording = useCallback(async (key: string) => {
    const cached = await db.recordings.get(key)
    if (cached?.blob) {
      setRecordedBlob(cached.blob)
      return true
    }
    return false
  }, [])

  // Reset state
  const reset = useCallback(() => {
    setRecordedBlob(null)
    setScoringResult(null)
    setTranscribing(false)
  }, [])

  // Cleanup
  const cleanup = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop()
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
  }, [recording])

  return {
    // State
    recording,
    recordedBlob,
    transcribing,
    scoringResult,
    hasMediaRecorder,
    hasSpeechRecognition,
    
    // Actions
    startRecording,
    stopRecording,
    transcribeAndScore,
    autoTranscribeAndScore,
    playRecording,
    loadCachedRecording,
    reset,
    cleanup,
    initRecognition,
  }
}
