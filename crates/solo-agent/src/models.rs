//! AI Model definitions and registry

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::provider::ProviderType;

/// Model capabilities
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct ModelCapabilities {
    /// Maximum context window (input tokens)
    pub context_window: u32,
    /// Maximum output tokens
    pub max_output_tokens: u32,
    /// Supports vision/images
    pub supports_vision: bool,
    /// Supports tool use
    pub supports_tools: bool,
    /// Supports streaming
    pub supports_streaming: bool,
    /// Has extended thinking capability
    pub supports_thinking: bool,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            context_window: 128_000,
            max_output_tokens: 8192,
            supports_vision: false,
            supports_tools: true,
            supports_streaming: true,
            supports_thinking: false,
        }
    }
}

/// AI Model definition
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
pub struct AIModel {
    /// Model ID (e.g., "claude-sonnet-4-20250514")
    pub id: String,
    /// Display name (e.g., "Claude Sonnet 4")
    pub display_name: String,
    /// Short alias (e.g., "sonnet")
    pub alias: String,
    /// Provider type
    pub provider: ProviderType,
    /// Model capabilities
    pub capabilities: ModelCapabilities,
    /// Whether this is the default model for the provider
    pub is_default: bool,
    /// Description
    pub description: String,
}

/// Static model registry
pub static MODEL_REGISTRY: &[AIModel] = &[
    // Anthropic Models
    AIModel {
        id: String::new(), // Will be set at runtime
        display_name: String::new(),
        alias: String::new(),
        provider: ProviderType::Anthropic,
        capabilities: ModelCapabilities {
            context_window: 200_000,
            max_output_tokens: 8192,
            supports_vision: true,
            supports_tools: true,
            supports_streaming: true,
            supports_thinking: false,
        },
        is_default: true,
        description: String::new(),
    },
];

