import type {
  PlaytestSurveyAnswers,
  PlaytestSurveyConfig,
  PlaytestSurveyQuestion,
} from '@core/playtest/surveyConfig';

export interface PlaytestSurveyFormOptions {
  config: PlaytestSurveyConfig;
  onChange?: (answers: PlaytestSurveyAnswers, complete: boolean) => void;
}

export class PlaytestSurveyForm {
  readonly root: HTMLDivElement;
  private readonly answers: PlaytestSurveyAnswers = {};

  constructor(private readonly opts: PlaytestSurveyFormOptions) {
    this.root = document.createElement('div');
    this.root.style.cssText = 'display:flex;flex-direction:column;gap:18px;text-align:left;';
    for (const question of opts.config.questions) {
      this.root.appendChild(this.renderQuestion(question));
    }
    this.emitChange();
  }

  getAnswers(): PlaytestSurveyAnswers {
    return { ...this.answers };
  }

  isComplete(): boolean {
    for (const question of this.opts.config.questions) {
      const value = this.answers[question.id];
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

  private renderQuestion(question: PlaytestSurveyQuestion): HTMLDivElement {
    const block = document.createElement('div');
    block.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    const prompt = document.createElement('div');
    prompt.className = 'survey-prompt';
    prompt.textContent = question.prompt;
    block.appendChild(prompt);

    if (question.type === 'stars') {
      block.appendChild(this.renderStars(question));
      return block;
    }

    const choices = document.createElement('div');
    choices.className = 'survey-choices';
    for (const option of question.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.dataset.optionId = option.id;
      button.className = 'survey-choice';
      button.style.cssText =
        'border:1px solid rgba(120,220,255,.45);border-radius:6px;' +
        'background:rgba(8,30,44,.9);color:#dff;cursor:pointer;';
      button.addEventListener('click', () => {
        this.answers[question.id] = option.id;
        for (const sibling of choices.querySelectorAll('button')) {
          const active = sibling.dataset.optionId === option.id;
          sibling.style.borderColor = active ? 'rgba(120,255,200,.95)' : 'rgba(120,220,255,.45)';
          sibling.style.background = active ? 'rgba(20,70,90,.95)' : 'rgba(8,30,44,.9)';
        }
        this.emitChange();
      });
      choices.appendChild(button);
    }
    block.appendChild(choices);
    return block;
  }

  private renderStars(
    question: Extract<PlaytestSurveyQuestion, { type: 'stars' }>,
  ): HTMLDivElement {
    const max = question.maxStars ?? 5;
    const row = document.createElement('div');
    row.className = 'survey-stars';

    const minLabel = document.createElement('div');
    minLabel.className = 'survey-scale-min';
    minLabel.textContent = question.scaleMinLabel;

    const stars = document.createElement('div');
    stars.className = 'survey-star-row';
    const buttons: HTMLButtonElement[] = [];
    for (let value = 1; value <= max; value++) {
      const star = document.createElement('button');
      star.type = 'button';
      star.textContent = '★';
      star.title = String(value);
      star.className = 'survey-star';
      star.style.cssText =
        'border:1px solid rgba(120,220,255,.35);border-radius:6px;' +
        'background:rgba(8,30,44,.9);color:#5f7f92;cursor:pointer;';
      star.addEventListener('click', () => {
        this.answers[question.id] = value;
        for (let index = 0; index < buttons.length; index++) {
          const active = index < value;
          buttons[index].style.color = active ? '#ffd86a' : '#5f7f92';
          buttons[index].style.borderColor = active
            ? 'rgba(255,220,120,.9)'
            : 'rgba(120,220,255,.35)';
          buttons[index].style.boxShadow = active
            ? '0 0 10px rgba(255,210,90,.45)'
            : 'none';
        }
        this.emitChange();
      });
      buttons.push(star);
      stars.appendChild(star);
    }

    const maxLabel = document.createElement('div');
    maxLabel.className = 'survey-scale-max';
    maxLabel.textContent = question.scaleMaxLabel;

    row.append(minLabel, stars, maxLabel);
    return row;
  }

  private emitChange(): void {
    this.opts.onChange?.(this.getAnswers(), this.isComplete());
  }
}
