/**
 * Typy pro nastavení AI asistenta (sdílené mezi klientem a serverem).
 */

export const AI_SETTINGS_DOC_ID = "config";
export const AI_INQUIRY_TYPE_RULES_COLLECTION = "ai_inquiry_type_rules";

export type AiKnowledgeSourceSettings = {
  useHistoricalQuotes: boolean;
  historicalQuotesLimit: number;
  preferSentQuotes: boolean;
  preferApprovedAiGenerations: boolean;
  preferWonJobs: boolean;
};

export type AiInstructionCategories = {
  quotes: string;
  documents: string;
  communication: string;
};

export type AiAssistantSettingsDoc = {
  companyId: string;
  enabled: boolean;
  baseInstructions: string;
  /** Kategorizované instrukce pro AI (spravuje admin v AI centru). */
  instructionCategories?: AiInstructionCategories;
  knowledge: AiKnowledgeSourceSettings;
  updatedAt?: unknown;
  updatedByUid?: string | null;
};

export type AiInquiryTypeRuleDoc = {
  id?: string;
  companyId: string;
  name: string;
  /** Podřetězce pro párování s volným textem typu poptávky (case-insensitive). */
  matchPatterns: string[];
  systemInstructions: string;
  requiredInformation: string[];
  optionalInformation: string[];
  ignoredInformation: string[];
  /** Nápovědy pro filtrování katalogu (kategorie / název katalogu / produktu). */
  productCategoryHints: string[];
  /** Strukturované klíče polí (mají prioritu před textovými seznamy). */
  requiredFields?: string[];
  optionalFields?: string[];
  ignoredFields?: string[];
  /** Výchozí množství, pokud zákazník neuvede počet kusů (typicky 1). */
  defaultQuantity?: number;
  quoteRules: string;
  active: boolean;
  sortOrder: number;
  updatedAt?: unknown;
};

export function defaultAiAssistantSettings(companyId: string): AiAssistantSettingsDoc {
  return {
    companyId,
    enabled: true,
    baseInstructions: "",
    knowledge: {
      useHistoricalQuotes: true,
      historicalQuotesLimit: 8,
      preferSentQuotes: true,
      preferApprovedAiGenerations: true,
      preferWonJobs: true,
    },
  };
}

export function defaultBuiltInInquiryTypeRules(companyId: string): AiInquiryTypeRuleDoc[] {
  return [
    {
      companyId,
      name: "Pergoly svépomocí",
      matchPatterns: ["pergol", "svépomoc", "svepomoc"],
      systemInstructions:
        "Jde o pergolu pro montáž svépomocí. Povinné jsou pouze rozměry (šířka × hloubka) a typ střechy/zastřešení. Barva, konstrukční varianta a počet kusů jsou volitelné — neblokují návrh nabídky. Boční zasklení není součástí tohoto typu nabídky.",
      requiredInformation: [
        "rozměry pergoly (šířka × délka nebo rozměry v mm)",
        "typ zastřešení / střechy",
      ],
      optionalInformation: [
        "barva nebo konstrukční varianta",
        "počet kusů / množství",
        "orientační cena z CRM",
      ],
      ignoredInformation: [
        "boční zasklení",
        "čelní zasklení",
        "typ skla",
        "počet otvorů pro zasklení",
        "dveře do zimní zahrady",
      ],
      requiredFields: ["width", "depth", "roofType"],
      optionalFields: ["color", "constructionVariant", "quantity"],
      ignoredFields: ["sideGlazing", "winterGardenDoors", "slidingGlass"],
      defaultQuantity: 1,
      productCategoryHints: ["pergol", "zastřešení", "střecha", "polykarbonát"],
      quoteRules:
        "Nenavrhuj boční zasklení. Položky vycházej z katalogu pergol / zastřešení. Cenu určí CRM z ceníku.",
      active: true,
      sortOrder: 10,
    },
    {
      companyId,
      name: "Zimní zahrada",
      matchPatterns: ["zimní zahrada", "zimni zahrada", "zasklení", "zaskleni"],
      systemInstructions:
        "Jde o zimní zahradu nebo zasklenou stavbu. Zohledni rozměry, střechu, boční a čelní zasklení, typ skla, otvory a dveře.",
      requiredInformation: [
        "rozměry",
        "typ střechy / zastřešení",
        "boční nebo čelní zasklení (pokud je v poptávce zmíněno)",
      ],
      optionalInformation: [
        "typ skla",
        "počet otvorů",
        "dveře",
        "barva konstrukce",
      ],
      ignoredInformation: [],
      productCategoryHints: ["zimní", "zasklení", "sklo", "hliník"],
      quoteRules:
        "Struktura nabídky může obsahovat konstrukci, zasklení a doplňky podle katalogu. Cenu určí CRM.",
      active: true,
      sortOrder: 20,
    },
    {
      companyId,
      name: "Obecná poptávka",
      matchPatterns: ["*"],
      systemInstructions:
        "Typ poptávky není jednoznačně klasifikován. Buď konzervativní — vyžaduj jen informace nezbytné pro nabídku z katalogu.",
      requiredInformation: [],
      optionalInformation: ["rozměry", "množství", "specifikace z textu poptávky"],
      ignoredInformation: [],
      productCategoryHints: [],
      quoteRules: "Nepředpokládej specializované prvky bez opory v textu poptávky nebo katalogu.",
      active: true,
      sortOrder: 999,
    },
  ];
}
