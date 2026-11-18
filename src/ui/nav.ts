// What screens can ask the app shell to do.
export type Screen = 'start' | 'choose' | 'session' | 'replay';

export type Nav = {
  go(screen: Screen): void;
  /** Downloads / loads the on-device model on a user gesture. */
  prepareDevice(onProgress: (f: number) => void): Promise<void>;
  /** Shows the Cloud live confirmation; turns it on for this session only on a clear yes. */
  askCloudLive(): void;
  openReceipt(): void;
};
