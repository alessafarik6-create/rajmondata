'use server';
/**
 * @fileOverview A financial summary AI agent.
 *
 * - generateFinancialSummary - A function that generates a financial summary for a company.
 * - GenerateFinancialSummaryInput - The input type for the generateFinancialSummary function.
 * - GenerateFinancialSummaryOutput - The return type for the generateFinancialSummary function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateFinancialSummaryInputSchema = z.object({
  companyName: z.string().describe('The name of the company.'),
  financialData: z
    .string()
    .describe(
      'JSON string containing key financial metrics (e.g., revenue, expenses, profit, cash flow) for the given period. Example: { "revenue": 100000, "expenses": 75000, "profit": 25000, "cashFlow": 15000 }'
    ),
  period: z.string().describe("The financial reporting period (e.g., 'Q1 2024', 'Fiscal Year 2023')."),
  previousPeriodData: z
    .string()
    .optional()
    .describe(
      'Optional JSON string containing key financial metrics for the previous period for comparison (e.g., { "revenue": 90000, "expenses": 70000, "profit": 20000, "cashFlow": 10000 }).'
    ),
});
export type GenerateFinancialSummaryInput = z.infer<typeof GenerateFinancialSummaryInputSchema>;

const GenerateFinancialSummaryOutputSchema = z.object({
  summary: z.string().describe("A concise summary of the company's financial performance for the period."),
  keyTrends: z.array(z.string()).describe("An array of key financial trends identified."),
  insights: z.array(z.string()).describe("An array of actionable insights derived from the financial data."),
  overallSentiment: z.enum(['Positive', 'Neutral', 'Negative', 'Mixed']).describe("The overall sentiment regarding the company's financial health."),
  recommendations: z.array(z.string()).describe("An array of recommendations for improving financial performance or leveraging strengths."),
});
export type GenerateFinancialSummaryOutput = z.infer<typeof GenerateFinancialSummaryOutputSchema>;

export async function generateFinancialSummary(
  input: GenerateFinancialSummaryInput
): Promise<GenerateFinancialSummaryOutput> {
  return generateFinancialSummaryFlow(input);
}

const financialSummaryPrompt = ai.definePrompt({
  name: 'financialSummaryPrompt',
  input: { schema: GenerateFinancialSummaryInputSchema },
  output: { schema: GenerateFinancialSummaryOutputSchema },
  prompt: `You are an expert financial analyst. Your task is to analyze the provided financial data for "{{companyName}}" for the "{{period}}" and generate a comprehensive summary, including key trends, actionable insights, overall sentiment, and recommendations.\n\nFinancial Data for "{{period}}":\n{{{financialData}}}\n\n{{#if previousPeriodData}}\nPrevious Period Financial Data (for comparison):\n{{{previousPeriodData}}}\n{{/if}}\n\nBased on this data:\n1. Provide a concise overall summary of the company's financial performance.\n2. Identify and list key financial trends (e.g., revenue growth, expense reduction, margin changes).\n3. Offer actionable insights that a company owner or accountant can use to understand the implications of these trends.\n4. Determine the overall sentiment of the company's financial health (Positive, Neutral, Negative, or Mixed).\n5. Suggest practical recommendations for improving financial performance or leveraging identified strengths.\n\nEnsure your output strictly adheres to the JSON schema provided in your instructions for structured parsing.`,
});

const generateFinancialSummaryFlow = ai.defineFlow(
  {
    name: 'generateFinancialSummaryFlow',
    inputSchema: GenerateFinancialSummaryInputSchema,
    outputSchema: GenerateFinancialSummaryOutputSchema,
  },
  async (input) => {
    const { output } = await financialSummaryPrompt(input);
    if (!output) {
      throw new Error('Failed to generate financial summary.');
    }
    return output;
  }
);
