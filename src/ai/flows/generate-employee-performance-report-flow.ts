'use server';
/**
 * @fileOverview A Genkit flow for generating employee performance reports.
 *
 * - generateEmployeePerformanceReport - A function that handles the employee performance report generation process.
 * - EmployeePerformanceReportInput - The input type for the generateEmployeePerformanceReport function.
 * - EmployeePerformanceReportOutput - The return type for the generateEmployeePerformanceReport function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EmployeePerformanceReportInputSchema = z.object({
  employeeNames: z
    .array(z.string())
    .describe('Names of the employees for whom the report is generated.'),
  reportContext: z
    .string()
    .describe(
      'A comprehensive string containing all relevant raw data for attendance, job completion, and productivity metrics for the specified employees. This should be a pre-formatted summary or detailed log that the AI can analyze.'
    ),
  reportPurpose: z
    .string()
    .optional()
    .describe(
      'Optional: The specific purpose or focus for generating this report (e.g., "identify top performers", "assess areas for training").'
    ),
  reportType: z
    .enum(['individual', 'team'])
    .default('individual')
    .describe('Whether the report is for an individual employee or a team.')
});
export type EmployeePerformanceReportInput = z.infer<
  typeof EmployeePerformanceReportInputSchema
>;

const EmployeePerformanceReportOutputSchema = z.object({
  summary: z
    .string()
    .describe('A general overview summary of the employee(s) performance.'),
  strengths: z
    .array(z.string())
    .describe('A list of identified strengths based on the provided data.'),
  areasForDevelopment: z
    .array(z.string())
    .describe('A list of identified areas where the employee(s) can improve.'),
  recommendations: z
    .array(z.string())
    .optional()
    .describe('Optional: Specific recommendations for growth or action items.')
});
export type EmployeePerformanceReportOutput = z.infer<
  typeof EmployeePerformanceReportOutputSchema
>;

const employeePerformancePrompt = ai.definePrompt({
  name: 'employeePerformanceReportPrompt',
  input: {schema: EmployeePerformanceReportInputSchema},
  output: {schema: EmployeePerformanceReportOutputSchema},
  prompt: `You are an expert HR analyst specializing in employee performance evaluation.\nYour task is to generate a detailed performance report based on the provided data.\n\nReport Type: {{{reportType}}}\nEmployees to evaluate: {{{employeeNames}}}\n{{#if reportPurpose}}\nPurpose of this report: {{{reportPurpose}}}\n{{/if}}\n\nRaw Performance Data:\n{{{reportContext}}}\n\nAnalyze the provided "Raw Performance Data" carefully, focusing on attendance, job completion, and productivity metrics.\nIdentify key strengths, areas for development, and provide actionable recommendations.\n\nGenerate the report in a structured JSON format according to the output schema.`
});

const generateEmployeePerformanceReportFlow = ai.defineFlow(
  {
    name: 'generateEmployeePerformanceReportFlow',
    inputSchema: EmployeePerformanceReportInputSchema,
    outputSchema: EmployeePerformanceReportOutputSchema
  },
  async input => {
    const {output} = await employeePerformancePrompt(input);
    if (!output) {
      throw new Error('Failed to generate employee performance report.');
    }
    return output;
  }
);

export async function generateEmployeePerformanceReport(
  input: EmployeePerformanceReportInput
): Promise<EmployeePerformanceReportOutput> {
  return generateEmployeePerformanceReportFlow(input);
}
