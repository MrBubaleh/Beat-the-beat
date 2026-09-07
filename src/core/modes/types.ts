export type PlayerMode = 'car' | 'horse' | 'rocket';

export const PLAYER_MODES: readonly PlayerMode[] = ['car', 'horse', 'rocket'];

export type PlayerShape = 'box' | 'sphere' | 'cone';

export interface ModeProfile {
  mode: PlayerMode;
  playerShape: PlayerShape;
  levelgenProfile: string;
  directorProfile: string;
  inputContext: string;
  cameraProfile: string;
}

export const MODE_PROFILES: Record<PlayerMode, ModeProfile> = {
  car: {
    mode: 'car',
    playerShape: 'box',
    levelgenProfile: 'car',
    directorProfile: 'car',
    inputContext: 'car',
    cameraProfile: 'car',
  },
  horse: {
    mode: 'horse',
    playerShape: 'sphere',
    levelgenProfile: 'horse',
    directorProfile: 'horse',
    inputContext: 'horse',
    cameraProfile: 'horse',
  },
  rocket: {
    mode: 'rocket',
    playerShape: 'cone',
    levelgenProfile: 'rocket',
    directorProfile: 'rocket',
    inputContext: 'rocket',
    cameraProfile: 'rocket',
  },
};
