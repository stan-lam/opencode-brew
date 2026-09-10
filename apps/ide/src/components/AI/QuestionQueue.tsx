import React, { useState, useCallback, useMemo } from 'react';
import {
  Send,
  SkipForward,
  AlertCircle,
  CheckCircle,
  Loader2,
  HelpCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useQuestionStore } from '../../store/questionStore';
import { QuestionCard } from './QuestionCard';
import styles from './QuestionQueue.module.css';

export const QuestionQueue: React.FC = () => {
  const {
    batches,
    currentBatchIndex,
    answers,
    isProcessing,
    answerQuestion,
    submitAnswers,
    skipBatch,
  } = useQuestionStore();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  const currentBatch = batches[currentBatchIndex];
  
  if (!currentBatch || currentBatch.questions.length === 0) {
    return null;
  }

  const currentQuestion = currentBatch.questions[currentQuestionIndex];
  const totalQuestions = currentBatch.questions.length;
  const isBlocking = currentBatch.blocking;

  // Count answered questions
  const answeredCount = currentBatch.questions.filter(
    q => answers[q.id] !== undefined
  ).length;

  // Check if all required questions are answered
  const requiredQuestions = currentBatch.questions.filter(q => q.required !== false);
  const allRequiredAnswered = requiredQuestions.every(q => answers[q.id] !== undefined);

  const handleAnswer = useCallback((questionId: string, value: string | string[], customValue?: string) => {
    answerQuestion(questionId, value, customValue);
  }, [answerQuestion]);

  const handleSubmit = useCallback(async () => {
    await submitAnswers();
    setCurrentQuestionIndex(0);
  }, [submitAnswers]);

  const handleSkip = useCallback(() => {
    skipBatch();
    setCurrentQuestionIndex(0);
  }, [skipBatch]);

  const goToPrevQuestion = useCallback(() => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  }, [currentQuestionIndex]);

  const goToNextQuestion = useCallback(() => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  }, [currentQuestionIndex, totalQuestions]);

  return (
    <div className={styles.questionQueue}>
      {/* Header */}
      <div className={styles.queueHeader}>
        <div className={styles.headerLeft}>
          <HelpCircle size={20} className={styles.headerIcon} />
          <span className={styles.headerTitle}>
            {currentBatch.title || 'Questions from AI'}
          </span>
          {isBlocking && (
            <span className={styles.blockingBadge}>
              <AlertCircle size={14} />
              Blocking
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <span className={styles.progressText}>
            {answeredCount} / {totalQuestions} answered
          </span>
        </div>
      </div>

      {/* Context/Description */}
      {currentBatch.description && (
        <div className={styles.queueContext}>
          {currentBatch.description}
        </div>
      )}

      {/* Question Navigation */}
      {totalQuestions > 1 && (
        <div className={styles.questionNav}>
          <button
            className={styles.navButton}
            onClick={goToPrevQuestion}
            disabled={currentQuestionIndex === 0}
          >
            <ChevronLeft size={16} />
          </button>
          <div className={styles.questionIndicators}>
            {currentBatch.questions.map((q, idx) => (
              <button
                key={q.id}
                className={`${styles.indicator} ${idx === currentQuestionIndex ? styles.indicatorActive : ''} ${answers[q.id] !== undefined ? styles.indicatorAnswered : ''}`}
                onClick={() => setCurrentQuestionIndex(idx)}
                title={q.prompt.substring(0, 50) + (q.prompt.length > 50 ? '...' : '')}
              >
                {answers[q.id] !== undefined ? (
                  <CheckCircle size={12} />
                ) : (
                  <span className={styles.indicatorDot} />
                )}
              </button>
            ))}
          </div>
          <button
            className={styles.navButton}
            onClick={goToNextQuestion}
            disabled={currentQuestionIndex === totalQuestions - 1}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Current Question */}
      <div className={styles.questionContainer}>
        <QuestionCard
          question={currentQuestion}
          value={answers[currentQuestion.id]?.value}
          onAnswer={(value, customValue) => handleAnswer(currentQuestion.id, value, customValue)}
          disabled={isProcessing}
        />
      </div>

      {/* Actions */}
      <div className={styles.queueActions}>
        <button
          className={styles.skipButton}
          onClick={handleSkip}
          disabled={isProcessing || isBlocking}
          title={isBlocking ? 'Cannot skip blocking questions' : 'Skip these questions'}
        >
          <SkipForward size={16} />
          Skip
        </button>

        <div className={styles.actionRight}>
          {!allRequiredAnswered && (
            <span className={styles.requiredHint}>
              <AlertCircle size={14} />
              {requiredQuestions.length - answeredCount} required
            </span>
          )}
          <button
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={isProcessing || !allRequiredAnswered}
          >
            {isProcessing ? (
              <>
                <Loader2 size={16} className={styles.spinner} />
                Processing...
              </>
            ) : (
              <>
                <Send size={16} />
                Submit Answers
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionQueue;
