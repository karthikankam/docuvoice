export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
}

export interface UploadedFile {
  name: string;
  type: string;
  data: string; // Base64 string
}

export enum AppStatus {
  IDLE = 'IDLE',
  TRANSLATING = 'TRANSLATING',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  READY = 'READY',
  ERROR = 'ERROR',
}

export interface AudioState {
  buffer: AudioBuffer | null;
  duration: number;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  fileName: string;
  targetLanguage: string;
  text: string;
}
