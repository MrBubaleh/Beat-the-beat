import type { PlaytestSurveyAnswers, PlaytestSurveyConfig } from '@core/playtest/surveyConfig';
import { PlaytestSurveyForm } from './PlaytestSurveyForm';
import type { RunResults } from './HUD';

export interface EndRunPanelOptions {
  kind: 'death' | 'song_end';
  survey: PlaytestSurveyConfig;
  results?: RunResults;
  onSubmit: (answers: PlaytestSurveyAnswers) => void;
  onDismiss?: () => void;
  onRestart?: () => void;
  onChooseTrack?: () => void;
}

export class EndRunPanel {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly surveyHost: HTMLDivElement;
  private readonly runActions: HTMLDivElement;
  private readonly submitBtn: HTMLButtonElement;
  private surveyForm: PlaytestSurveyForm | null = null;
  private pendingSubmit: ((answers: PlaytestSurveyAnswers) => void) | null = null;
  private pendingDismiss: (() => void) | null = null;
  private readonly boundEscape: (event: KeyboardEvent) => void;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'end-run-root';
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,8,18,.88);pointer-events:auto;z-index:30;';
    container.appendChild(this.root);

    const panel = document.createElement('div');
    panel.className = 'end-run-panel';
    this.root.appendChild(panel);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.textContent = '×';
    closeBtn.className = 'end-run-close';
    closeBtn.style.cssText =
      'position:absolute;top:10px;right:12px;padding:0;' +
      'border:1px solid rgba(120,210,240,.45);border-radius:8px;background:rgba(8,28,42,.9);' +
      'color:#9ed8ea;font:24px/1 var(--font-ui, sans-serif);cursor:pointer;';
    closeBtn.addEventListener('click', () => this.dismiss());
    panel.appendChild(closeBtn);

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'end-run-title';
    panel.appendChild(this.titleEl);

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.style.cssText =
      'font-size:clamp(13px,3.6vw,14px);color:#9ec7d8;margin-bottom:18px;line-height:1.4;';
    panel.appendChild(this.subtitleEl);

    this.statsEl = document.createElement('div');
    this.statsEl.className = 'end-run-stats';
    panel.appendChild(this.statsEl);

    this.runActions = document.createElement('div');
    this.runActions.className = 'hud-run-actions end-run-actions';
    panel.appendChild(this.runActions);

    this.surveyHost = document.createElement('div');
    panel.appendChild(this.surveyHost);

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.textContent = 'Отправить отзыв';
    this.submitBtn.disabled = true;
    this.submitBtn.className = 'end-run-submit';
    this.submitBtn.style.cssText = 'margin-top:18px;';
    this.submitBtn.addEventListener('click', () => {
      if (!this.pendingSubmit || !this.surveyForm?.isComplete()) return;
      this.pendingSubmit(this.surveyForm.getAnswers());
    });
    panel.appendChild(this.submitBtn);

    this.boundEscape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !this.isBlocking) return;
      event.preventDefault();
      event.stopPropagation();
      this.dismiss();
    };
    document.addEventListener('keydown', this.boundEscape, true);
  }

  get isBlocking(): boolean {
    return this.root.style.display !== 'none';
  }

  dismiss(): void {
    const onDismiss = this.pendingDismiss;
    this.hide();
    onDismiss?.();
  }

  show(options: EndRunPanelOptions): void {
    this.pendingSubmit = options.onSubmit;
    this.pendingDismiss = options.onDismiss ?? null;
    this.titleEl.textContent =
      options.kind === 'death' ? 'GAME OVER' : 'ТРЕК ЗАВЕРШЁН';
    this.subtitleEl.textContent =
      'Ответьте на несколько вопросов — так мы сохраним playtest-лог для анализа.';
    if (options.results) {
      this.statsEl.style.display = 'block';
      this.statsEl.innerHTML = formatResults(options.results);
    } else {
      this.statsEl.style.display = 'none';
      this.statsEl.innerHTML = '';
    }

    this.runActions.replaceChildren();
    if (options.onRestart) {
      this.runActions.appendChild(makeActionButton('Заново', options.onRestart));
    }
    if (options.onChooseTrack) {
      this.runActions.appendChild(makeActionButton('Другой трек', options.onChooseTrack));
    }

    this.surveyHost.replaceChildren();
    this.surveyForm = new PlaytestSurveyForm({
      config: options.survey,
      onChange: (_answers, complete) => {
        this.submitBtn.disabled = !complete;
        this.submitBtn.style.opacity = complete ? '1' : '0.45';
        this.submitBtn.style.cursor = complete ? 'pointer' : 'not-allowed';
      },
    });
    this.surveyHost.appendChild(this.surveyForm.root);

    this.submitBtn.disabled = true;
    this.submitBtn.style.opacity = '0.45';
    this.root.style.display = 'flex';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.pendingSubmit = null;
    this.pendingDismiss = null;
    this.surveyForm = null;
    this.surveyHost.replaceChildren();
  }
}

function makeActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-action';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function formatResults(results: RunResults): string {
  return (
    `Очки: <b>${results.score}</b> · дистанция <b>${Math.floor(results.distance)} м</b> · ` +
    `монеты <b>${results.coins}</b><br>` +
    `Комбо <b>${results.maxCombo}</b> · удары <b>${results.hits}</b> · ` +
    `машина/конь <b>${results.carSeconds.toFixed(1)} / ${results.horseSeconds.toFixed(1)} с</b>`
  );
}
