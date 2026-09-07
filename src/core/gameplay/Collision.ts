import type { GameConfig } from '@core/config/schemas';
import type {
  BonusEntity,
  BonusKind,
  CoinEntity,
  ObstacleEntity,
  RampEntity,
  TrainEntity,
} from '@core/levelgen/types';
import type { PlayerState } from '@core/state/PlayerState';
import { obstacleFootprint, obstacleZIntersectsPlayer } from './obstacleFootprint';

const HORSE_OVERHEAD_ARCH_HEIGHT_MUL = 1.25;
const HORSE_OVERHEAD_CLEARANCE_MUL = 1.3;

export interface CollisionResult {
  hit: boolean;
  hitObstacleId: number | null;
  coinCollected: boolean;
  coinsCollected: number;
  collectedAirborneCoins: number;
  collectedCoinGroupIds: number[];
  collectedCoinSparks: { x: number; y: number; z: number }[];
  bonusCollected: BonusKind | null;
  rampHit: RampEntity | null;
  destroyedCoinIds: number[];
  microBreakIds: number[];
}

export class CollisionSystem {
  private readonly laneWidth: number;

  constructor(private readonly cfg: GameConfig) {
    this.laneWidth = Math.abs(cfg.lane.positions[1] - cfg.lane.positions[0]);
  }

  update(
    player: PlayerState,
    obstacles: ObstacleEntity[],
    coins: CoinEntity[],
    bonuses: BonusEntity[],
    ramps: RampEntity[] = [],
    trains: TrainEntity[] = [],
  ): CollisionResult {
    let hit = false;
    let hitObstacleId: number | null = null;
    let coinCollected = false;
    let coinsCollected = 0;
    let collectedAirborneCoins = 0;
    const collectedCoinGroupIds: number[] = [];
    const collectedCoinSparks: { x: number; y: number; z: number }[] = [];
    let bonusCollected: BonusKind | null = null;
    let rampHit: RampEntity | null = null;
    const destroyedCoinIds: number[] = [];
    const microBreakIds: number[] = [];
    const playerCfg = this.cfg.player;
    const obstacleCfg = this.cfg.obstacle;
    const defaultZTolerance = (obstacleCfg.depth + playerCfg.depth) / 2 - this.cfg.hit.zGrace;
    const grounded = player.airState === 'grounded';
    const inFlight =
      player.airState === 'airborne' ||
      player.airState === 'trainRoof' ||
      player.airState === 'trainExit';
    const rocketFlight = player.mode === 'rocket';

    for (const ramp of ramps) {
      if (ramp.used) continue;
      if (!grounded || rocketFlight) break;
      const dz = Math.abs(ramp.z);
      if (dz > defaultZTolerance) continue;
      if (!this.sameLane(player.laneX, this.cfg.lane.positions[ramp.lane])) continue;
      rampHit = ramp;
      break;
    }

    const playerHeight = player.isSliding
      ? this.cfg.horse.slideHeight
      : playerCfg.height;
    const collisionY = player.airState === 'landing' && player.mode !== 'horse'
      ? 0
      : player.y;

    for (const obstacle of obstacles) {
      if (obstacle.broken || obstacle.cleared || obstacle.collisionIgnored) continue;
      if (obstacle.trainId !== undefined) continue;
      if (rocketFlight || (inFlight && player.mode !== 'horse')) continue;
      if (
        !obstacleZIntersectsPlayer(
          obstacle,
          obstacleCfg,
          playerCfg.depth,
          this.cfg.hit,
        )
      ) {
        continue;
      }
      if (!this.sameLane(player.laneX, this.cfg.lane.positions[obstacle.lane])) continue;
      if (player.mode === 'horse' && obstacle.horseDodgeOnly) {
        hit = true;
        hitObstacleId = obstacle.id;
        break;
      }
      if (obstacle.kind === 'micro') {
        if (this.intersectsObstacle(obstacle, collisionY, playerHeight, player.mode)) {
          microBreakIds.push(obstacle.id);
        }
        continue;
      }
      if (this.intersectsObstacle(obstacle, collisionY, playerHeight, player.mode)) {
        hit = true;
        hitObstacleId = obstacle.id;
        break;
      }
    }

    this.crushCoins(obstacles, trains, coins, destroyedCoinIds);

    for (const coin of coins) {
      if (coin.collected || coin.destroyed) continue;
      if (!this.intersectsCoin(player, coin)) continue;
      const sparkPos = this.coinSparkPosition(player, coin);
      coin.collected = true;
      coinCollected = true;
      coinsCollected += 1;
      if (
        coin.airPathId !== undefined ||
        coin.airTargetTime !== undefined ||
        rocketFlight ||
        player.airState === 'airborne' ||
        player.airState === 'landing' ||
        player.airState === 'trainRoof' ||
        player.airState === 'trainExit'
      ) {
        collectedAirborneCoins += 1;
      }
      if (coin.actionGroupId !== undefined) collectedCoinGroupIds.push(coin.actionGroupId);
      collectedCoinSparks.push(sparkPos);
    }

    for (const bonus of bonuses) {
      if (bonus.collected) continue;
      const dz = Math.abs(bonus.z);
      if (dz > this.cfg.coin.radius + playerCfg.depth / 2) continue;
      if (!this.sameLane(player.laneX, this.cfg.lane.positions[bonus.lane])) continue;
      const bonusY = bonus.y ?? this.cfg.coin.radius + this.cfg.coin.collectGrace;
      const playerHeight = player.isSliding
        ? this.cfg.horse.slideHeight
        : playerCfg.height;
      if (
        bonusY < player.y - this.cfg.coin.collectGrace ||
        bonusY > player.y + playerHeight + this.cfg.coin.collectGrace
      ) {
        continue;
      }
      bonus.collected = true;
      bonusCollected = bonus.kind;
    }

    return {
      hit,
      hitObstacleId,
      coinCollected,
      coinsCollected,
      collectedAirborneCoins,
      collectedCoinGroupIds,
      collectedCoinSparks,
      bonusCollected,
      rampHit,
      destroyedCoinIds,
      microBreakIds,
    };
  }

