export interface VolumeSliderOptions {
  value: number;
  onChange: (value: number) => void;
  label?: string;
}

export class VolumeSlider {
  readonly root: HTMLLabelElement;
  private readonly input: HTMLInputElement;
  private readonly onChange: (value: number) => void;

  constructor(opts: VolumeSliderOptions) {
    this.onChange = opts.onChange;
    this.root = document.createElement('label');
    this.root.className = 'volume-slider';
    const caption = document.createElement('span');
    caption.textContent = opts.label ?? 'громкость';
    this.input = document.createElement('input');
    this.input.type = 'range';
    this.input.min = '0';
    this.input.max = '1';
    this.input.step = '0.01';
    this.input.value = String(opts.value);
    this.input.addEventListener('input', () => {
      this.onChange(Number(this.input.value));
    });
    this.root.append(caption, this.input);
  }

  setValue(value: number): void {
    this.input.value = String(value);
  }
}
