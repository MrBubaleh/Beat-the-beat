export class Score {
  private _meters = 0;
  private _coins = 0;
  private _bonus = 0;
  private _total = 0;

  get meters(): number {
    return this._meters;
  }

  get coins(): number {
    return this._coins;
  }

  get total(): number {
    return this._total;
  }

  addBonus(amount: number): void {
    this._bonus += amount;
  }

  update(distance: number, coins: number, coinValue: number, comboMultiplier = 1): void {
    this._meters = Math.floor(distance);
    this._coins = coins;
    this._total = this._coins * coinValue * comboMultiplier + this._bonus;
  }

  reset(): void {
    this._meters = 0;
    this._coins = 0;
    this._bonus = 0;
    this._total = 0;
  }
}
