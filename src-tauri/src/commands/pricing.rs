use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_write_per_million: f64,
    pub cache_read_per_million: f64,
}

impl Default for ModelPricing {
    fn default() -> Self {
        Self {
            input_per_million: 0.0,
            output_per_million: 0.0,
            cache_write_per_million: 0.0,
            cache_read_per_million: 0.0,
        }
    }
}

impl ModelPricing {
    pub fn new(input: f64, output: f64) -> Self {
        Self {
            input_per_million: input,
            output_per_million: output,
            cache_write_per_million: input * 1.25, // Default: 25% more than input
            cache_read_per_million: input * 0.1,   // Default: 90% discount
        }
    }

    pub fn with_cache(input: f64, output: f64, cache_write: f64, cache_read: f64) -> Self {
        Self {
            input_per_million: input,
            output_per_million: output,
            cache_write_per_million: cache_write,
            cache_read_per_million: cache_read,
        }
    }

    pub fn calculate_cost(
        &self,
        prompt_tokens: i64,
        completion_tokens: i64,
        cache_creation_tokens: i64,
        cache_read_tokens: i64,
    ) -> f64 {
        let input_cost = (prompt_tokens as f64 / 1_000_000.0) * self.input_per_million;
        let output_cost = (completion_tokens as f64 / 1_000_000.0) * self.output_per_million;
        let cache_write_cost =
            (cache_creation_tokens as f64 / 1_000_000.0) * self.cache_write_per_million;
        let cache_read_cost =
            (cache_read_tokens as f64 / 1_000_000.0) * self.cache_read_per_million;

        input_cost + output_cost + cache_write_cost + cache_read_cost
    }
}

pub fn get_model_pricing(model: &str, provider: &str) -> Option<ModelPricing> {
    let model_lower = model.to_lowercase();
    let provider_lower = provider.to_lowercase();

    match provider_lower.as_str() {
        "openai" | "copilot" => get_openai_pricing(&model_lower),
        "anthropic" => get_anthropic_pricing(&model_lower),
        "ollama" => Some(ModelPricing::default()), // Local Ollama is free
        "custom" => None,                          // Custom providers need user-configured pricing
        _ => None,
    }
}

fn get_openai_pricing(model: &str) -> Option<ModelPricing> {
    // Pricing as of 2024 (per 1M tokens)
    // https://openai.com/pricing

    if model.contains("gpt-4o-mini") {
        // GPT-4o mini: $0.15 input, $0.60 output
        Some(ModelPricing::new(0.15, 0.60))
    } else if model.contains("gpt-4o") {
        // GPT-4o: $2.50 input, $10.00 output
        Some(ModelPricing::with_cache(2.50, 10.00, 3.75, 1.25))
    } else if model.contains("gpt-4-turbo")
        || model.contains("gpt-4-1106")
        || model.contains("gpt-4-0125")
    {
        // GPT-4 Turbo: $10.00 input, $30.00 output
        Some(ModelPricing::new(10.00, 30.00))
    } else if model.contains("gpt-4-32k") {
        // GPT-4 32K: $60.00 input, $120.00 output
        Some(ModelPricing::new(60.00, 120.00))
    } else if model.contains("gpt-4") {
        // GPT-4 8K: $30.00 input, $60.00 output
        Some(ModelPricing::new(30.00, 60.00))
    } else if model.contains("gpt-3.5-turbo-instruct") {
        // GPT-3.5 Turbo Instruct: $1.50 input, $2.00 output
        Some(ModelPricing::new(1.50, 2.00))
    } else if model.contains("gpt-3.5-turbo") {
        // GPT-3.5 Turbo: $0.50 input, $1.50 output
        Some(ModelPricing::new(0.50, 1.50))
    } else if model.contains("o1-preview") {
        // o1-preview: $15.00 input, $60.00 output
        Some(ModelPricing::with_cache(15.00, 60.00, 18.75, 7.50))
    } else if model.contains("o1-mini") {
        // o1-mini: $3.00 input, $12.00 output
        Some(ModelPricing::with_cache(3.00, 12.00, 3.75, 1.50))
    } else if model.contains("o1") {
        // o1: $15.00 input, $60.00 output
        Some(ModelPricing::with_cache(15.00, 60.00, 18.75, 7.50))
    } else {
        // Default to GPT-4o pricing for unknown OpenAI models
        Some(ModelPricing::new(2.50, 10.00))
    }
}

