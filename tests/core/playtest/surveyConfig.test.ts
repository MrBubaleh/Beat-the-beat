import { describe, expect, it } from 'vitest';
import {
  isSurveyComplete,
  PLAYTEST_SURVEY_CONFIG,
} from '@core/playtest/surveyConfig';

describe('playtest survey config', () => {
  it('loads a valid survey with star labels', () => {
    expect(PLAYTEST_SURVEY_CONFIG.questions.length).toBeGreaterThanOrEqual(2);
    const stars = PLAYTEST_SURVEY_CONFIG.questions.filter((q) => q.type === 'stars');
    expect(stars.length).toBeGreaterThan(0);
    for (const question of stars) {
      if (question.type !== 'stars') continue;
      expect(question.scaleMinLabel.length).toBeGreaterThan(0);
      expect(question.scaleMaxLabel.length).toBeGreaterThan(0);
    }
  });

  it('requires every configured question before completion', () => {
    const partial: Record<string, number | string> = {
      overall: 4,
      difficulty: 3,
    };
    expect(isSurveyComplete(PLAYTEST_SURVEY_CONFIG, partial)).toBe(false);
    const complete = {
      overall: 4,
      difficulty: 3,
      favoriteMode: 'horse',
      fairness: 5,
    };
    expect(isSurveyComplete(PLAYTEST_SURVEY_CONFIG, complete)).toBe(true);
  });
});
