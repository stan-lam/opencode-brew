import { create } from 'zustand';
import type {
  QuestionBatch,
  QuestionAnswer,
  StructuredQuestion,
  QuestionQueueState,
  QuestionCategory,
} from '../types/questions';

interface QuestionStoreState extends QuestionQueueState {
  // Additional state for UI components
  batches: QuestionBatch[];
  currentBatchIndex: number;
  isProcessing: boolean;
  
  // Actions
  showQuestions: (batch: QuestionBatch) => void;
  answerQuestion: (questionId: string, value: string | string[], customValue?: string) => void;
  submitAnswers: () => Promise<Record<string, QuestionAnswer>>;
  skipBatch: () => void;
  clearQueue: () => void;
  
  // Computed
  isAllAnswered: () => boolean;
  getUnansweredRequired: () => StructuredQuestion[];
  
  // Callbacks for agent resumption
  onAnswersSubmitted: ((answers: Record<string, QuestionAnswer>) => void) | null;
  setOnAnswersSubmitted: (callback: ((answers: Record<string, QuestionAnswer>) => void) | null) => void;
  
  // Parse question tags from agent response
  parseQuestionTags: (content: string) => QuestionBatch | null;
}

export const useQuestionStore = create<QuestionStoreState>((set, get) => ({
  // Initial state
  currentBatch: null,
  answers: {},
  isBlocking: false,
  pendingBatches: [],
  completedBatches: [],
  onAnswersSubmitted: null,
  
  // UI state
  batches: [],
  currentBatchIndex: 0,
  isProcessing: false,

  // Show a batch of questions to the user
  showQuestions: (batch: QuestionBatch) => {
    const { currentBatch, pendingBatches, batches } = get();
    
    if (currentBatch) {
      // Queue this batch if there's already one showing
      set({ 
        pendingBatches: [...pendingBatches, batch],
        batches: [...batches, batch],
      });
    } else {
      // Show this batch immediately
      set({
        currentBatch: batch,
        isBlocking: batch.blocking,
        answers: {},
        batches: [batch],
        currentBatchIndex: 0,
      });
    }
  },

  // Record an answer to a question
  answerQuestion: (questionId: string, value: string | string[], customValue?: string) => {
    const answer: QuestionAnswer = {
      questionId,
      value,
      customValue,
      answeredAt: new Date().toISOString(),
    };
    
    set(state => ({
      answers: {
        ...state.answers,
        [questionId]: answer,
      },
    }));
  },

  // Submit all answers and return them
  submitAnswers: async () => {
    const { currentBatch, answers, pendingBatches, completedBatches, onAnswersSubmitted, batches, currentBatchIndex } = get();
    
    if (!currentBatch) {
      return {};
    }

    set({ isProcessing: true });

    // Mark batch as completed
    const newCompletedBatches = [...completedBatches, currentBatch.id];
    
    // Get next batch if any
    const [nextBatch, ...remainingBatches] = pendingBatches;
    
    // Store current answers before clearing
    const submittedAnswers = { ...answers };
    
    // Update batches array - remove completed batch
    const newBatches = batches.filter((_, idx) => idx !== currentBatchIndex);
    
    set({
      currentBatch: nextBatch || null,
      isBlocking: nextBatch?.blocking || false,
      answers: nextBatch ? {} : {},
      pendingBatches: remainingBatches,
      completedBatches: newCompletedBatches,
      batches: newBatches,
      currentBatchIndex: 0,
      isProcessing: false,
    });

    // Notify callback if set
    if (onAnswersSubmitted) {
      onAnswersSubmitted(submittedAnswers);
    }
    
    return submittedAnswers;
  },

  // Skip the current batch without answering
  skipBatch: () => {
    const { currentBatch, pendingBatches, completedBatches, onAnswersSubmitted, batches, currentBatchIndex } = get();
    
    if (!currentBatch) return;

    // Get next batch
    const [nextBatch, ...remainingBatches] = pendingBatches;
    
    // Update batches array - remove skipped batch
    const newBatches = batches.filter((_, idx) => idx !== currentBatchIndex);
    
    set({
      currentBatch: nextBatch || null,
      isBlocking: nextBatch?.blocking || false,
      answers: {},
      pendingBatches: remainingBatches,
      completedBatches: [...completedBatches, currentBatch.id],
      batches: newBatches,
      currentBatchIndex: 0,
    });

    // Notify callback with empty answers
    if (onAnswersSubmitted) {
      onAnswersSubmitted({});
    }
  },

  // Clear all questions
  clearQueue: () => {
    set({
      currentBatch: null,
      answers: {},
      isBlocking: false,
      pendingBatches: [],
      completedBatches: [],
      batches: [],
      currentBatchIndex: 0,
      isProcessing: false,
    });
  },

  // Check if all required questions are answered
  isAllAnswered: () => {
    const { currentBatch, answers } = get();
    
    if (!currentBatch) return true;
    
    const requiredQuestions = currentBatch.questions.filter(q => q.required !== false);
    return requiredQuestions.every(q => answers[q.id] !== undefined);
  },

  // Get unanswered required questions
  getUnansweredRequired: () => {
    const { currentBatch, answers } = get();
    
    if (!currentBatch) return [];
    
    return currentBatch.questions.filter(
      q => q.required !== false && answers[q.id] === undefined
    );
  },

  // Set callback for when answers are submitted
  setOnAnswersSubmitted: (callback) => {
    set({ onAnswersSubmitted: callback });
  },
  
  // Parse question tags from agent response - returns first batch or null
  parseQuestionTags: (content: string) => {
    const batches = parseQuestionTagsHelper(content);
    return batches.length > 0 ? batches[0] : null;
  },
}));