fn get_anthropic_pricing(model: &str) -> Option<ModelPricing> {
    // Anthropic pricing (per 1M tokens)
    // https://www.anthropic.com/pricing
    // Cache: write is 25% more, read is 90% off

    if model.contains("claude-3-5-sonnet") || model.contains("claude-3.5-sonnet") {
        // Claude 3.5 Sonnet: $3.00 input, $15.00 output
        Some(ModelPricing::with_cache(3.00, 15.00, 3.75, 0.30))
    } else if model.contains("claude-3-5-haiku") || model.contains("claude-3.5-haiku") {
        // Claude 3.5 Haiku: $0.80 input, $4.00 output
        Some(ModelPricing::with_cache(0.80, 4.00, 1.00, 0.08))
    } else if model.contains("claude-3-opus") {
        // Claude 3 Opus: $15.00 input, $75.00 output
        Some(ModelPricing::with_cache(15.00, 75.00, 18.75, 1.50))
    } else if model.contains("claude-3-sonnet") {
        // Claude 3 Sonnet: $3.00 input, $15.00 output
        Some(ModelPricing::with_cache(3.00, 15.00, 3.75, 0.30))
    } else if model.contains("claude-3-haiku") {
        // Claude 3 Haiku: $0.25 input, $1.25 output
        Some(ModelPricing::with_cache(0.25, 1.25, 0.30, 0.03))
    } else if model.contains("claude-2") {
        // Claude 2.x: $8.00 input, $24.00 output
        Some(ModelPricing::new(8.00, 24.00))
    } else {
        // Default to Claude 3.5 Sonnet for unknown Anthropic models
        Some(ModelPricing::with_cache(3.00, 15.00, 3.75, 0.30))
    }
}

#[command]
pub fn get_pricing(model: String, provider: String) -> Option<ModelPricing> {
    get_model_pricing(&model, &provider)
}

#[command]
pub fn calculate_cost(
    model: String,
    provider: String,
    prompt_tokens: i64,
    completion_tokens: i64,
    cache_creation_tokens: Option<i64>,
    cache_read_tokens: Option<i64>,
    custom_input_rate: Option<f64>,
    custom_output_rate: Option<f64>,
) -> f64 {
    let cache_creation = cache_creation_tokens.unwrap_or(0);
    let cache_read = cache_read_tokens.unwrap_or(0);

    // Check for custom rates first (for Ollama Cloud, etc.)
    if let (Some(input_rate), Some(output_rate)) = (custom_input_rate, custom_output_rate) {
        let pricing = ModelPricing::new(input_rate, output_rate);
        return pricing.calculate_cost(
            prompt_tokens,
            completion_tokens,
            cache_creation,
            cache_read,
        );
    }

    // Use built-in pricing
    match get_model_pricing(&model, &provider) {
        Some(pricing) => {
            pricing.calculate_cost(prompt_tokens, completion_tokens, cache_creation, cache_read)
        }
        None => 0.0, // Unknown model, no cost
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gpt4o_pricing() {
        let pricing = get_model_pricing("gpt-4o", "openai").unwrap();
        assert_eq!(pricing.input_per_million, 2.50);
        assert_eq!(pricing.output_per_million, 10.00);
    }

    #[test]
    fn test_claude_pricing() {
        let pricing = get_model_pricing("claude-3-5-sonnet-20241022", "anthropic").unwrap();
        assert_eq!(pricing.input_per_million, 3.00);
        assert_eq!(pricing.output_per_million, 15.00);
    }

    #[test]
    fn test_cost_calculation() {
        let pricing = ModelPricing::new(3.00, 15.00);
        // 1000 input tokens + 500 output tokens
        let cost = pricing.calculate_cost(1000, 500, 0, 0);
        // (1000/1M * 3.0) + (500/1M * 15.0) = 0.003 + 0.0075 = 0.0105
        assert!((cost - 0.0105).abs() < 0.0001);
    }

    #[test]
    fn test_ollama_free() {
        let pricing = get_model_pricing("llama3", "ollama").unwrap();
        assert_eq!(pricing.input_per_million, 0.0);
        assert_eq!(pricing.output_per_million, 0.0);
    }
}
