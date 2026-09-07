import { z } from 'zod';
import surveyRaw from '../../../configs/playtest-survey.json';

const choiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const questionSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('stars'),
    prompt: z.string().min(1),
    scaleMinLabel: z.string().min(1),
    scaleMaxLabel: z.string().min(1),
    maxStars: z.number().int().min(3).max(7).optional(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('choice'),
    prompt: z.string().min(1),
    options: z.array(choiceOptionSchema).min(2).max(8),
  }),
]);

const surveyConfigSchema = z.object({
  questions: z.array(questionSchema).min(1).max(8),
});

export type PlaytestSurveyQuestion = z.infer<typeof questionSchema>;
export type PlaytestSurveyConfig = z.infer<typeof surveyConfigSchema>;
export type PlaytestSurveyAnswers = Record<string, number | string>;

const parsed = surveyConfigSchema.safeParse(surveyRaw);
if (!parsed.success) {
  throw new Error(`Invalid playtest-survey.json: ${parsed.error.message}`);
}

export const PLAYTEST_SURVEY_CONFIG: PlaytestSurveyConfig = parsed.data;

export function isSurveyComplete(
  config: PlaytestSurveyConfig,
  answers: PlaytestSurveyAnswers,
): boolean {
  for (const question of config.questions) {
    const value = answers[question.id];
    if (value === undefined) return false;
    if (question.type === 'stars') {
      const max = question.maxStars ?? 5;
      if (typeof value !== 'number' || value < 1 || value > max) return false;
      continue;
    }
    if (typeof value !== 'string') return false;
    if (!question.options.some((option) => option.id === value)) return false;
  }
  return true;
}
