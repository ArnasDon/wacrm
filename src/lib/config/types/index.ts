/**
 * ============================================================
 * Relaxio AI CRM
 * Configuration Engine Types
 * ============================================================
 */

export type AIProviderName =
  | "openai"
  | "gemini"
  | "claude"
  | "deepseek"
  | "grok";

export interface AIProvider {
  id: string;
  name: AIProviderName;
  displayName: string;
  enabled: boolean;
  priority: number;
  model: string;
  apiKeyConfigured: boolean;
  fallbackProvider?: AIProviderName;
}

export interface IntentDefinition {
  id: string;
  name: string;
  description?: string;

  keywords: string[];

  priority: number;

  provider: AIProviderName;

  automationId?: string;

  promptId?: string;

  enabled: boolean;
}

export interface PromptDefinition {
  id: string;

  name: string;

  systemPrompt: string;

  temperature: number;

  maxTokens: number;

  enabled: boolean;
}

export interface KnowledgeArticle {

  id: string;

  category: string;

  title: string;

  content: string;

  enabled: boolean;

}

export interface BusinessSetting {

  spaName: string;

  timezone: string;

  currency: string;

  language: string;

}

export interface ServiceDefinition {

  id: string;

  name: string;

  duration: number;

  enabled: boolean;

}

export interface PricingDefinition {

  serviceId: string;

  price: number;

  currency: string;

}