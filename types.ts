
export interface Timestamp {
  id: string;
  userId?: string;
  time: number;
  label: string;
}

export interface Track {
  id: string;
  userId?: string;
  name: string;
  artist: string;
  url: string; // Local blob URL
  audioUrl?: string; // Firebase Storage URL
  coverUrl: string;
  coverStorageUrl?: string; // Firebase Storage URL for cover
  isFavorite: boolean;
  timestamps: Timestamp[];
  duration: number;
  playbackRate: number;
  order: number;
  fileBlob?: File | Blob;
  coverBlob?: File | Blob;
  sourceType?: 'record' | 'import';
}

export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  playbackRate: number;
  isLoading: boolean;
  isLooping: boolean;
}
