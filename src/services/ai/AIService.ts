import { AIProviderConfig, AIMessage } from '../../store/aiStore';

export interface AIResponse {
  content: string;
  thinking?: string;
  finishReason: 'stop' | 'length' | 'error';
}

export interface StreamCallback {
  onToken: (token: string) => void;
  onThinking?: (thought: string) => void;
  onComplete: (response: AIResponse) => void;
  onError: (error: Error) => void;
}

export interface ExtendedThinkingConfig {
  enabled: boolean;
  budgetTokens?: number;
}

export class AIService {
  private config: AIProviderConfig;
  private abortController: AbortController | null = null;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  updateConfig(config: AIProviderConfig) {
    this.config = config;
  }

  stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async chat(
    messages: AIMessage[], 
    stream?: StreamCallback,
    extendedThinking?: ExtendedThinkingConfig
  ): Promise<AIResponse> {
    switch (this.config.provider) {
      case 'ollama':
        return this.chatOllama(messages, stream);
      case 'claude':
        return this.chatClaude(messages, stream, extendedThinking);
      case 'openai':
        return this.chatOpenAI(messages, stream);
      case 'custom':
        return this.chatCustom(messages, stream);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  private async chatOllama(messages: AIMessage[], stream?: StreamCallback): Promise<AIResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';
    
    const requestBody = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: !!stream,
      options: {
        temperature: this.config.temperature,
        num_predict: this.config.maxTokens,
      },
    };

    if (stream) {
      this.abortController = new AbortController();
      
      try {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Ollama error: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let fullContent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.message?.content) {
                fullContent += data.message.content;
                stream.onToken(data.message.content);
              }
              if (data.done) {
                const response: AIResponse = {
                  content: fullContent,
                  finishReason: 'stop',
                };
                stream.onComplete(response);
                this.abortController = null;
                return response;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        this.abortController = null;
        return { content: fullContent, finishReason: 'stop' };
      } catch (error: any) {
        this.abortController = null;
        if (error.name === 'AbortError') {
          const response: AIResponse = {
            content: '',
            finishReason: 'stop',
          };
          stream.onComplete(response);
          return response;
        }
        throw error;
      }
    } else {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        content: data.message?.content || '',
        finishReason: 'stop',
      };
    }
  }

  private async chatClaude(
    messages: AIMessage[], 
    stream?: StreamCallback,
    extendedThinking?: ExtendedThinkingConfig
  ): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error('Claude API key is required');
    }

    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: systemMessage?.content || this.config.systemPrompt,
      messages: chatMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: !!stream,
    };

    // Add extended thinking if enabled and using a supported model
    if (extendedThinking?.enabled && this.config.model.includes('claude-3')) {
      requestBody.thinking = {
        type: 'enabled',
        budget_tokens: extendedThinking.budgetTokens || 10000,
      };
    }

    if (stream) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude error: ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';
      let fullThinking = '';
      let currentBlockType = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          const jsonStr = line.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const data = JSON.parse(jsonStr);
            
            // Track which block we're in
            if (data.type === 'content_block_start') {
              currentBlockType = data.content_block?.type || '';
            }
            
            // Handle thinking blocks
            if (data.type === 'content_block_delta' && data.delta?.type === 'thinking_delta') {
              fullThinking += data.delta.thinking || '';
              stream.onThinking?.(data.delta.thinking || '');
            }
            
            // Handle text blocks
            if (data.type === 'content_block_delta' && data.delta?.text) {
              fullContent += data.delta.text;
              stream.onToken(data.delta.text);
            }
            
            if (data.type === 'message_stop') {
              const response: AIResponse = {
                content: fullContent,
                thinking: fullThinking || undefined,
                finishReason: 'stop',
              };
              stream.onComplete(response);
              return response;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      return { content: fullContent, thinking: fullThinking || undefined, finishReason: 'stop' };
    } else {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude error: ${error}`);
      }

      const data = await response.json();
      
      // Extract thinking and text from response
      let thinking = '';
      let content = '';
      
      for (const block of data.content || []) {
        if (block.type === 'thinking') {
          thinking = block.thinking || '';
        } else if (block.type === 'text') {
          content = block.text || '';
        }
      }
      
      return {
        content,
        thinking: thinking || undefined,
        finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
      };
    }
  }

  private async chatOpenAI(messages: AIMessage[], stream?: StreamCallback): Promise<AIResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const baseUrl = this.config.baseUrl || 'https://api.openai.com/v1';

    const requestBody = {
      model: this.config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: !!stream,
    };

    if (stream) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI error: ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          const jsonStr = line.slice(6);
          if (jsonStr === '[DONE]') {
            const response: AIResponse = {
              content: fullContent,
              finishReason: 'stop',
            };
            stream.onComplete(response);
            return response;
          }

          try {
            const data = JSON.parse(jsonStr);
            const token = data.choices?.[0]?.delta?.content;
            if (token) {
              fullContent += token;
              stream.onToken(token);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      return { content: fullContent, finishReason: 'stop' };
    } else {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI error: ${error}`);
      }

      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || '',
        finishReason: data.choices?.[0]?.finish_reason === 'stop' ? 'stop' : 'length',
      };
    }
  }

  private async chatCustom(messages: AIMessage[], stream?: StreamCallback): Promise<AIResponse> {
    // Custom endpoint - assume OpenAI-compatible API
    return this.chatOpenAI(messages, stream);
  }

  async listOllamaModels(): Promise<string[]> {
    try {
      const baseUrl = this.config.baseUrl || 'http://localhost:11434';
      const response = await fetch(`${baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  async checkOllamaConnection(): Promise<boolean> {
    try {
      const baseUrl = this.config.baseUrl || 'http://localhost:11434';
      const response = await fetch(`${baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const aiService = new AIService({
  provider: 'ollama',
  model: 'llama3',
  baseUrl: 'http://localhost:11434',
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful coding assistant.',
});