  private crushCoins(
    obstacles: ObstacleEntity[],
    trains: TrainEntity[],
    coins: CoinEntity[],
    destroyedCoinIds: number[],
  ): void {
    for (const coin of coins) {
      if (coin.collected || coin.destroyed) continue;
      const hitTrain = this.overlappingTrain(coin, trains);
      const hitObstacle = this.overlappingObstacle(coin, obstacles);
      if (hitTrain !== null) {
        coin.destroyed = true;
        destroyedCoinIds.push(coin.id);
        continue;
      }
      if (hitObstacle !== null && coin.crushArmed) {
        coin.destroyed = true;
        destroyedCoinIds.push(coin.id);
        continue;
      }
      if (hitTrain === null && hitObstacle === null) coin.crushArmed = true;
    }
  }

  overlappingObstacle(
    coin: CoinEntity,
    obstacles: ObstacleEntity[],
  ): ObstacleEntity | null {
    const obstacleCfg = this.cfg.obstacle;
    const playerHeight = this.cfg.player.height;
    for (const obstacle of obstacles) {
      if (obstacle.broken || obstacle.cleared) continue;
      if (coin.trainId !== undefined) continue;
      const obstacleX = this.cfg.lane.positions[obstacle.lane];
      const obstacleBottom = this.obstacleBottom(obstacle);
      const obstacleTop = this.obstacleTop(obstacle);
      const depth = obstacleFootprint(obstacle, obstacleCfg).depth;
      if (Math.abs(obstacle.z - coin.z) > (depth + this.cfg.coin.radius) / 2) {
        continue;
      }
      if (Math.abs(obstacleX - this.cfg.lane.positions[coin.lane]) > this.laneWidth * 0.5) {
        continue;
      }
      const coinY = coin.y ?? playerHeight / 2;
      if (coinY < obstacleBottom || coinY > obstacleTop) continue;
      return obstacle;
    }
    return null;
  }