// Since we can't use String in const, we use a function to get models
lazy_static::lazy_static! {
    pub static ref ANTHROPIC_MODELS: Vec<AIModel> = vec![
        AIModel {
            id: "claude-sonnet-4-20250514".to_string(),
            display_name: "Claude Sonnet 4".to_string(),
            alias: "sonnet".to_string(),
            provider: ProviderType::Anthropic,
            capabilities: ModelCapabilities {
                context_window: 200_000,
                max_output_tokens: 8192,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: true,
            description: "Best balance of intelligence and speed".to_string(),
        },
        AIModel {
            id: "claude-opus-4-20250514".to_string(),
            display_name: "Claude Opus 4".to_string(),
            alias: "opus".to_string(),
            provider: ProviderType::Anthropic,
            capabilities: ModelCapabilities {
                context_window: 200_000,
                max_output_tokens: 8192,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: true,
            },
            is_default: false,
            description: "Most capable model for complex tasks".to_string(),
        },
        AIModel {
            id: "claude-3-5-haiku-latest".to_string(),
            display_name: "Claude 3.5 Haiku".to_string(),
            alias: "haiku".to_string(),
            provider: ProviderType::Anthropic,
            capabilities: ModelCapabilities {
                context_window: 200_000,
                max_output_tokens: 8192,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: false,
            description: "Fast and efficient for simple tasks".to_string(),
        },
    ];

    pub static ref GEMINI_MODELS: Vec<AIModel> = vec![
        AIModel {
            id: "gemini-2.0-flash".to_string(),
            display_name: "Gemini 2.0 Flash".to_string(),
            alias: "flash".to_string(),
            provider: ProviderType::Gemini,
            capabilities: ModelCapabilities {
                context_window: 1_000_000,
                max_output_tokens: 8192,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: true,
            description: "Fast and versatile model".to_string(),
        },
        AIModel {
            id: "gemini-2.5-pro-preview-06-05".to_string(),
            display_name: "Gemini 2.5 Pro".to_string(),
            alias: "gemini-pro".to_string(),
            provider: ProviderType::Gemini,
            capabilities: ModelCapabilities {
                context_window: 1_000_000,
                max_output_tokens: 65536,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: true,
            },
            is_default: false,
            description: "Most capable Gemini model with thinking".to_string(),
        },
        AIModel {
            id: "gemini-2.0-flash-lite".to_string(),
            display_name: "Gemini 2.0 Flash Lite".to_string(),
            alias: "flash-lite".to_string(),
            provider: ProviderType::Gemini,
            capabilities: ModelCapabilities {
                context_window: 1_000_000,
                max_output_tokens: 8192,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: false,
            description: "Lightweight and efficient".to_string(),
        },
    ];

    pub static ref OPENAI_MODELS: Vec<AIModel> = vec![
        AIModel {
            id: "gpt-4.1".to_string(),
            display_name: "GPT-4.1".to_string(),
            alias: "gpt4".to_string(),
            provider: ProviderType::OpenAI,
            capabilities: ModelCapabilities {
                context_window: 1_000_000,
                max_output_tokens: 32768,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: true,
            description: "Flagship model with 1M context".to_string(),
        },
        AIModel {
            id: "gpt-4.1-mini".to_string(),
            display_name: "GPT-4.1 Mini".to_string(),
            alias: "gpt4-mini".to_string(),
            provider: ProviderType::OpenAI,
            capabilities: ModelCapabilities {
                context_window: 1_000_000,
                max_output_tokens: 32768,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: false,
            description: "Smaller, faster GPT-4.1 variant".to_string(),
        },
        AIModel {
            id: "o3".to_string(),
            display_name: "o3".to_string(),
            alias: "o3".to_string(),
            provider: ProviderType::OpenAI,
            capabilities: ModelCapabilities {
                context_window: 200_000,
                max_output_tokens: 100_000,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: true,
            },
            is_default: false,
            description: "Advanced reasoning model".to_string(),
        },
        AIModel {
            id: "o4-mini".to_string(),
            display_name: "o4 Mini".to_string(),
            alias: "o4-mini".to_string(),
            provider: ProviderType::OpenAI,
            capabilities: ModelCapabilities {
                context_window: 200_000,
                max_output_tokens: 65536,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: true,
            },
            is_default: false,
            description: "Fast reasoning model".to_string(),
        },
        AIModel {
            id: "gpt-4o".to_string(),
            display_name: "GPT-4o".to_string(),
            alias: "4o".to_string(),
            provider: ProviderType::OpenAI,
            capabilities: ModelCapabilities {
                context_window: 128_000,
                max_output_tokens: 16384,
                supports_vision: true,
                supports_tools: true,
                supports_streaming: true,
                supports_thinking: false,
            },
            is_default: false,
            description: "Multimodal model with audio support".to_string(),
        },
    ];
}

/// Get all models for a provider
pub fn get_models_for_provider(provider: ProviderType) -> &'static [AIModel] {
    match provider {
        ProviderType::Anthropic => &ANTHROPIC_MODELS,
        ProviderType::OpenAI => &OPENAI_MODELS,
        ProviderType::Gemini => &GEMINI_MODELS,
    }
}

/// Get default model for a provider
pub fn get_default_model(provider: ProviderType) -> &'static AIModel {
    let models = get_models_for_provider(provider);
    models
        .iter()
        .find(|m| m.is_default)
        .unwrap_or(&models[0])
}

/// Find a model by ID or alias
pub fn find_model(identifier: &str) -> Option<&'static AIModel> {
    let identifier_lower = identifier.to_lowercase();

    // Search Anthropic models
    if let Some(model) = ANTHROPIC_MODELS.iter().find(|m| {
        m.id.to_lowercase() == identifier_lower || m.alias.to_lowercase() == identifier_lower
    }) {
        return Some(model);
    }

    // Search OpenAI models
    if let Some(model) = OPENAI_MODELS.iter().find(|m| {
        m.id.to_lowercase() == identifier_lower || m.alias.to_lowercase() == identifier_lower
    }) {
        return Some(model);
    }

    // Search Gemini models
    if let Some(model) = GEMINI_MODELS.iter().find(|m| {
        m.id.to_lowercase() == identifier_lower || m.alias.to_lowercase() == identifier_lower
    }) {
        return Some(model);
    }

    None
}

/// Get all available models
pub fn get_all_models() -> Vec<&'static AIModel> {
    let mut models: Vec<&'static AIModel> = Vec::new();
    models.extend(ANTHROPIC_MODELS.iter());
    models.extend(OPENAI_MODELS.iter());
    models.extend(GEMINI_MODELS.iter());
    models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_model() {
        let anthropic_default = get_default_model(ProviderType::Anthropic);
        assert_eq!(anthropic_default.alias, "sonnet");

        let openai_default = get_default_model(ProviderType::OpenAI);
        assert_eq!(openai_default.id, "gpt-4.1");
    }

    #[test]
    fn test_find_model() {
        assert!(find_model("sonnet").is_some());
        assert!(find_model("claude-sonnet-4-20250514").is_some());
        assert!(find_model("gpt-4.1").is_some());
        assert!(find_model("nonexistent").is_none());
    }
}
