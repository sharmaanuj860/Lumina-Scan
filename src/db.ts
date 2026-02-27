import Dexie, { type Table } from 'dexie';

export interface ScannedDocument {
  id?: number;
  name: string;
  originalImage: string; // base64
  processedImage: string; // base64
  createdAt: number;
  corners: { x: number; y: number }[];
}

export class ScanDatabase extends Dexie {
  scans!: Table<ScannedDocument>;

  constructor() {
    super('ScanDatabase');
    this.version(1).stores({
      scans: '++id, name, createdAt'
    });
  }
}

export const db = new ScanDatabase();