  overlappingTrain(coin: CoinEntity, trains: TrainEntity[]): TrainEntity | null {
    const playerHeight = this.cfg.player.height;
    for (const train of trains) {
      if (coin.trainId === train.id || coin.airPathId !== undefined) continue;
      const halfDepth = train.length / 2 + this.cfg.coin.radius;
      if (Math.abs(train.z - coin.z) > halfDepth) continue;
      if (!this.sameLane(
        this.cfg.lane.positions[coin.lane],
        this.cfg.lane.positions[train.lane],
      )) continue;
      const coinY = coin.y ?? playerHeight / 2;
      if (coinY > train.height) continue;
      return train;
    }
    return null;
  }

  private coinSparkPosition(
    player: PlayerState,
    coin: CoinEntity,
  ): { x: number; y: number; z: number } {
    const playerCfg = this.cfg.player;
    const coinX = coin.x ?? this.cfg.lane.positions[coin.lane];
    let coinY = coin.y ?? player.y + playerCfg.height / 2;
    if (player.mode === 'rocket' && coin.rocketPattern !== undefined) {
      coinY = Math.max(coinY, player.y);
    }
    return { x: coinX, y: coinY, z: coin.z };
  }

  private intersectsCoin(player: PlayerState, coin: CoinEntity): boolean {
    const cfg = this.cfg.coin;
    const playerCfg = this.cfg.player;
    const playerHeight = player.isSliding
      ? this.cfg.horse.slideHeight
      : playerCfg.height;
    const grace = cfg.collectGrace +
      (player.mode === 'horse' && player.airSource === 'horseJump'
        ? this.cfg.horse.coinCollectGrace
        : 0);
    const coinX = coin.x ?? this.cfg.lane.positions[coin.lane];
    const coinY = coin.y ?? player.y + playerCfg.height / 2;
    const minX = player.laneX - playerCfg.width / 2 - grace;
    const maxX = player.laneX + playerCfg.width / 2 + grace;
    const minY = player.y - grace;
    const maxY = player.y + playerHeight + grace;
    const minZ = -playerCfg.depth / 2 - grace;
    const maxZ = playerCfg.depth / 2 + grace;
    const closestX = clamp(coinX, minX, maxX);
    const closestY = clamp(coinY, minY, maxY);
    const closestZ = clamp(coin.z, minZ, maxZ);
    const dx = coinX - closestX;
    const dy = coinY - closestY;
    const dz = coin.z - closestZ;
    return dx * dx + dy * dy + dz * dz <= cfg.radius * cfg.radius;
  }

  private obstacleBottom(
    obstacle: ObstacleEntity,
    playerMode: PlayerState['mode'] = 'car',
  ): number {
    if (obstacle.kind === 'overhead') {
      const clearance = this.cfg.horse.slideClearanceHeight;
      return playerMode === 'horse'
        ? clearance * HORSE_OVERHEAD_CLEARANCE_MUL
        : clearance;
    }
    return obstacle.y ?? 0;
  }

  private obstacleTop(
    obstacle: ObstacleEntity,
    playerMode: PlayerState['mode'] = 'car',
  ): number {
    const obstacleCfg = this.cfg.obstacle;
    const bottom = this.obstacleBottom(obstacle, playerMode);
    if (obstacle.kind === 'tall' || obstacle.kind === 'overhead') {
      const tall = obstacleCfg.tallHeight;
      return obstacle.kind === 'overhead' && playerMode === 'horse'
        ? tall * HORSE_OVERHEAD_ARCH_HEIGHT_MUL
        : tall;
    }
    if (obstacle.kind === 'micro') return bottom + obstacleCfg.microHeight;
    return bottom + obstacleCfg.lowHeight;
  }

  private intersectsObstacle(
    obstacle: ObstacleEntity,
    collisionY: number,
    playerHeight: number,
    playerMode: PlayerState['mode'],
  ): boolean {
    const obstacleBottom = this.obstacleBottom(obstacle, playerMode);
    const obstacleTop = this.obstacleTop(obstacle, playerMode);
    const playerTop = collisionY + playerHeight;
    return (
      collisionY < obstacleTop - this.cfg.hit.heightGrace &&
      playerTop > obstacleBottom + this.cfg.hit.heightGrace
    );
  }

  private sameLane(laneX: number, laneCenter: number): boolean {
    return Math.abs(laneX - laneCenter) <= this.laneWidth / 2;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