// Helper function to parse <ask_questions> XML from agent response
function parseQuestionTagsHelper(content: string): QuestionBatch[] {
  const batches: QuestionBatch[] = [];
  
  // Match <ask_questions> blocks
  const batchRegex = /<ask_questions([^>]*)>([\s\S]*?)<\/ask_questions>/g;
  let batchMatch;
  
  while ((batchMatch = batchRegex.exec(content)) !== null) {
    const attrsStr = batchMatch[1];
    const innerContent = batchMatch[2];
    
    // Parse batch attributes
    const blocking = /blocking\s*=\s*["']true["']/i.test(attrsStr);
    const categoryMatch = attrsStr.match(/category\s*=\s*["']([^"']+)["']/i);
    const category = categoryMatch?.[1] as QuestionCategory | undefined;
    
    // Parse individual questions
    const questions = parseQuestionsFromContent(innerContent);
    
    if (questions.length > 0) {
      batches.push({
        id: `batch-${Date.now()}-${batches.length}`,
        questions,
        blocking,
        category,
      });
    }
  }
  
  // Also match single <ask_question> tags
  const singleRegex = /<ask_question([^>]*)>([\s\S]*?)<\/ask_question>/g;
  let singleMatch;
  
  while ((singleMatch = singleRegex.exec(content)) !== null) {
    const attrsStr = singleMatch[1];
    const innerContent = singleMatch[2];
    
    const blocking = /blocking\s*=\s*["']true["']/i.test(attrsStr);
    const categoryMatch = attrsStr.match(/category\s*=\s*["']([^"']+)["']/i);
    const category = categoryMatch?.[1] as QuestionCategory | undefined;
    const idMatch = attrsStr.match(/id\s*=\s*["']([^"']+)["']/i);
    const titleMatch = attrsStr.match(/title\s*=\s*["']([^"']+)["']/i);
    
    const question = parseSingleQuestion(innerContent, idMatch?.[1], titleMatch?.[1]);
    
    if (question) {
      batches.push({
        id: `batch-${Date.now()}-${batches.length}`,
        questions: [question],
        blocking,
        category,
      });
    }
  }
  
  return batches;
}

// Parse questions from inner content of <ask_questions>
function parseQuestionsFromContent(content: string): StructuredQuestion[] {
  const questions: StructuredQuestion[] = [];
  
  const questionRegex = /<question([^>]*)>([\s\S]*?)<\/question>/g;
  let match;
  
  while ((match = questionRegex.exec(content)) !== null) {
    const attrsStr = match[1];
    const innerContent = match[2];
    
    const idMatch = attrsStr.match(/id\s*=\s*["']([^"']+)["']/i);
    const categoryMatch = attrsStr.match(/category\s*=\s*["']([^"']+)["']/i);
    
    const question = parseSingleQuestion(
      innerContent,
      idMatch?.[1],
      undefined,
      categoryMatch?.[1] as QuestionCategory | undefined
    );
    
    if (question) {
      questions.push(question);
    }
  }
  
  return questions;
}

// Parse a single question's content
function parseSingleQuestion(
  content: string,
  id?: string,
  title?: string,
  category?: QuestionCategory
): StructuredQuestion | null {
  // Extract prompt
  const promptMatch = content.match(/<prompt>([\s\S]*?)<\/prompt>/);
  const prompt = promptMatch?.[1]?.trim();
  
  if (!prompt) return null;
  
  // Extract options
  const options: StructuredQuestion['options'] = [];
  const optionRegex = /<option([^>]*)>([^<]*)<\/option>/g;
  let optionMatch;
  
  while ((optionMatch = optionRegex.exec(content)) !== null) {
    const optionAttrs = optionMatch[1];
    const optionText = optionMatch[2].trim();
    
    const optionIdMatch = optionAttrs.match(/id\s*=\s*["']([^"']+)["']/i);
    const recommendedMatch = optionAttrs.match(/recommended\s*=\s*["']true["']/i);
    const iconMatch = optionAttrs.match(/icon\s*=\s*["']([^"']+)["']/i);
    
    options.push({
      id: optionIdMatch?.[1] || `option-${options.length}`,
      label: optionText,
      recommended: !!recommendedMatch,
      icon: iconMatch?.[1],
    });
  }
  
  // If no options found, this might be a free-text question
  const allowCustom = options.length === 0 || content.includes('allowCustom="true"');
  
  return {
    id: id || `question-${Date.now()}`,
    title,
    prompt,
    options,
    allowMultiple: content.includes('allowMultiple="true"'),
    allowCustom,
    required: !content.includes('required="false"'),
    category,
  };
}

// Format answers for injection back into agent context
export function formatAnswersForAgent(answers: Record<string, QuestionAnswer>): string {
  if (Object.keys(answers).length === 0) {
    return '';
  }
  
  const lines = ['## User Answers\n'];
  
  for (const [questionId, answer] of Object.entries(answers)) {
    const value = Array.isArray(answer.value) 
      ? answer.value.join(', ') 
      : answer.value;
    
    lines.push(`- **${questionId}**: ${value}`);
    
    if (answer.customValue) {
      lines.push(`  - Custom input: ${answer.customValue}`);
    }
  }
  
  return lines.join('\n');
}

// Check if content contains any question tags
export function hasQuestionTags(content: string): boolean {
  return /<ask_question[s]?\s/i.test(content);
}

// Export the helper for external use (backward compatibility)
export { parseQuestionTagsHelper as parseQuestionTags };
