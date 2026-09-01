/**
 * Registr nástrojů pro budoucí AI function calling (zatím neaktivní).
 */

export type AiToolDefinition = {
  name: string;
  description: string;
  /** Zda smí nástroj měnit data nebo odesílat zákazníkovi. */
  mutatesCrm: boolean;
  sendsToCustomer: boolean;
  enabled: boolean;
};

/** Pouze read-only / draft nástroje budou v první fázi povoleny. */
export const AI_TOOL_REGISTRY: AiToolDefinition[] = [
  {
    name: "get_customer",
    description: "Načte zákazníka podle ID.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "get_inquiry",
    description: "Načte poptávku podle leadKey.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "search_products",
    description: "Vyhledá produkty v katalozích.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "get_product",
    description: "Načte produkt podle catalog_id a product_id.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "get_customer_history",
    description: "Historie zakázek a aktivit zákazníka.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "get_price",
    description: "Autoritativní cena produktu z CRM.",
    mutatesCrm: false,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "create_quote_draft",
    description: "Vytvoří koncept nabídky (bez odeslání).",
    mutatesCrm: true,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "add_internal_note",
    description: "Přidá interní poznámku k poptávce.",
    mutatesCrm: true,
    sendsToCustomer: false,
    enabled: false,
  },
  {
    name: "send_customer_message",
    description: "Odeslání zprávy zákazníkovi — zakázáno v MVP.",
    mutatesCrm: true,
    sendsToCustomer: true,
    enabled: false,
  },
  {
    name: "send_quote",
    description: "Odeslání nabídky zákazníkovi — zakázáno v MVP.",
    mutatesCrm: true,
    sendsToCustomer: true,
    enabled: false,
  },
];

export function listEnabledAiTools(): AiToolDefinition[] {
  return AI_TOOL_REGISTRY.filter((t) => t.enabled);
}
